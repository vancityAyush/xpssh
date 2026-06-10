import { defineCommand, UsageError } from "./types.js";
import { findProfile, loadManifest, removeProfile, saveManifest } from "../core/manifest.js";
import { removeBlock } from "../core/sshconfig.js";
import { loadSshConfig, saveSshConfig } from "../services/sshconfigFile.js";
import { deleteKeyPair } from "../services/keygen.js";
import { expandTilde } from "../platform/paths.js";

interface RemoveArgs {
  profile?: string;
  keepKey: boolean;
}

export const removeCommand = defineCommand<RemoveArgs>({
  name: "remove",
  aliases: ["rm"],
  summary: "Remove a profile: ssh config block, key files, manifest entry",
  usage: "xpssh remove <profile> [--keep-key] [-y]",
  flags: [
    { name: "keep-key", type: "boolean", description: "keep the key files on disk" },
    { name: "yes", short: "y", type: "boolean", description: "skip confirmation" },
  ],
  parse(positionals, values) {
    return { profile: positionals[0], keepKey: values["keep-key"] === true };
  },
  async run(args, ctx) {
    if (!args.profile) throw new UsageError("Missing <profile> — run `xpssh list` to see what exists");
    const manifest = await loadManifest(ctx.paths.manifest);
    const profile = findProfile(manifest, args.profile);
    if (!profile) throw new UsageError(`No profile "${args.profile}" — run \`xpssh list\` to see what exists`);

    const what = args.keepKey ? "ssh config entry" : `ssh config entry and key files (${profile.keyPath})`;
    const confirmed = await ctx.confirm(`Remove ${profile.id} — ${what}?`);
    if (!confirmed) return { ok: false, message: "Aborted" };

    const segments = await loadSshConfig(ctx.paths);
    const { segments: next, removed } = removeBlock(segments, profile.id);
    if (removed) {
      await saveSshConfig(ctx.paths, next);
      ctx.emit({ type: "info", text: `Removed Host ${profile.alias} from ~/.ssh/config` });
    } else {
      ctx.emit({ type: "warn", text: "No managed ssh config block found (already removed?)" });
    }

    if (!args.keepKey) {
      await deleteKeyPair(expandTilde(profile.keyPath, ctx.paths.home));
      ctx.emit({ type: "info", text: `Deleted ${profile.keyPath}(.pub)` });
    }

    await saveManifest(ctx.paths.manifest, removeProfile(manifest, profile.id));
    return { ok: true, message: `Profile ${profile.id} removed` };
  },
});
