import { Box, Text, useInput } from "ink";
import { useStore } from "../store.js";
import { COMMANDS } from "../../commands/registry.js";

export function HelpScreen() {
  const { state, dispatch } = useStore();

  useInput(
    (_input, key) => {
      if (key.escape) dispatch({ type: "navigate", screen: "dashboard" });
    },
    { isActive: state.focusZone === "screen" && !state.prompt },
  );

  return (
    <Box flexDirection="column" paddingX={1} gap={1}>
      <Text bold>Commands (type them in the bar below, same as the CLI)</Text>
      <Box flexDirection="column">
        {COMMANDS.map((c) => (
          <Box key={c.name}>
            <Box width={12}>
              <Text color="cyan">{c.name}</Text>
            </Box>
            <Text dimColor>{c.summary}</Text>
          </Box>
        ))}
      </Box>
      <Box flexDirection="column">
        <Text bold>Keys</Text>
        <Text dimColor>/ or : focus command bar · ↑↓ history · 1/2 screens · esc back · q quit</Text>
      </Box>
    </Box>
  );
}
