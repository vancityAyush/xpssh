import type { CommandDef } from "./types.js";
import { setupCommand } from "./setup.js";
import { listCommand } from "./list.js";
import { testCommand } from "./test.js";
import { copyCommand } from "./copy.js";
import { removeCommand } from "./remove.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const COMMANDS: CommandDef<any>[] = [setupCommand, listCommand, testCommand, copyCommand, removeCommand];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lookupCommand(name: string): CommandDef<any> | undefined {
  const needle = name.toLowerCase();
  return COMMANDS.find((c) => c.name === needle || c.aliases?.includes(needle));
}
