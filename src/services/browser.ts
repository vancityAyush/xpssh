import type { ExecFn } from "./exec.js";
import type { OsInfo } from "../platform/os.js";

export async function openInBrowser(exec: ExecFn, os: OsInfo, url: string): Promise<boolean> {
  const [cmd, ...args] = os.openCommand;
  const result = await exec(cmd!, [...args, url]);
  return result.code === 0;
}
