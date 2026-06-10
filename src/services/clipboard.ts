import type { ExecFn } from "./exec.js";
import type { OsInfo } from "../platform/os.js";

/** Try each platform clipboard tool in order. Returns true when one succeeds. */
export async function copyToClipboard(exec: ExecFn, os: OsInfo, text: string): Promise<boolean> {
  for (const [cmd, ...args] of os.clipboardCommands) {
    const result = await exec(cmd!, args, { stdin: text });
    if (result.code === 0) return true;
  }
  return false;
}
