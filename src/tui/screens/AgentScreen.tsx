import { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { Select } from "@inkjs/ui";
import { realExec } from "../../services/exec.js";
import { getAgentStatus, type AgentStatus } from "../../services/agent.js";
import { useStore } from "../store.js";
import { useCommandDispatch } from "../dispatch.js";

export function AgentScreen() {
  const { state, dispatch } = useStore();
  const { runLine } = useCommandDispatch();
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const active = state.focusZone === "screen" && !state.prompt && !state.busy;

  useEffect(() => {
    void getAgentStatus(realExec).then(setStatus);
  }, [state.busy]); // refresh after any command finishes

  useInput(
    (_input, key) => {
      if (key.escape) dispatch({ type: "navigate", screen: "dashboard" });
    },
    { isActive: active },
  );

  return (
    <Box flexDirection="column" paddingX={1} gap={1}>
      <Text bold>
        ssh-agent:{" "}
        {status === null ? (
          <Text dimColor>checking…</Text>
        ) : status.running ? (
          <Text color="green">running · {status.keys.length} key(s)</Text>
        ) : (
          <Text color="red">not running</Text>
        )}
      </Text>

      {status?.running && status.keys.length > 0 && (
        <Box flexDirection="column">
          {status.keys.map((key) => (
            <Text key={key.fingerprint} dimColor>
              {key.bits} {key.type} {key.fingerprint} {key.comment}
            </Text>
          ))}
        </Box>
      )}

      <Select
        isDisabled={!active}
        options={[
          ...(status?.running === false ? [{ label: "▶ Start ssh-agent", value: "agent start" }] : []),
          ...state.profiles.map((p) => ({ label: `➕ Load ${p.id}`, value: `agent add ${p.id}` })),
          ...state.profiles.map((p) => ({ label: `➖ Unload ${p.id}`, value: `agent remove ${p.id}` })),
        ]}
        onChange={(line) => void runLine(line)}
      />
      <Text dimColor>esc to go back</Text>
    </Box>
  );
}
