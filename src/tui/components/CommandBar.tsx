import { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { useStore } from "../store.js";
import { useCommandDispatch } from "../dispatch.js";

export function CommandBar() {
  const { state, dispatch } = useStore();
  const { runLine } = useCommandDispatch();
  const [value, setValue] = useState("");
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);

  const focused = state.focusZone === "bar" && !state.prompt;

  useInput(
    (_input, key) => {
      if (key.escape) {
        setValue("");
        setHistoryIndex(null);
        dispatch({ type: "set-focus", zone: "screen" });
        return;
      }
      if (key.upArrow && state.history.length > 0) {
        const next = historyIndex === null ? state.history.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(next);
        setValue(state.history[next] ?? "");
      }
      if (key.downArrow && historyIndex !== null) {
        const next = historyIndex + 1;
        if (next >= state.history.length) {
          setHistoryIndex(null);
          setValue("");
        } else {
          setHistoryIndex(next);
          setValue(state.history[next] ?? "");
        }
      }
    },
    { isActive: focused },
  );

  return (
    <Box borderStyle="round" paddingX={1} borderColor={focused ? "cyan" : undefined} borderDimColor={!focused}>
      <Text color={focused ? "cyan" : "gray"}>❯ </Text>
      <TextInput
        value={value}
        onChange={(next) => {
          setValue(next);
          setHistoryIndex(null);
        }}
        onSubmit={(line) => {
          setValue("");
          setHistoryIndex(null);
          dispatch({ type: "set-focus", zone: "screen" });
          void runLine(line);
        }}
        focus={focused}
        placeholder={focused ? "setup github -e you@example.com" : "press / to type a command"}
        showCursor={focused}
      />
    </Box>
  );
}
