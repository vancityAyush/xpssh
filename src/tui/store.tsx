import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from "react";
import type { CommandEvent, SelectChoice } from "../commands/types.js";
import type { ProfileRow } from "../commands/list.js";
import type { SetupArgs } from "../commands/setup.js";

export type Screen = "dashboard" | "keys" | "setup" | "agent" | "help";
export type FocusZone = "screen" | "bar";

/** A prompt a running command is waiting on; PromptOverlay renders it and calls resolve. */
export type PendingPrompt =
  | { kind: "confirm"; message: string; resolve: (answer: boolean) => void }
  | { kind: "text"; message: string; defaultValue?: string; resolve: (answer: string) => void }
  | { kind: "secret"; message: string; resolve: (answer: string) => void }
  | { kind: "select"; message: string; choices: SelectChoice<unknown>[]; resolve: (value: unknown) => void };

export interface AppState {
  screen: Screen;
  profiles: ProfileRow[];
  transcript: CommandEvent[];
  busy: boolean;
  focusZone: FocusZone;
  history: string[];
  prompt: PendingPrompt | null;
  /** args carried into the SetupWizard when a `setup …` command line opens it */
  setupPrefill: SetupArgs | null;
}

export type Action =
  | { type: "navigate"; screen: Screen }
  | { type: "set-profiles"; profiles: ProfileRow[] }
  | { type: "append-event"; event: CommandEvent }
  | { type: "clear-transcript" }
  | { type: "set-busy"; busy: boolean }
  | { type: "set-focus"; zone: FocusZone }
  | { type: "push-history"; line: string }
  | { type: "set-prompt"; prompt: PendingPrompt | null }
  | { type: "set-setup-prefill"; args: SetupArgs | null };

const MAX_TRANSCRIPT = 200;

export const initialState: AppState = {
  screen: "dashboard",
  profiles: [],
  transcript: [],
  busy: false,
  focusZone: "screen",
  history: [],
  prompt: null,
  setupPrefill: null,
};

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "navigate":
      return { ...state, screen: action.screen };
    case "set-profiles":
      return { ...state, profiles: action.profiles };
    case "append-event":
      return { ...state, transcript: [...state.transcript, action.event].slice(-MAX_TRANSCRIPT) };
    case "clear-transcript":
      return { ...state, transcript: [] };
    case "set-busy":
      return { ...state, busy: action.busy };
    case "set-focus":
      return { ...state, focusZone: action.zone };
    case "push-history":
      return { ...state, history: [...state.history, action.line].slice(-100) };
    case "set-prompt":
      return { ...state, prompt: action.prompt };
    case "set-setup-prefill":
      return { ...state, setupPrefill: action.args };
  }
}

const StoreContext = createContext<{ state: AppState; dispatch: Dispatch<Action> } | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return <StoreContext.Provider value={{ state, dispatch }}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore outside StoreProvider");
  return store;
}
