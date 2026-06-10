import { useCallback } from "react";
import { realExec } from "../services/exec.js";
import { resolvePaths } from "../platform/paths.js";
import { resolveOs } from "../platform/os.js";
import { tokenize } from "../cli/tokenize.js";
import { resolveCommand, hasYesFlag } from "../cli/parse.js";
import { gatherProfileRows } from "../commands/list.js";
import { UsageError, type CommandContext, type CommandEvent, type SelectChoice } from "../commands/types.js";
import type { SetupArgs } from "../commands/setup.js";
import { useStore, type PendingPrompt } from "./store.js";

/** Result lines printed to normal stdout after the alt-screen closes. */
export const sessionLog: string[] = [];

export function useCommandDispatch() {
  const { state, dispatch } = useStore();

  const refreshProfiles = useCallback(async () => {
    const rows = await gatherProfileRows(resolvePaths(process.env));
    dispatch({ type: "set-profiles", profiles: rows });
  }, [dispatch]);

  /**
   * Build a CommandContext whose prompts suspend into the PromptOverlay.
   * `onEvent` lets callers (the wizard's StepList) observe events besides the transcript.
   */
  const makeContext = useCallback(
    (yes: boolean, onEvent?: (event: CommandEvent) => void): CommandContext => {
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

      return {
        exec: realExec,
        fetch: globalThis.fetch,
        env: process.env,
        paths: resolvePaths(process.env),
        os: resolveOs(),
        yes,
        emit: (event) => {
          dispatch({ type: "append-event", event });
          onEvent?.(event);
        },
        confirm: (message) =>
          yes ? Promise.resolve(true) : ask((resolve) => ({ kind: "confirm", message, resolve })),
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
    },
    [dispatch],
  );

  /** Run a command line through the exact CLI command layer. */
  const runLine = useCallback(
    async (line: string) => {
      const tokens = tokenize(line);
      if (tokens.length === 0) return;
      dispatch({ type: "push-history", line });
      dispatch({ type: "append-event", event: { type: "info", text: `❯ ${line}` } });

      let resolved: ReturnType<typeof resolveCommand>;
      try {
        resolved = resolveCommand(tokens);
      } catch (err) {
        dispatch({ type: "append-event", event: { type: "error", text: (err as Error).message } });
        return;
      }

      // The Claude Code feel: an under-specified setup drops you into the
      // wizard prefilled with whatever was parsed, instead of raw prompts.
      if (resolved.def.name === "setup" && !hasYesFlag(tokens)) {
        dispatch({ type: "set-setup-prefill", args: resolved.args as SetupArgs });
        dispatch({ type: "navigate", screen: "setup" });
        return;
      }

      const ctx = makeContext(hasYesFlag(tokens));
      dispatch({ type: "set-busy", busy: true });
      try {
        const result = await resolved.def.run(resolved.args, ctx);
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
    [dispatch, makeContext, refreshProfiles],
  );

  return { runLine, refreshProfiles, makeContext, busy: state.busy };
}
