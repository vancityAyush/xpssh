import { homedir } from "node:os";
import { join } from "node:path";

export interface Paths {
  home: string;
  sshDir: string;
  sshConfig: string;
  configDir: string;
  manifest: string;
}

/** Resolve all xpssh paths from an environment, so tests can point HOME at a tmpdir. */
export function resolvePaths(env: Record<string, string | undefined> = process.env): Paths {
  const home = env["HOME"] ?? env["USERPROFILE"] ?? homedir();
  const configDir =
    env["XPSSH_CONFIG_DIR"] ??
    (env["XDG_CONFIG_HOME"] ? join(env["XDG_CONFIG_HOME"], "xpssh") : join(home, ".config", "xpssh"));
  const sshDir = join(home, ".ssh");
  return {
    home,
    sshDir,
    sshConfig: join(sshDir, "config"),
    configDir,
    manifest: join(configDir, "profiles.json"),
  };
}

/** Expand a leading `~` to the home directory. */
export function expandTilde(path: string, home: string): string {
  if (path === "~") return home;
  if (path.startsWith("~/")) return join(home, path.slice(2));
  return path;
}

/** Contract an absolute path under home back to `~/...` for display and config files. */
export function contractTilde(path: string, home: string): string {
  if (path === home) return "~";
  if (path.startsWith(home + "/")) return "~/" + path.slice(home.length + 1);
  return path;
}

/** Normalize a path for comparison: expand ~, forward slashes. */
export function normalizeForComparison(path: string, home: string): string {
  return expandTilde(path, home).replace(/\\/g, "/");
}
