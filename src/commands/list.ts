import { access } from "node:fs/promises";
import { defineCommand } from "./types.js";
import { loadManifest } from "../core/manifest.js";
import { clonePrefix } from "../core/profile.js";
import { expandTilde } from "../platform/paths.js";

interface ListArgs {
  json: boolean;
}

export const listCommand = defineCommand<ListArgs>({
  name: "list",
  aliases: ["ls"],
  summary: "Show all managed profiles and their status",
  usage: "xpssh list [--json]",
  flags: [{ name: "json", type: "boolean", description: "machine-readable output" }],
  parse(_positionals, values) {
    return { json: values["json"] === true };
  },
  async run(args, ctx) {
    const manifest = await loadManifest(ctx.paths.manifest);
    if (manifest.profiles.length === 0) {
      if (args.json) {
        ctx.emit({ type: "info", text: JSON.stringify({ profiles: [] }) });
        return { ok: true };
      }
      return { ok: true, message: "No profiles yet — run `xpssh setup <provider>` to create one" };
    }

    const rows = await Promise.all(
      manifest.profiles.map(async (p) => {
        let keyExists = false;
        try {
          await access(expandTilde(p.keyPath, ctx.paths.home));
          keyExists = true;
        } catch {
          // missing key file
        }
        return { ...p, keyExists, clonePrefix: clonePrefix(p) };
      }),
    );

    if (args.json) {
      ctx.emit({ type: "info", text: JSON.stringify({ profiles: rows }, null, 2) });
      return { ok: true };
    }

    for (const row of rows) {
      const status = !row.keyExists
        ? "key missing"
        : row.lastTest
          ? row.lastTest.ok
            ? "tested ok"
            : "test failed"
          : "untested";
      const type = status === "tested ok" ? "success" : status === "untested" ? "info" : "warn";
      ctx.emit({
        type,
        text: `${row.id}  ${row.keyType}  ${row.email}  [${status}]${row.isDefault ? " (default)" : ""}  clone: ${row.clonePrefix}owner/repo.git`,
      });
    }
    return { ok: true };
  },
});
