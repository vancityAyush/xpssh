import * as readline from "node:readline/promises";
import { styleText } from "node:util";
import { realExec } from "../services/exec.js";
import { resolvePaths } from "../platform/paths.js";
import { resolveOs } from "../platform/os.js";
import { UsageError, type CommandContext, type CommandEvent, type SelectChoice } from "../commands/types.js";
import { resolveCommand, hasYesFlag } from "./parse.js";
import { renderHelp } from "./help.js";

function renderEvent(event: CommandEvent): void {
  switch (event.type) {
    case "step":
      if (event.status === "start") process.stdout.write(styleText("dim", `· ${event.label}\n`));
      else if (event.status === "fail") process.stdout.write(styleText("red", `✗ ${event.label}\n`));
      else process.stdout.write(styleText("green", `✓ ${event.label}\n`));
      break;
    case "success":
      process.stdout.write(styleText("green", `✓ ${event.text}\n`));
      break;
    case "error":
      process.stdout.write(styleText("red", `✗ ${event.text}\n`));
      break;
    case "warn":
      process.stdout.write(styleText("yellow", `! ${event.text}\n`));
      break;
    default:
      process.stdout.write(`  ${event.text}\n`);
  }
}

function buildTerminalContext(yes: boolean): CommandContext {
  const rl = () => readline.createInterface({ input: process.stdin, output: process.stdout });

  return {
    exec: realExec,
    env: process.env,
    paths: resolvePaths(process.env),
    os: resolveOs(),
    yes,
    emit: renderEvent,

    async confirm(message) {
      if (yes) return true;
      const iface = rl();
      try {
        const answer = await iface.question(`${message} ${styleText("dim", "[y/N] ")}`);
        return /^y(es)?$/i.test(answer.trim());
      } finally {
        iface.close();
      }
    },

    async promptText(message, options) {
      if (yes) throw new UsageError(`Missing input: ${message}`);
      const iface = rl();
      try {
        const hint = options?.defaultValue ? styleText("dim", ` (${options.defaultValue})`) : "";
        const answer = (await iface.question(`${message}${hint}: `)).trim();
        return answer || options?.defaultValue || "";
      } finally {
        iface.close();
      }
    },

    async promptSecret(message) {
      if (yes) throw new UsageError(`Missing input: ${message}`);
      // Mute echo by intercepting output writes after the prompt is printed.
      const muted = { active: false };
      const iface = readline.createInterface({
        input: process.stdin,
        output: new Proxy(process.stdout, {
          get(target, prop) {
            if (prop === "write" && muted.active) {
              return () => true;
            }
            const value = Reflect.get(target, prop);
            return typeof value === "function" ? value.bind(target) : value;
          },
        }) as NodeJS.WritableStream,
        terminal: true,
      });
      try {
        process.stdout.write(`${message}: `);
        muted.active = true;
        const answer = await iface.question("");
        process.stdout.write("\n");
        return answer.trim();
      } finally {
        iface.close();
      }
    },

    async promptSelect<T>(message: string, choices: SelectChoice<T>[]): Promise<T> {
      if (yes) throw new UsageError(`Missing input: ${message}`);
      process.stdout.write(`${message}\n`);
      choices.forEach((choice, i) => process.stdout.write(`  ${i + 1}) ${choice.label}\n`));
      const iface = rl();
      try {
        for (;;) {
          const answer = await iface.question(`Choose [1-${choices.length}]: `);
          const index = Number(answer.trim()) - 1;
          const choice = choices[index];
          if (choice) return choice.value;
          process.stdout.write(styleText("yellow", "Not a valid choice\n"));
        }
      } finally {
        iface.close();
      }
    },
  };
}

/** CLI frontend: tokens → command → exit code (0 ok, 1 failed, 2 usage). */
export async function runCli(tokens: string[]): Promise<number> {
  if (tokens[0] === "help" || tokens.includes("--help") || tokens.includes("-h")) {
    const target = tokens[0] === "help" ? tokens[1] : tokens[0];
    process.stdout.write(renderHelp(target === "-h" || target === "--help" ? undefined : target) + "\n");
    return 0;
  }

  try {
    const { def, args } = resolveCommand(tokens);
    const ctx = buildTerminalContext(hasYesFlag(tokens));
    const result = await def.run(args, ctx);
    if (result.message) {
      renderEvent({ type: result.ok ? "success" : "error", text: result.message });
    }
    return result.ok ? 0 : 1;
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(styleText("red", `${err.message}\n`));
      return 2;
    }
    process.stderr.write(styleText("red", `✗ ${(err as Error).message}\n`));
    return 1;
  }
}
