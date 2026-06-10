/** Classification of `ssh -T git@host` output. Proven heuristics carried over from sshx. */

export interface TestClassification {
  ok: boolean;
  /** short human message, e.g. the provider greeting or the failure reason */
  message: string;
}

const SUCCESS_RE = /successfully authenticated|shell access is not supported|authenticated/i;
const DENIED_RE = /permission denied/i;

export function classifyTestOutput(code: number | null, stdout: string, stderr: string): TestClassification {
  const combined = `${stdout}\n${stderr}`.trim();
  const firstLine =
    combined
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !l.startsWith("Warning:")) ?? "";

  if (DENIED_RE.test(combined)) {
    return { ok: false, message: "Permission denied — the key is not registered with the provider yet" };
  }
  if (SUCCESS_RE.test(combined)) {
    return { ok: true, message: firstLine };
  }
  // Git providers close the connection with exit 1 after a successful auth banner;
  // exit 0/1 without a denial still counts as reachable+authenticated.
  if (code === 0 || code === 1) {
    return { ok: true, message: firstLine || "Authenticated" };
  }
  return { ok: false, message: firstLine || `ssh exited with code ${code}` };
}

export interface AgentKey {
  bits: number;
  fingerprint: string;
  comment: string;
  type: string;
}

/** Parse `ssh-add -l` output. Returns [] for "The agent has no identities." */
export function parseAgentList(stdout: string): AgentKey[] {
  const keys: AgentKey[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || /has no identities/i.test(trimmed)) continue;
    const match = trimmed.match(/^(\d+)\s+(\S+)\s+(.*?)\s+\((\S+)\)$/);
    if (match) {
      keys.push({
        bits: Number(match[1]),
        fingerprint: match[2]!,
        comment: match[3]!,
        type: match[4]!,
      });
    }
  }
  return keys;
}
