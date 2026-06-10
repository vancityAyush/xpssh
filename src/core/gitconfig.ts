/** Per-profile git identity files and the includeIf keys that bind directories to them. */

export function buildProfileGitconfig(email: string, keyPath: string): string {
  return [
    "[user]",
    `    email = ${email}`,
    "[core]",
    `    sshCommand = ssh -i ${keyPath} -o IdentitiesOnly=yes`,
    "",
  ].join("\n");
}

/** The gitconfig file lives next to the key pair and is removed with it. */
export function deriveGitconfigPath(keyPath: string): string {
  return `${keyPath}.gitconfig`;
}

/** git config key for a directory-scoped include; gitdir wants a trailing slash. */
export function includeIfKey(dir: string): string {
  const normalized = dir.endsWith("/") ? dir : `${dir}/`;
  return `includeIf.gitdir:${normalized}.path`;
}
