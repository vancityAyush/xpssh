import { Box, Text } from "ink";
import { Spinner } from "@inkjs/ui";

export type StepStatus = "pending" | "running" | "done" | "failed";

export interface StepRow {
  id: string;
  label: string;
  status: StepStatus;
}

export function StepList({ steps }: { steps: StepRow[] }) {
  return (
    <Box flexDirection="column">
      {steps.map((step) => (
        <Box key={step.id} gap={1}>
          {step.status === "running" ? (
            <Spinner label={step.label} />
          ) : (
            <Text
              color={step.status === "done" ? "green" : step.status === "failed" ? "red" : undefined}
              dimColor={step.status === "pending"}
            >
              {step.status === "done" ? "✓" : step.status === "failed" ? "✗" : "○"} {step.label}
            </Text>
          )}
        </Box>
      ))}
    </Box>
  );
}
