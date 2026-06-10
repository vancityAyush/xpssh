import { Box, Text } from "ink";
import { Spinner } from "@inkjs/ui";
import type { CommandEvent } from "../../commands/types.js";
import { useStore } from "../store.js";

const VISIBLE = 6;

function EventLine({ event }: { event: CommandEvent }) {
  if (event.type === "step") {
    const icon = event.status === "done" ? "✓" : event.status === "fail" ? "✗" : "·";
    const color = event.status === "done" ? "green" : event.status === "fail" ? "red" : undefined;
    return (
      <Text color={color} dimColor={event.status === "start"}>
        {icon} {event.label}
      </Text>
    );
  }
  const prefix = { success: "✓", error: "✗", warn: "!", info: " " }[event.type];
  const color = { success: "green", error: "red", warn: "yellow", info: undefined }[event.type];
  return (
    <Text color={color}>
      {prefix} {event.text}
    </Text>
  );
}

export function Transcript() {
  const { state } = useStore();
  const events = state.transcript.slice(-VISIBLE);
  if (events.length === 0 && !state.busy) return null;
  return (
    <Box flexDirection="column" paddingX={1} borderStyle="round" borderDimColor>
      {events.map((event, i) => (
        <EventLine key={state.transcript.length - events.length + i} event={event} />
      ))}
      {state.busy && <Spinner label="working…" />}
    </Box>
  );
}
