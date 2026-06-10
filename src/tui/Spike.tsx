import { useState } from "react";
import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import { Select, Badge, StatusMessage, Spinner } from "@inkjs/ui";
import TextInput from "ink-text-input";

/**
 * Phase 0 spike: validates the exact widget mix xpssh will use
 * (Box/Text layout, Select, Badge, StatusMessage, Spinner, controlled
 * ink-text-input, focus switching, useWindowSize) under alternateScreen.
 * Replaced by the real App in Phase 4.
 */
export function Spike() {
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();
  const [zone, setZone] = useState<"screen" | "bar">("screen");
  const [command, setCommand] = useState("");
  const [lastAction, setLastAction] = useState<string | null>(null);

  useInput(
    (input, key) => {
      if (input === "/") setZone("bar");
      if (input === "q") exit();
      if (key.escape) exit();
    },
    { isActive: zone === "screen" },
  );

  useInput(
    (_input, key) => {
      if (key.escape) {
        setZone("screen");
        setCommand("");
      }
    },
    { isActive: zone === "bar" },
  );

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Box borderStyle="round" paddingX={1} justifyContent="space-between">
        <Text bold color="cyan">
          xpssh spike
        </Text>
        <Text dimColor>
          {columns}×{rows}
        </Text>
      </Box>

      <Box flexDirection="column" flexGrow={1} paddingX={1} gap={1}>
        <Box gap={1}>
          <Badge color="green">github · personal</Badge>
          <Badge color="yellow">azure · work</Badge>
        </Box>

        <Select
          isDisabled={zone !== "screen"}
          options={[
            { label: "Setup new SSH key", value: "setup" },
            { label: "Manage keys", value: "keys" },
            { label: "Test connections", value: "test" },
          ]}
          onChange={(value) => setLastAction(value)}
        />

        {lastAction && <StatusMessage variant="success">selected: {lastAction}</StatusMessage>}
        <Spinner label="widget check" />
      </Box>

      <Box borderStyle="round" paddingX={1}>
        <Text color="cyan">❯ </Text>
        <TextInput
          value={command}
          onChange={setCommand}
          onSubmit={(value) => {
            setLastAction(`command: ${value}`);
            setCommand("");
            setZone("screen");
          }}
          focus={zone === "bar"}
          placeholder="press / to type a command"
        />
      </Box>
      <Text dimColor> / command · q or esc quit · zone: {zone}</Text>
    </Box>
  );
}
