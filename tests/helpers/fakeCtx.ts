import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandContext, CommandEvent, SelectChoice } from "../../src/commands/types.js";
import type { ExecFn, ExecResult } from "../../src/services/exec.js";
import { resolvePaths } from "../../src/platform/paths.js";
import { resolveOs } from "../../src/platform/os.js";

export interface ScriptedExec {
  /** substring matched against `cmd + " " + args.join(" ")` */
  match: string;
  result: Partial<ExecResult>;
  /** side effect run when matched (e.g. create the key files ssh-keygen would) */
  effect?: (cmd: string, args: string[]) => Promise<void> | void;
}

export interface FakeCtx extends CommandContext {
  home: string;
  events: CommandEvent[];
  execCalls: string[];
  /** push more scripted responses mid-test */
  script: ScriptedExec[];
}

export interface FakeCtxOptions {
  script?: ScriptedExec[];
  confirmAnswer?: boolean;
  textAnswers?: string[];
  selectIndex?: number;
  yes?: boolean;
  platform?: NodeJS.Platform;
  /** scripted fetch responses, consumed in order; default = 200 {} */
  fetchResponses?: Array<{ status: number; body: unknown }>;
}

/** CommandContext against a tmpdir HOME with a scripted exec — no real processes, no real ~/.ssh. */
export async function makeFakeCtx(options: FakeCtxOptions = {}): Promise<FakeCtx> {
  const home = await mkdtemp(join(tmpdir(), "xpssh-home-"));
  const env = { HOME: home };
  const events: CommandEvent[] = [];
  const execCalls: string[] = [];
  const script = [...(options.script ?? [])];
  const textAnswers = [...(options.textAnswers ?? [])];

  const exec: ExecFn = async (cmd, args) => {
    const call = `${cmd} ${args.join(" ")}`;
    execCalls.push(call);
    const index = script.findIndex((s) => call.includes(s.match));
    if (index === -1) {
      return { code: 0, stdout: "", stderr: "" };
    }
    const scripted = script[index]!;
    if (scripted.effect) await scripted.effect(cmd, args);
    return { code: 0, stdout: "", stderr: "", ...scripted.result };
  };

  const fetchResponses = [...(options.fetchResponses ?? [])];
  const fakeFetch = (async (_input: string | URL | Request, _init?: RequestInit) => {
    const next = fetchResponses.shift() ?? { status: 200, body: {} };
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  return {
    home,
    events,
    execCalls,
    script,
    exec,
    fetch: fakeFetch,
    env,
    paths: resolvePaths(env),
    os: resolveOs(options.platform ?? "darwin"),
    yes: options.yes ?? false,
    emit: (event) => events.push(event),
    confirm: async () => options.confirmAnswer ?? true,
    promptText: async (_message, opts) => textAnswers.shift() ?? opts?.defaultValue ?? "",
    promptSecret: async () => textAnswers.shift() ?? "",
    promptSelect: async <T,>(_message: string, choices: SelectChoice<T>[]): Promise<T> =>
      choices[options.selectIndex ?? 0]!.value,
  };
}
