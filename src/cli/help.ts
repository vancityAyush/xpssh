import { COMMANDS, lookupCommand } from "../commands/registry.js";
import type { CommandDef } from "../commands/types.js";
import { VERSION } from "../version.js";

export function renderHelp(commandName?: string): string {
  if (commandName) {
    const def = lookupCommand(commandName);
    if (def) return renderCommandHelp(def);
  }
  const lines = [
    `xpssh v${VERSION} — SSH keys for git providers, done right`,
    "",
    "Usage: xpssh <command> [options]",
    "       xpssh            launch the interactive TUI",
    "",
    "Commands:",
    ...COMMANDS.map((c) => `  ${c.name.padEnd(10)} ${c.summary}`),
    `  ${"help".padEnd(10)} Show help for a command`,
    "",
    "Run `xpssh help <command>` for flags.",
  ];
  return lines.join("\n");
}

function renderCommandHelp(def: CommandDef): string {
  const lines = [def.summary, "", `Usage: ${def.usage}`];
  if (def.flags.length > 0) {
    lines.push("", "Options:");
    for (const flag of def.flags) {
      const left = [flag.short ? `-${flag.short},` : "   ", `--${flag.name}`, flag.valueHint ?? ""]
        .join(" ")
        .trimEnd();
      lines.push(`  ${left.padEnd(28)} ${flag.description}`);
    }
  }
  return lines.join("\n");
}
