import { useEffect } from "react";
import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import { ThemeProvider, defaultTheme } from "@inkjs/ui";
import { StoreProvider, useStore, type Screen } from "./store.js";
import { useCommandDispatch } from "./dispatch.js";
import { Header } from "./components/Header.js";
import { Transcript } from "./components/Transcript.js";
import { CommandBar } from "./components/CommandBar.js";
import { PromptOverlay } from "./components/PromptOverlay.js";
import { Dashboard } from "./screens/Dashboard.js";
import { KeyManager } from "./screens/KeyManager.js";
import { HelpScreen } from "./screens/HelpScreen.js";

const SCREEN_KEYS: Record<string, Screen> = { "1": "dashboard", "2": "keys" };

function Shell() {
  const { state, dispatch } = useStore();
  const { refreshProfiles } = useCommandDispatch();
  const { exit } = useApp();
  const { rows, columns } = useWindowSize();

  useEffect(() => {
    void refreshProfiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Zone arbitration: only active when the screen owns focus and nothing is running.
  useInput(
    (input, key) => {
      if (input === "/" || input === ":" || (key.ctrl && input === "k")) {
        dispatch({ type: "set-focus", zone: "bar" });
        return;
      }
      if (input === "q") exit();
      if (input === "?") dispatch({ type: "navigate", screen: "help" });
      if (key.ctrl && input === "l") dispatch({ type: "clear-transcript" });
      const screen = SCREEN_KEYS[input];
      if (screen) dispatch({ type: "navigate", screen });
    },
    { isActive: state.focusZone === "screen" && !state.prompt && !state.busy },
  );

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Header />
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {state.screen === "dashboard" && <Dashboard />}
        {state.screen === "keys" && <KeyManager />}
        {state.screen === "help" && <HelpScreen />}
      </Box>
      <Transcript />
      <PromptOverlay />
      <CommandBar />
      <Box paddingX={1}>
        <Text dimColor>/ command · 1 dashboard · 2 keys · ? help · ctrl+l clear · q quit</Text>
      </Box>
    </Box>
  );
}

export function App() {
  return (
    <ThemeProvider theme={defaultTheme}>
      <StoreProvider>
        <Shell />
      </StoreProvider>
    </ThemeProvider>
  );
}
