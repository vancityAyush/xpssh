import { Box, Text } from "ink";
import { VERSION } from "../../version.js";
import { useStore } from "../store.js";

export function Header() {
  const { state } = useStore();
  const tested = state.profiles.filter((p) => p.lastTest?.ok).length;
  return (
    <Box paddingX={1} justifyContent="space-between">
      <Text>
        <Text bold color="cyan">
          xpssh
        </Text>
        <Text dimColor> v{VERSION}</Text>
      </Text>
      <Text dimColor>
        {state.profiles.length} profile{state.profiles.length === 1 ? "" : "s"} · {tested} tested
      </Text>
    </Box>
  );
}
