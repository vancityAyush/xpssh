import { defineCommand, UsageError, type CommandContext } from "./types.js";
import { findProfile, loadManifest } from "../core/manifest.js";
import type { Profile } from "../core/profile.js";
import { addKeyToAgent, ensureAgentRunning, getAgentStatus, removeKeyFromAgent } from "../services/agent.js";
import { expandTilde } from "../platform/paths.js";

const AGENT_SUBCOMMANDS = ["list", "add", "remove", "start"] as const;
type AgentSubcommand = (typeof AGENT_SUBCOMMANDS)[number];

interface AgentArgs {
  subcommand: AgentSubcommand;
  profile?: string;
}

function isAgentSubcommand(value: string): value is AgentSubcommand {
  return (AGENT_SUBCOMMANDS as readonly string[]).includes(value);
}

async function requireProfile(ctx: CommandContext, idOrAlias: string | undefined, subcommand: string): Promise<Profile> {
  if (!idOrAlias) throw new UsageError(`Missing <profile> — usage: xpssh agent ${subcommand} <profile>`);
  const manifest = await loadManifest(ctx.paths.manifest);
  const profile = findProfile(manifest, idOrAlias);
  if (!profile) throw new UsageError(`No profile "${idOrAlias}" — run \`xpssh list\` to see what exists`);
  return profile;
}

export const agentCommand = defineCommand<AgentArgs>({
  name: "agent",
  summary: "Inspect and manage keys in ssh-agent",
  usage: "xpssh agent [list|add <profile>|remove <profile>|start]",
  flags: [],
  parse(positionals) {
    const subcommand = positionals[0] ?? "list";
    if (!isAgentSubcommand(subcommand)) {
      throw new UsageError(
        `Unknown agent subcommand "${subcommand}" — expected one of: ${AGENT_SUBCOMMANDS.join(", ")}`,
      );
    }
    return { subcommand, profile: positionals[1] };
  },
  async run(args, ctx) {
    switch (args.subcommand) {
      case "list": {
        const status = await getAgentStatus(ctx.exec);
        if (!status.running) {
          return { ok: true, message: "ssh-agent is not running — start it with `xpssh agent start`" };
        }
        if (status.keys.length === 0) {
          return { ok: true, message: "Agent running, no keys loaded" };
        }
        const manifest = await loadManifest(ctx.paths.manifest);
        for (const key of status.keys) {
          const owner = manifest.profiles.find((p) => p.email === key.comment);
          const line = `${key.bits} ${key.type} ${key.fingerprint} ${key.comment}`;
          ctx.emit({ type: "info", text: owner ? `${line} ← ${owner.id}` : line });
        }
        return { ok: true };
      }
      case "add": {
        const profile = await requireProfile(ctx, args.profile, "add");
        const running = await ensureAgentRunning(ctx.exec, ctx.env);
        if (!running) return { ok: false, message: "Could not start ssh-agent" };
        await addKeyToAgent(ctx.exec, ctx.os, expandTilde(profile.keyPath, ctx.paths.home));
        return {
          ok: true,
          message: ctx.os.hasKeychain
            ? `Key for ${profile.id} added to ssh-agent (persisted to Keychain)`
            : `Key for ${profile.id} added to ssh-agent`,
        };
      }
      case "remove": {
        const profile = await requireProfile(ctx, args.profile, "remove");
        const removed = await removeKeyFromAgent(ctx.exec, expandTilde(profile.keyPath, ctx.paths.home));
        if (!removed) {
          return {
            ok: false,
            message: `Could not remove ${profile.id} from ssh-agent — the key is probably not loaded`,
          };
        }
        return { ok: true, message: `Key for ${profile.id} removed from ssh-agent` };
      }
      case "start": {
        const running = await ensureAgentRunning(ctx.exec, ctx.env);
        return running
          ? { ok: true, message: "ssh-agent is running" }
          : { ok: false, message: "Failed to start ssh-agent" };
      }
    }
  },
});
