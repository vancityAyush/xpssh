import { useCallback } from "react";
import { realExec } from "../services/exec.js";
import { resolvePaths } from "../platform/paths.js";
import { resolveOs } from "../platform/os.js";
import { tokenize } from "../cli/tokenize.js";
import { resolveCommand, hasYesFlag } from "../cli/parse.js";
import { gatherProfileRows } from "../commands/list.js";
import { UsageError, type CommandContext, type SelectChoice } from "../commands/types.js";
import { useStore, type PendingPrompt } from "./store.js";

/** Result lines printed to normal stdout after the alt-screen closes. */
export const sessionLog: string[] = [];

/**
 * Hook giving screens and the command bar one entry point that runs the exact
 * CLI command layer, with prompts routed to the PromptOverlay.
 */
export function useCommandDispatch() {
  const { state, dispatch } = useStore();

  const refreshProfiles = useCallback(async () => {
    const rows = await gatherProfileRows(resolvePaths(process.env));
    dispatch({ type: "set-profiles", profiles: rows });
  }, [dispatch]);

  const runLine = useCallback(
    async (line: string) => {
      const tokens = tokenize(line);
      if (tokens.length === 0) return;
      dispatch({ type: "push-history", line });

      const ask = <T,>(build: (resolve: (value: T) => void) => PendingPrompt): Promise<T> =>
        new Promise<T>((resolve) => {
          dispatch({
            type: "set-prompt",
            prompt: build((value) => {
              dispatch({ type: "set-prompt", prompt: null });
              resolve(value);
            }),
          });
        });

      const ctx: CommandContext = {
        exec: realExec,
        fetch: globalThis.fetch,
        env: process.env,
        paths: resolvePaths(process.env),
        os: resolveOs(),
        yes: hasYesFlag(tokens),
        emit: (event) => dispatch({ type: "append-event", event }),
        confirm: (message) =>
          hasYesFlag(tokens) ? Promise.resolve(true) : ask((resolve) => ({ kind: "confirm", message, resolve })),
        promptText: (message, options) =>
          ask((resolve) => ({ kind: "text", message, defaultValue: options?.defaultValue, resolve })),
        promptSecret: (message) => ask((resolve) => ({ kind: "secret", message, resolve })),
        promptSelect: <T,>(message: string, choices: SelectChoice<T>[]) =>
          ask<T>((resolve) => ({
            kind: "select",
            message,
            choices: choices as SelectChoice<unknown>[],
            resolve: resolve as (value: unknown) => void,
          })),
      };

      dispatch({ type: "set-busy", busy: true });
      dispatch({ type: "append-event", event: { type: "info", text: `❯ ${line}` } });
      try {
        const { def, args } = resolveCommand(tokens);
        const result = await def.run(args, ctx);
        if (result.message) {
          dispatch({
            type: "append-event",
            event: { type: result.ok ? "success" : "error", text: result.message },
          });
          sessionLog.push(`${result.ok ? "✓" : "✗"} ${result.message}`);
        }
      } catch (err) {
        const text = err instanceof UsageError ? err.message : `✗ ${(err as Error).message}`;
        dispatch({ type: "append-event", event: { type: "error", text } });
      } finally {
        dispatch({ type: "set-busy", busy: false });
        dispatch({ type: "set-prompt", prompt: null });
        await refreshProfiles();
      }
    },
    [dispatch, refreshProfiles],
  );

  return { runLine, refreshProfiles, busy: state.busy };
}
