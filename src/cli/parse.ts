import { parseArgs } from "node:util";
import { UsageError, type CommandDef } from "../commands/types.js";
import { lookupCommand } from "../commands/registry.js";

export interface ResolvedCommand<A = unknown> {
  def: CommandDef<A>;
  args: A;
}

/**
 * Token list (from argv or the TUI command bar) → command + typed args.
 * Throws UsageError for unknown commands/flags/values.
 */
export function resolveCommand(tokens: string[]): ResolvedCommand {
  const [name, ...rest] = tokens;
  if (!name) throw new UsageError("No command given — try `xpssh help`");
  const def = lookupCommand(name);
  if (!def) throw new UsageError(`Unknown command "${name}" — try \`xpssh help\``);

  const options: Record<string, { type: "string" | "boolean"; short?: string }> = {};
  for (const flag of def.flags) {
    options[flag.name] = flag.short ? { type: flag.type, short: flag.short } : { type: flag.type };
  }

  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({ args: rest, options, allowPositionals: true, strict: true });
  } catch (err) {
    throw new UsageError(`${(err as Error).message.split("\n")[0]}\nUsage: ${def.usage}`);
  }

  const args = def.parse(parsed.positionals, parsed.values as Record<string, string | boolean | undefined>);
  return { def, args };
}

/** Whether -y/--yes appears in the tokens (drives CommandContext.yes). */
export function hasYesFlag(tokens: string[]): boolean {
  return tokens.includes("-y") || tokens.includes("--yes");
}
