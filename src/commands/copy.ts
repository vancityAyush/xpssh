import { defineCommand, UsageError } from "./types.js";
import { findProfile, loadManifest } from "../core/manifest.js";
import { getProvider } from "../core/providers/index.js";
import { readPublicKey } from "../services/keygen.js";
import { copyToClipboard } from "../services/clipboard.js";
import { openInBrowser } from "../services/browser.js";
import { expandTilde } from "../platform/paths.js";

interface CopyArgs {
  profile?: string;
  open: boolean;
}

export const copyCommand = defineCommand<CopyArgs>({
  name: "copy",
  summary: "Copy a profile's public key to the clipboard",
  usage: "xpssh copy <profile> [--open]",
  flags: [{ name: "open", type: "boolean", description: "also open the provider's SSH settings page" }],
  parse(positionals, values) {
    return { profile: positionals[0], open: values["open"] === true };
  },
  async run(args, ctx) {
    if (!args.profile) throw new UsageError("Missing <profile> — run `xpssh list` to see what exists");
    const manifest = await loadManifest(ctx.paths.manifest);
    const profile = findProfile(manifest, args.profile);
    if (!profile) throw new UsageError(`No profile "${args.profile}" — run \`xpssh list\` to see what exists`);

    const publicKey = await readPublicKey(expandTilde(profile.keyPath, ctx.paths.home));
    const copied = await copyToClipboard(ctx.exec, ctx.os, publicKey);
    if (!copied) {
      ctx.emit({ type: "info", text: publicKey });
      return { ok: false, message: "Clipboard unavailable — public key printed above" };
    }

    if (args.open) {
      const provider = getProvider(profile.provider)!;
      await openInBrowser(ctx.exec, ctx.os, provider.settingsUrl);
      ctx.emit({ type: "info", text: `Opened ${provider.settingsUrl}` });
    }
    return { ok: true, message: `Public key for ${profile.id} copied to clipboard` };
  },
});
