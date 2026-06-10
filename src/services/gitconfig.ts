import { unlink, writeFile } from "node:fs/promises";
import type { ExecFn } from "./exec.js";
import { buildProfileGitconfig, deriveGitconfigPath, includeIfKey } from "../core/gitconfig.js";
import { expandTilde } from "../platform/paths.js";

/** Write ~/.ssh/<key>.gitconfig and bind `dir` to it via the global git config. */
export async function linkGitIdentity(
  exec: ExecFn,
  home: string,
  profile: { email: string; keyPath: string },
  dir: string,
): Promise<void> {
  const gitconfigPath = deriveGitconfigPath(profile.keyPath);
  await writeFile(expandTilde(gitconfigPath, home), buildProfileGitconfig(profile.email, profile.keyPath));
  // never hand-edit ~/.gitconfig — let git do it
  const result = await exec("git", ["config", "--global", includeIfKey(dir), gitconfigPath]);
  if (result.code !== 0) {
    throw new Error(`git config failed: ${result.stderr.trim() || `exit ${result.code}`}`);
  }
}

/** Remove the includeIf binding and the profile gitconfig file. */
export async function unlinkGitIdentity(
  exec: ExecFn,
  home: string,
  profile: { keyPath: string },
  dirs: string[],
): Promise<void> {
  for (const dir of dirs) {
    await exec("git", ["config", "--global", "--unset", includeIfKey(dir)]);
  }
  try {
    await unlink(expandTilde(deriveGitconfigPath(profile.keyPath), home));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
