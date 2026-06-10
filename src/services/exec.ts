import { spawn } from "node:child_process";

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  /** text piped to the child's stdin */
  stdin?: string;
  timeoutMs?: number;
}

/**
 * The single seam through which every external command runs.
 * Tests replace this with a scripted fake; nothing else in the codebase spawns processes.
 */
export type ExecFn = (cmd: string, args: string[], opts?: ExecOptions) => Promise<ExecResult>;

export const realExec: ExecFn = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const settle = (result: ExecResult) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGKILL");
          settle({ code: null, stdout, stderr: stderr + `\n[xpssh] timed out after ${opts.timeoutMs}ms` });
        }, opts.timeoutMs)
      : null;

    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      settle({ code: null, stdout, stderr: `${err.message}` });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      settle({ code, stdout, stderr });
    });

    if (opts.stdin !== undefined) {
      child.stdin.write(opts.stdin);
    }
    child.stdin.end();
  });
