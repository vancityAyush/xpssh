import type { ExecFn } from "./exec.js";
import { classifyTestOutput, type TestClassification } from "../core/sshOutput.js";

/** Test ssh auth against a Host alias from ~/.ssh/config (so the right key is exercised). */
export async function testConnection(exec: ExecFn, alias: string, sshUser = "git"): Promise<TestClassification> {
  const result = await exec(
    "ssh",
    ["-T", "-o", "StrictHostKeyChecking=accept-new", "-o", "BatchMode=yes", `${sshUser}@${alias}`],
    { timeoutMs: 20_000 },
  );
  return classifyTestOutput(result.code, result.stdout, result.stderr);
}

/**
 * Test SSH connectivity to a custom host (EC2/VM) via its config alias.
 * Runs `exit 0` instead of `-T` since generic sshd doesn't respond to the git auth probe.
 */
export async function testCustomConnection(exec: ExecFn, alias: string): Promise<TestClassification> {
  const result = await exec(
    "ssh",
    ["-o", "StrictHostKeyChecking=accept-new", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", alias, "exit 0"],
    { timeoutMs: 20_000 },
  );
  if (result.code === 0) {
    return { ok: true, message: `Connected to ${alias} successfully` };
  }
  const stderr = (result.stderr ?? "").trim();
  return { ok: false, message: stderr || `SSH to ${alias} failed (exit ${result.code})` };
}
