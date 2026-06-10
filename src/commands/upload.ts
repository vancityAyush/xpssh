import { hostname } from "node:os";
import { defineCommand, UsageError } from "./types.js";
import { findProfile, loadManifest, saveManifest } from "../core/manifest.js";
import { getProvider } from "../core/providers/index.js";
import { uploadKey } from "../services/api.js";
import { readPublicKey } from "../services/keygen.js";
import { expandTilde } from "../platform/paths.js";

interface UploadArgs {
  profile?: string;
  token?: string;
}

export const uploadCommand = defineCommand<UploadArgs>({
  name: "upload",
  summary: "Upload a profile's public key via the provider API",
  usage: "xpssh upload <profile> [--token <token>]",
  flags: [{ name: "token", type: "string", description: "provider API token", valueHint: "<token>" }],
  parse(positionals, values) {
    return { profile: positionals[0], token: values["token"] as string | undefined };
  },
  async run(args, ctx) {
    if (!args.profile) throw new UsageError("Missing <profile> — run `xpssh list` to see what exists");
    const manifest = await loadManifest(ctx.paths.manifest);
    const profile = findProfile(manifest, args.profile);
    if (!profile) throw new UsageError(`No profile "${args.profile}" — run \`xpssh list\` to see what exists`);

    const provider = getProvider(profile.provider)!;
    if (!provider.api) {
      return {
        ok: false,
        message: `${provider.label} has no key-upload API — add the key manually at ${provider.settingsUrl}`,
      };
    }

    let token = args.token ?? ctx.env[provider.api.tokenEnvVar];
    if (!token && !ctx.yes) {
      token = await ctx.promptSecret(`${provider.label} API token (${provider.api.tokenHint})`);
    }
    if (!token) {
      throw new UsageError(`No API token — pass --token <token> or set ${provider.api.tokenEnvVar}`);
    }

    const publicKey = await readPublicKey(expandTilde(profile.keyPath, ctx.paths.home));
    const title = `xpssh:${profile.id}@${hostname()}`;
    const outcome = await uploadKey(provider, token, title, publicKey, ctx.fetch);
    if (!outcome.ok) {
      return { ok: false, message: outcome.message };
    }

    profile.uploaded = { via: "api", at: new Date().toISOString() };
    await saveManifest(ctx.paths.manifest, manifest);
    return { ok: true, message: outcome.message };
  },
});
