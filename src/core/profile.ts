import type { KeyType, Provider } from "./providers/index.js";

export interface ProfileTestResult {
  ok: boolean;
  at: string;
  message: string;
}

export interface Profile {
  /** `<provider>-<name>`, e.g. github-work */
  id: string;
  provider: Provider["id"];
  /** account label, e.g. work / personal */
  name: string;
  email: string;
  /** ssh config Host alias; bare host iff isDefault */
  alias: string;
  /** tilde-contracted private key path */
  keyPath: string;
  keyType: KeyType;
  isDefault: boolean;
  createdAt: string;
  lastTest?: ProfileTestResult;
  /** directories bound to this identity via git includeIf */
  gitDirs: string[];
  uploaded?: { via: "api" | "manual"; at: string };
}

/** Lowercase, [a-z0-9-] only — used for profile names and ids. */
export function sanitizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function deriveProfileId(providerId: string, name: string): string {
  return `${providerId}-${sanitizeName(name)}`;
}

export function deriveAlias(host: string, name: string, isDefault: boolean): string {
  return isDefault ? host : `${host}-${sanitizeName(name)}`;
}

export function deriveKeyPath(providerId: string, name: string): string {
  return `~/.ssh/xpssh_${providerId}_${sanitizeName(name).replace(/-/g, "_")}`;
}

/** What users prepend to repo paths when cloning with this profile. */
export function clonePrefix(profile: Pick<Profile, "alias">, sshUser = "git"): string {
  return `${sshUser}@${profile.alias}:`;
}
