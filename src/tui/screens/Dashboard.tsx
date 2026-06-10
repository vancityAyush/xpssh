import { Box, Text } from "ink";
import { Select } from "@inkjs/ui";
import { useStore } from "../store.js";
import { useCommandDispatch } from "../dispatch.js";
import { ProfileRow } from "../components/ProfileRow.js";

export function Dashboard() {
  const { state, dispatch } = useStore();
  const { runLine } = useCommandDispatch();
  const active = state.focusZone === "screen" && !state.prompt && !state.busy;

  return (
    <Box flexDirection="column" gap={1} paddingX={1}>
      {state.profiles.length > 0 ? (
        <Box flexDirection="column">
          {state.profiles.map((profile) => (
            <ProfileRow key={profile.id} profile={profile} />
          ))}
        </Box>
      ) : (
        <Text dimColor>No SSH profiles yet — set one up below.</Text>
      )}

      <Select
        isDisabled={!active}
        options={[
          { label: "➕ Setup a new SSH key", value: "setup" },
          { label: "🗂  Manage keys", value: "keys" },
          { label: "🔌 Test all connections", value: "test --all" },
          { label: "❓ Help", value: "help" },
        ]}
        onChange={(value) => {
          if (value === "keys") dispatch({ type: "navigate", screen: "keys" });
          else if (value === "help") dispatch({ type: "navigate", screen: "help" });
          else void runLine(value);
        }}
      />
    </Box>
  );
}
