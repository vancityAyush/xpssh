import type { ExecFn } from "../services/exec.js";
import type { Paths } from "../platform/paths.js";
import type { OsInfo } from "../platform/os.js";

export type CommandEvent =
  | { type: "step"; id: string; label: string; status: "start" | "done" | "fail" }
  | { type: "info" | "success" | "warn" | "error"; text: string };

export interface SelectChoice<T> {
  label: string;
  value: T;
}

/**
 * Everything a command needs from the outside world. The CLI builds one over
 * stdout/readline, the TUI builds one over React state, tests build a fake.
 */
export interface CommandContext {
  exec: ExecFn;
  env: Record<string, string | undefined>;
  paths: Paths;
  os: OsInfo;
  /** true when -y/--yes was passed: never prompt; confirm() auto-yes, prompt*() throws UsageError */
  yes: boolean;
  emit(event: CommandEvent): void;
  confirm(message: string): Promise<boolean>;
  promptText(message: string, options?: { defaultValue?: string }): Promise<string>;
  promptSecret(message: string): Promise<string>;
  promptSelect<T>(message: string, choices: SelectChoice<T>[]): Promise<T>;
}

export interface CommandResult {
  ok: boolean;
  message?: string;
}

export interface FlagSpec {
  name: string;
  short?: string;
  type: "string" | "boolean";
  description: string;
  /** shown in usage, e.g. <email> */
  valueHint?: string;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export interface CommandDef<A = unknown> {
  name: string;
  aliases?: string[];
  summary: string;
  usage: string;
  flags: FlagSpec[];
  /** validate parseArgs output into typed args; throw UsageError on bad input */
  parse(positionals: string[], values: Record<string, string | boolean | undefined>): A;
  run(args: A, ctx: CommandContext): Promise<CommandResult>;
}

/** Helper preserving the A type parameter when defining commands. */
export function defineCommand<A>(def: CommandDef<A>): CommandDef<A> {
  return def;
}
