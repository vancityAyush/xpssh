import { copyFile, mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { dirname } from "node:path";
import { parseSegments, renderSegments, type Segment } from "../core/sshconfig.js";
import type { Paths } from "../platform/paths.js";

/** Read and parse ~/.ssh/config; missing file = empty config. */
export async function loadSshConfig(paths: Paths): Promise<Segment[]> {
  let text: string;
  try {
    text = await readFile(paths.sshConfig, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  return parseSegments(text);
}

/** Backup to config.xpssh.bak, then write with 600 perms (ssh dir created 700 if missing). */
export async function saveSshConfig(paths: Paths, segments: Segment[]): Promise<void> {
  await mkdir(dirname(paths.sshConfig), { recursive: true, mode: 0o700 });
  try {
    await copyFile(paths.sshConfig, `${paths.sshConfig}.xpssh.bak`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  await writeFile(paths.sshConfig, renderSegments(segments), { mode: 0o600 });
  await chmod(paths.sshConfig, 0o600);
}
