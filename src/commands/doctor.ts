import { access, chmod, stat } from "node:fs/promises";
import { defineCommand } from "./types.js";
import { loadManifest } from "../core/manifest.js";
import type { Profile } from "../core/profile.js";
import {
  listManagedIds,
  parseBlockFields,
  removeBlock,
  upsertBlock,
  SshConfigParseError,
  type HostBlockSpec,
  type Segment,
} from "../core/sshconfig.js";
import { loadSshConfig, saveSshConfig } from "../services/sshconfigFile.js";
import { getProvider } from "../core/providers/index.js";
import { contractTilde, expandTilde } from "../platform/paths.js";

interface DoctorArgs {
  fix: boolean;
}

const HOST_LINE_RE = /^\s*Host\s+(.+)$/gm;

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Mode bits readable by group/other — private ssh files should be 600. */
async function looseMode(path: string): Promise<number | null> {
  try {
    const { mode } = await stat(path);
    return (mode & 0o077) !== 0 ? mode & 0o777 : null;
  } catch {
    return null; // missing files are reported by the key-file check, not here
  }
}

/** Does any user (non-managed) segment before `blockIndex` declare a Host pattern matching `alias`? */
function shadowedByEarlierHost(segments: Segment[], blockIndex: number, alias: string): boolean {
  return segments.slice(0, blockIndex).some(
    (segment) =>
      segment.kind === "user" &&
      [...segment.text.matchAll(HOST_LINE_RE)].some((match) =>
        match[1]!
          .trim()
          .split(/\s+/)
          .some((pattern) => pattern === alias || pattern === "*"),
      ),
  );
}

export const doctorCommand = defineCommand<DoctorArgs>({
  name: "doctor",
  summary: "Reconcile manifest, ssh config, and key files; report drift",
  usage: "xpssh doctor [--fix]",
  flags: [{ name: "fix", type: "boolean", description: "repair what can be repaired" }],
  parse(_positionals, values) {
    return { fix: values["fix"] === true };
  },
  async run(args, ctx) {
    let segments: Segment[];
    try {
      segments = await loadSshConfig(ctx.paths);
    } catch (err) {
      if (err instanceof SshConfigParseError) {
        ctx.emit({ type: "error", text: err.message });
        return { ok: false, message: "~/.ssh/config has broken xpssh fences — fix manually" };
      }
      throw err;
    }

    const manifest = await loadManifest(ctx.paths.manifest);
    let found = 0;
    let fixed = 0;
    let configDirty = false;

    /** Emit a warn for the finding; under --fix run the repair (if any) and emit its info text. */
    const report = async (text: string, fix?: () => Promise<string> | string): Promise<void> => {
      found += 1;
      ctx.emit({ type: "warn", text });
      if (args.fix && fix) {
        ctx.emit({ type: "info", text: await fix() });
        fixed += 1;
      }
    };

    const blockSpecFor = (profile: Profile): HostBlockSpec => {
      const provider = getProvider(profile.provider)!; // manifest schema guarantees a known provider
      return {
        id: profile.id,
        alias: profile.alias,
        hostName: provider.host,
        user: provider.sshUser,
        identityFile: profile.keyPath,
        useKeychain: ctx.os.hasKeychain,
      };
    };

    // 2. Profile block missing from ssh config
    const managedIds = new Set(listManagedIds(segments));
    for (const profile of manifest.profiles) {
      if (managedIds.has(profile.id)) continue;
      await report(`${profile.id}: missing ssh config block`, () => {
        segments = upsertBlock(segments, blockSpecFor(profile)).segments;
        configDirty = true;
        return `${profile.id}: re-added Host ${profile.alias} to ~/.ssh/config`;
      });
    }

    // 3. Orphan managed blocks with no matching profile
    const profileIds = new Set(manifest.profiles.map((p) => p.id));
    for (const id of listManagedIds(segments)) {
      if (profileIds.has(id)) continue;
      await report(`orphan ssh config block "${id}"`, () => {
        segments = removeBlock(segments, id).segments;
        configDirty = true;
        return `removed orphan block "${id}" from ~/.ssh/config`;
      });
    }

    // 4. Stale block content (alias or key path drifted)
    for (const profile of manifest.profiles) {
      const block = segments.find((s) => s.kind === "managed" && s.id === profile.id);
      if (!block) continue;
      const fields = parseBlockFields(block.text);
      if (fields["Host"] === profile.alias && fields["IdentityFile"] === profile.keyPath) continue;
      await report(`${profile.id}: ssh config block is stale (expected Host ${profile.alias}, IdentityFile ${profile.keyPath})`, () => {
        segments = upsertBlock(segments, blockSpecFor(profile)).segments;
        configDirty = true;
        return `${profile.id}: regenerated ssh config block`;
      });
    }

    // 5. Key files on disk (never generate keys here — that is setup's job)
    for (const profile of manifest.profiles) {
      const absKeyPath = expandTilde(profile.keyPath, ctx.paths.home);
      if ((await fileExists(absKeyPath)) && (await fileExists(`${absKeyPath}.pub`))) continue;
      await report(
        `${profile.id}: key file missing (${profile.keyPath}) — regenerate with ` +
          `\`xpssh setup ${profile.provider} -n ${profile.name} --force\` or detach with ` +
          `\`xpssh remove ${profile.id} --keep-key\``,
      );
    }

    // 6. Permissions on ssh config and private keys (POSIX only)
    if (ctx.os.platform !== "win32") {
      const sensitive = [ctx.paths.sshConfig, ...manifest.profiles.map((p) => expandTilde(p.keyPath, ctx.paths.home))];
      for (const path of sensitive) {
        const mode = await looseMode(path);
        if (mode === null) continue;
        const display = contractTilde(path, ctx.paths.home);
        await report(`${display}: permissions too open (${mode.toString(8)}) — should be 600`, async () => {
          await chmod(path, 0o600);
          return `restored 600 permissions on ${display}`;
        });
      }
    }

    // 7. Profile aliases shadowed by earlier user Host entries (ssh first-match-wins)
    for (const profile of manifest.profiles) {
      const blockIndex = segments.findIndex((s) => s.kind === "managed" && s.id === profile.id);
      if (blockIndex === -1) continue;
      if (shadowedByEarlierHost(segments, blockIndex, profile.alias)) {
        await report(`${profile.id}: alias ${profile.alias} may be shadowed by an earlier Host entry`);
      }
    }

    if (configDirty) await saveSshConfig(ctx.paths, segments);

    if (found === 0) return { ok: true, message: "No issues found" };
    return {
      ok: found === fixed,
      message: `${found} issue${found === 1 ? "" : "s"} found, ${fixed} fixed`,
    };
  },
});
