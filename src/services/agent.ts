import type { ExecFn } from "./exec.js";
import type { OsInfo } from "../platform/os.js";
import { parseAgentList, type AgentKey } from "../core/sshOutput.js";

export interface AgentStatus {
  running: boolean;
  keys: AgentKey[];
}

/** `ssh-add -l` exit codes: 0 = keys listed, 1 = agent running but empty, 2 = no agent. */
export async function getAgentStatus(exec: ExecFn): Promise<AgentStatus> {
  const result = await exec("ssh-add", ["-l"]);
  if (result.code === 2 || result.code === null) return { running: false, keys: [] };
  return { running: true, keys: parseAgentList(result.stdout) };
}

/**
 * Spawn ssh-agent and export its env into this process so subsequent
 * ssh-add calls work. Session-scoped: the user's shell is not affected.
 */
export async function ensureAgentRunning(exec: ExecFn, env: Record<string, string | undefined>): Promise<boolean> {
  const status = await getAgentStatus(exec);
  if (status.running) return true;

  const result = await exec("ssh-agent", ["-s"]);
  if (result.code !== 0) return false;
  for (const [, name, value] of result.stdout.matchAll(/(SSH_AUTH_SOCK|SSH_AGENT_PID)=([^;]+);/g)) {
    env[name!] = value!;
    process.env[name!] = value!;
  }
  return (await getAgentStatus(exec)).running;
}

export async function addKeyToAgent(exec: ExecFn, os: OsInfo, absKeyPath: string): Promise<void> {
  const args = os.hasKeychain ? ["--apple-use-keychain", absKeyPath] : [absKeyPath];
  const result = await exec("ssh-add", args);
  if (result.code !== 0) {
    throw new Error(`ssh-add failed: ${result.stderr.trim() || `exit ${result.code}`}`);
  }
}

export async function removeKeyFromAgent(exec: ExecFn, absKeyPath: string): Promise<boolean> {
  const result = await exec("ssh-add", ["-d", absKeyPath]);
  return result.code === 0;
}
