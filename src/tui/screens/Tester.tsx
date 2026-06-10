import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { MultiSelect, Badge } from "@inkjs/ui";
import { useStore } from "../store.js";
import { useCommandDispatch } from "../dispatch.js";

export function Tester() {
  const { state, dispatch } = useStore();
  const { runLine } = useCommandDispatch();
  const [running, setRunning] = useState(false);
  const active = state.focusZone === "screen" && !state.prompt && !state.busy && !running;

  useInput(
    (_input, key) => {
      if (key.escape) dispatch({ type: "navigate", screen: "dashboard" });
    },
    { isActive: active },
  );

  if (state.profiles.length === 0) {
    return (
      <Box paddingX={1}>
        <Text dimColor>No profiles to test — run setup first (esc to go back).</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} gap={1}>
      <Text bold>Select profiles to test (space toggles, enter runs)</Text>
      <MultiSelect
        isDisabled={!active}
        options={state.profiles.map((p) => ({ label: `${p.id} (${p.alias})`, value: p.id }))}
        defaultValue={state.profiles.map((p) => p.id)}
        onSubmit={async (ids) => {
          setRunning(true);
          for (const id of ids) {
            await runLine(`test ${id}`);
          }
          setRunning(false);
        }}
      />
      <Box flexDirection="column">
        {state.profiles
          .filter((p) => p.lastTest)
          .map((p) => (
            <Box key={p.id} gap={1}>
              <Badge color={p.lastTest!.ok ? "green" : "red"}>{p.lastTest!.ok ? "ok" : "fail"}</Badge>
              <Text>{p.id}</Text>
              <Text dimColor>{p.lastTest!.message}</Text>
            </Box>
          ))}
      </Box>
      <Text dimColor>esc to go back</Text>
    </Box>
  );
}
