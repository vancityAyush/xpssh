import { useState } from "react";
import { Box, Text } from "ink";
import { ConfirmInput, Select } from "@inkjs/ui";
import TextInput from "ink-text-input";
import { useStore } from "../store.js";

/** Renders whatever prompt a running command is waiting on. Mounted above the command bar. */
export function PromptOverlay() {
  const { state } = useStore();
  const prompt = state.prompt;
  const [text, setText] = useState("");

  if (!prompt) return null;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text bold>{prompt.message}</Text>
      {prompt.kind === "confirm" && (
        <ConfirmInput onConfirm={() => prompt.resolve(true)} onCancel={() => prompt.resolve(false)} />
      )}
      {(prompt.kind === "text" || prompt.kind === "secret") && (
        <Box>
          <Text color="yellow">→ </Text>
          <TextInput
            value={text}
            onChange={setText}
            onSubmit={(answer) => {
              setText("");
              prompt.resolve(answer || ("defaultValue" in prompt ? (prompt.defaultValue ?? "") : ""));
            }}
            mask={prompt.kind === "secret" ? "*" : undefined}
            placeholder={"defaultValue" in prompt ? prompt.defaultValue : undefined}
            focus
          />
        </Box>
      )}
      {prompt.kind === "select" && (
        <Select
          options={prompt.choices.map((choice, i) => ({ label: choice.label, value: String(i) }))}
          onChange={(index) => prompt.resolve(prompt.choices[Number(index)]!.value)}
        />
      )}
    </Box>
  );
}
