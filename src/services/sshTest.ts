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
