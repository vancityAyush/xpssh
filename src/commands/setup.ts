import { access } from "node:fs/promises";
import { hostname } from "node:os";
import { defineCommand, UsageError, type CommandContext } from "./types.js";
import { getProvider, PROVIDERS, type KeyType, type Provider } from "../core/providers/index.js";
import {
  deriveAlias,
  deriveKeyPath,
  deriveProfileId,
  clonePrefix,
  sanitizeName,
  type Profile,
} from "../core/profile.js";
import { loadManifest, saveManifest, upsertProfile } from "../core/manifest.js";
import { upsertBlock } from "../core/sshconfig.js";
import { loadSshConfig, saveSshConfig } from "../services/sshconfigFile.js";
import { generateKeyPair, readPublicKey } from "../services/keygen.js";
import { copyToClipboard } from "../services/clipboard.js";
import { openInBrowser } from "../services/browser.js";
import { testConnection, testCustomConnection } from "../services/sshTest.js";
import { addKeyToAgent, ensureAgentRunning } from "../services/agent.js";
import { linkGitIdentity } from "../services/gitconfig.js";
import { uploadKey } from "../services/api.js";
import { expandTilde } from "../platform/paths.js";

export interface SetupArgs {
  provider?: string;
  name?: string;
  email?: string;
  keyType?: KeyType;
  default?: boolean;
  noBrowser: boolean;
  noClipboard: boolean;
  noAgent: boolean;
  force: boolean;
  /** API token for direct upload (otherwise clipboard+browser) */
  token?: string;
  /** directory to bind to this identity via git includeIf */
  dir?: string;
  /** custom provider: hostname or IP of the remote host */
  host?: string;
  /** custom provider: SSH user on the remote host (default: ubuntu) */
  user?: string;
}

/** Fully-resolved inputs for the pipeline; the wizard fills this through its own UI. */
export interface SetupPlan {
  provider: Provider;
  name: string;
  email: string;
  keyType: KeyType;
  isDefault: boolean;
  profileId: string;
  alias: string;
  /** tilde-contracted */
  keyPath: string;
  noBrowser: boolean;
  noClipboard: boolean;
  noAgent: boolean;
  force: boolean;
  token?: string;
  dir?: string;
  /** custom provider only */
  customHost?: string;
  customUser?: string;
}

export async function resolveSetupPlan(args: SetupArgs, ctx: CommandContext): Promise<SetupPlan> {
  let provider: Provider | undefined = args.provider ? getProvider(args.provider) : undefined;
  if (args.provider && !provider) {
    throw new UsageError(
      `Unknown provider "${args.provider}" — expected one of: ${PROVIDERS.map((p) => p.id).join(", ")}`,
    );
  }
  if (!provider) {
    if (ctx.yes) throw new UsageError("Missing <provider> (required with -y)");
    provider = await ctx.promptSelect(
      "Which git provider?",
      PROVIDERS.map((p) => ({ label: p.label, value: p })),
    );
  }

  const manifest = await loadManifest(ctx.paths.manifest);
  const existingForProvider = manifest.profiles.filter((p) => p.provider === provider.id);

  let name = args.name;
  if (!name) {
    if (ctx.yes) {
      name = "personal";
    } else {
      name = await ctx.promptText("Profile name for this account (e.g. personal, work)", {
        defaultValue: existingForProvider.length === 0 ? "personal" : "",
      });
    }
  }
  name = sanitizeName(name);
  if (!name) throw new UsageError("Profile name must contain at least one letter or digit");

  let email = args.email;
  if (!email) {
    if (ctx.yes) throw new UsageError("Missing --email (required with -y)");
    email = await ctx.promptText(`Email for the ${provider.label} key comment`);
  }
  if (!email.includes("@")) throw new UsageError(`"${email}" does not look like an email address`);

  // First profile for a provider becomes the default (bare host alias) unless one exists.
  const hasDefault = existingForProvider.some((p) => p.isDefault);
  const isDefault = args.default ?? !hasDefault;

  const keyType = args.keyType ?? provider.keyType;
  const profileId = deriveProfileId(provider.id, name);
  // token: explicit flag wins, then the provider's env var
  const token = args.token ?? (provider.api ? ctx.env[provider.api.tokenEnvVar] : undefined);

  // Custom provider: prompt for host and user if not supplied via flags.
  let customHost: string | undefined;
  let customUser: string | undefined;
  if (provider.id === "custom") {
    customHost = args.host;
    if (!customHost) {
      if (ctx.yes) throw new UsageError("Missing --host (required for custom provider with -y)");
      customHost = await ctx.promptText("Remote host (IP or hostname, e.g. 13.206.50.121 or brain.vancity.in)");
    }
    if (!customHost) throw new UsageError("Host is required for the custom provider");

    customUser = args.user;
    if (!customUser) {
      if (ctx.yes) {
        customUser = "ubuntu";
      } else {
        customUser = await ctx.promptText("SSH user on the remote host", { defaultValue: "ubuntu" });
      }
    }
  }

  // For custom provider the alias is just the sanitized name (e.g. "brain"), not host-derived.
  const alias =
    provider.id === "custom"
      ? sanitizeName(name)
      : deriveAlias(provider.host, name, isDefault);

  return {
    provider,
    name,
    email,
    keyType,
    isDefault,
    profileId,
    alias,
    keyPath: deriveKeyPath(provider.id, name),
    noBrowser: args.noBrowser,
    noClipboard: args.noClipboard,
    noAgent: args.noAgent,
    force: args.force,
    token,
    dir: args.dir,
    customHost,
    customUser,
  };
}

export interface SetupStep {
  id: string;
  label: string;
  run(plan: SetupPlan, ctx: CommandContext): Promise<void>;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export const setupSteps: SetupStep[] = [
  {
    id: "generate-key",
    label: "Generate SSH key",
    async run(plan, ctx) {
      const absKeyPath = expandTilde(plan.keyPath, ctx.paths.home);
      if (await fileExists(absKeyPath)) {
        if (!plan.force) {
          const overwrite = await ctx.confirm(`${plan.keyPath} already exists — overwrite it?`);
          if (!overwrite) throw new Error(`Key ${plan.keyPath} already exists (use --force to overwrite)`);
        }
        const { deleteKeyPair } = await import("../services/keygen.js");
        await deleteKeyPair(absKeyPath);
      }
      await generateKeyPair(ctx.exec, { keyType: plan.keyType, keyPath: absKeyPath, email: plan.email });
      ctx.emit({ type: "info", text: `${plan.keyType} key written to ${plan.keyPath}` });
    },
  },
  {
    id: "write-ssh-config",
    label: "Add host entry to ~/.ssh/config",
    async run(plan, ctx) {
      const segments = await loadSshConfig(ctx.paths);
      const { segments: next, action } = upsertBlock(segments, {
        id: plan.profileId,
        alias: plan.alias,
        hostName: plan.customHost ?? plan.provider.host,
        user: plan.customUser ?? plan.provider.sshUser,
        identityFile: plan.keyPath,
        useKeychain: ctx.os.hasKeychain,
      });
      await saveSshConfig(ctx.paths, next);
      ctx.emit({ type: "info", text: `Host ${plan.alias} ${action} in ~/.ssh/config` });
    },
  },
  {
    id: "add-to-agent",
    label: "Load key into ssh-agent",
    async run(plan, ctx) {
      if (plan.noAgent) {
        ctx.emit({ type: "info", text: "Skipped (--no-agent)" });
        return;
      }
      const running = await ensureAgentRunning(ctx.exec, ctx.env);
      if (!running) {
        ctx.emit({ type: "warn", text: "ssh-agent unavailable — key will load on first use via AddKeysToAgent" });
        return;
      }
      try {
        await addKeyToAgent(ctx.exec, ctx.os, expandTilde(plan.keyPath, ctx.paths.home));
        ctx.emit({ type: "info", text: ctx.os.hasKeychain ? "Key in agent (persisted to Keychain)" : "Key in agent" });
      } catch (err) {
        // non-fatal: AddKeysToAgent yes in the config covers first use
        ctx.emit({ type: "warn", text: (err as Error).message });
      }
    },
  },
  {
    id: "save-profile",
    label: "Record profile",
    async run(plan, ctx) {
      const manifest = await loadManifest(ctx.paths.manifest);
      const profile: Profile = {
        id: plan.profileId,
        provider: plan.provider.id,
        name: plan.name,
        email: plan.email,
        alias: plan.alias,
        keyPath: plan.keyPath,
        keyType: plan.keyType,
        isDefault: plan.isDefault,
        createdAt: new Date().toISOString(),
        gitDirs: plan.dir ? [plan.dir] : [],
        ...(plan.customHost ? { customHost: plan.customHost } : {}),
        ...(plan.customUser ? { customUser: plan.customUser } : {}),
      };
      await saveManifest(ctx.paths.manifest, upsertProfile(manifest, profile));
    },
  },
  {
    id: "link-gitconfig",
    label: "Bind directory to this git identity",
    async run(plan, ctx) {
      if (!plan.dir) return;
      await linkGitIdentity(ctx.exec, ctx.paths.home, { email: plan.email, keyPath: plan.keyPath }, plan.dir);
      ctx.emit({ type: "info", text: `Repos under ${plan.dir} now commit as ${plan.email} using this key` });
    },
  },
  {
    id: "deliver-pubkey",
    label: "Deliver public key to provider",
    async run(plan, ctx) {
      const absKeyPath = expandTilde(plan.keyPath, ctx.paths.home);
      const publicKey = await readPublicKey(absKeyPath);

      // Custom provider: no settings URL — show authorized_keys instructions instead.
      if (plan.provider.id === "custom") {
        if (!plan.noClipboard) {
          const copied = await copyToClipboard(ctx.exec, ctx.os, publicKey);
          ctx.emit(
            copied
              ? { type: "success", text: "Public key copied to clipboard" }
              : { type: "warn", text: `Clipboard unavailable — copy it yourself: cat ${plan.keyPath}.pub` },
          );
        }
        ctx.emit({
          type: "info",
          text: `Add the key to the remote host:\n  ssh-copy-id -i ${plan.keyPath}.pub ${plan.customUser ?? "ubuntu"}@${plan.customHost}\n  or: echo '<paste key>' >> ~/.ssh/authorized_keys`,
        });
        return;
      }

      if (plan.token && plan.provider.api) {
        const title = `xpssh:${plan.profileId}@${hostname()}`;
        const outcome = await uploadKey(plan.provider, plan.token, title, publicKey, ctx.fetch);
        ctx.emit({ type: outcome.ok ? "success" : "warn", text: outcome.message });
        if (outcome.ok) {
          const manifest = await loadManifest(ctx.paths.manifest);
          const profile = manifest.profiles.find((p) => p.id === plan.profileId);
          if (profile) {
            profile.uploaded = { via: "api", at: new Date().toISOString() };
            await saveManifest(ctx.paths.manifest, manifest);
          }
          return; // no clipboard/browser needed
        }
        // fall through to manual delivery when the API rejects
      }

      if (!plan.noClipboard) {
        const copied = await copyToClipboard(ctx.exec, ctx.os, publicKey);
        ctx.emit(
          copied
            ? { type: "success", text: "Public key copied to clipboard" }
            : { type: "warn", text: `Clipboard unavailable — copy it yourself: cat ${plan.keyPath}.pub` },
        );
      }
      if (!plan.noBrowser) {
        const opened = await openInBrowser(ctx.exec, ctx.os, plan.provider.settingsUrl);
        ctx.emit(
          opened
            ? { type: "info", text: `Opened ${plan.provider.settingsUrl} — paste the key there` }
            : { type: "warn", text: `Add the key manually at ${plan.provider.settingsUrl}` },
        );
      } else {
        ctx.emit({ type: "info", text: `Add the key at ${plan.provider.settingsUrl}` });
      }
    },
  },
  {
    id: "test-connection",
    label: "Test SSH connection",
    async run(plan, ctx) {
      let result: { ok: boolean; message: string };

      if (plan.provider.id === "custom") {
        // For custom hosts the key is already on the server (user just added it),
        // so test immediately without asking.
        result = await testCustomConnection(ctx.exec, plan.alias);
      } else {
        const ready = await ctx.confirm(`Key added on ${plan.provider.label}? Test the connection now?`);
        if (!ready) {
          ctx.emit({ type: "info", text: `Skipped — run \`xpssh test ${plan.profileId}\` when ready` });
          return;
        }
        result = await testConnection(ctx.exec, plan.alias, plan.provider.sshUser);
      }

      const manifest = await loadManifest(ctx.paths.manifest);
      const profile = manifest.profiles.find((p) => p.id === plan.profileId);
      if (profile) {
        profile.lastTest = { ok: result.ok, at: new Date().toISOString(), message: result.message };
        await saveManifest(ctx.paths.manifest, manifest);
      }
      ctx.emit(
        result.ok
          ? { type: "success", text: result.message }
          : { type: "warn", text: `${result.message} — run \`xpssh test ${plan.profileId}\` after adding the key` },
      );
    },
  },
];

export async function executeSetupPipeline(plan: SetupPlan, ctx: CommandContext): Promise<void> {
  for (const step of setupSteps) {
    ctx.emit({ type: "step", id: step.id, label: step.label, status: "start" });
    try {
      await step.run(plan, ctx);
      ctx.emit({ type: "step", id: step.id, label: step.label, status: "done" });
    } catch (err) {
      ctx.emit({ type: "step", id: step.id, label: step.label, status: "fail" });
      throw err;
    }
  }
}

export const setupCommand = defineCommand<SetupArgs>({
  name: "setup",
  summary: "Generate a key and wire up SSH for a git provider or custom host",
  usage:
    "xpssh setup <provider> [-n <name>] [-e <email>] [-t ed25519|rsa] [--default] [--token <tok>] [--dir <path>] [--host <host>] [--user <user>] [--force] [--no-browser] [--no-clipboard] [--no-agent] [-y]",
  flags: [
    { name: "name", short: "n", type: "string", description: "profile name (work, personal, ...)", valueHint: "<name>" },
    { name: "email", short: "e", type: "string", description: "email for the key comment", valueHint: "<email>" },
    { name: "type", short: "t", type: "string", description: "key algorithm (default: provider preference)", valueHint: "ed25519|rsa" },
    { name: "default", type: "boolean", description: "make this the bare-host default profile" },
    { name: "token", type: "string", description: "API token — upload the key directly, skip browser", valueHint: "<token>" },
    { name: "dir", type: "string", description: "bind a directory to this identity (git includeIf)", valueHint: "<path>" },
    { name: "host", type: "string", description: "custom provider: remote hostname or IP", valueHint: "<host>" },
    { name: "user", type: "string", description: "custom provider: SSH user on the remote host (default: ubuntu)", valueHint: "<user>" },
    { name: "force", type: "boolean", description: "overwrite an existing key file" },
    { name: "no-browser", type: "boolean", description: "don't open the provider settings page" },
    { name: "no-clipboard", type: "boolean", description: "don't copy the public key" },
    { name: "no-agent", type: "boolean", description: "don't load the key into ssh-agent" },
    { name: "yes", short: "y", type: "boolean", description: "never prompt (missing inputs become errors)" },
  ],
  parse(positionals, values) {
    if (values["type"] && values["type"] !== "ed25519" && values["type"] !== "rsa") {
      throw new UsageError(`--type must be ed25519 or rsa, got "${values["type"]}"`);
    }
    return {
      provider: positionals[0],
      name: values["name"] as string | undefined,
      email: values["email"] as string | undefined,
      keyType: values["type"] as KeyType | undefined,
      default: values["default"] === true ? true : undefined,
      token: values["token"] as string | undefined,
      dir: values["dir"] as string | undefined,
      host: values["host"] as string | undefined,
      user: values["user"] as string | undefined,
      force: values["force"] === true,
      noBrowser: values["no-browser"] === true,
      noClipboard: values["no-clipboard"] === true,
      noAgent: values["no-agent"] === true,
    };
  },
  async run(args, ctx) {
    const plan = await resolveSetupPlan(args, ctx);
    await executeSetupPipeline(plan, ctx);
    return {
      ok: true,
      message: `Profile ${plan.profileId} ready — clone with ${clonePrefix(plan, plan.provider.sshUser)}<owner>/<repo>.git`,
    };
  },
});
