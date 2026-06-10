import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Select } from "@inkjs/ui";
import { useStore } from "../store.js";
import { useCommandDispatch } from "../dispatch.js";

export function KeyManager() {
  const { state, dispatch } = useStore();
  const { runLine } = useCommandDispatch();
  const [selected, setSelected] = useState<string | null>(null);
  const active = state.focusZone === "screen" && !state.prompt && !state.busy;

  useInput(
    (_input, key) => {
      if (key.escape) {
        if (selected) setSelected(null);
        else dispatch({ type: "navigate", screen: "dashboard" });
      }
    },
    { isActive: active },
  );

  if (state.profiles.length === 0) {
    return (
      <Box paddingX={1}>
        <Text dimColor>No profiles to manage — run setup first (esc to go back).</Text>
      </Box>
    );
  }

  if (!selected) {
    return (
      <Box flexDirection="column" paddingX={1} gap={1}>
        <Text bold>Pick a profile</Text>
        <Select
          isDisabled={!active}
          options={state.profiles.map((p) => ({ label: `${p.id}  (${p.email})`, value: p.id }))}
          onChange={(id) => setSelected(id)}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} gap={1}>
      <Text bold>{selected}</Text>
      <Select
        isDisabled={!active}
        options={[
          { label: "📋 Copy public key", value: `copy ${selected}` },
          { label: "🌐 Copy + open provider settings", value: `copy ${selected} --open` },
          { label: "🔌 Test connection", value: `test ${selected}` },
          { label: "🗑  Remove profile", value: `remove ${selected}` },
        ]}
        onChange={(line) => {
          setSelected(null);
          void runLine(line);
        }}
      />
      <Text dimColor>esc to go back</Text>
    </Box>
  );
}
