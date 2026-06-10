import { Box, Text } from "ink";
import { Badge } from "@inkjs/ui";
import type { ProfileRow as Row } from "../../commands/list.js";

export function ProfileRow({ profile }: { profile: Row }) {
  const status = !profile.keyExists
    ? { color: "red" as const, label: "key missing" }
    : profile.lastTest
      ? profile.lastTest.ok
        ? { color: "green" as const, label: "tested" }
        : { color: "red" as const, label: "failed" }
      : { color: "yellow" as const, label: "untested" };

  return (
    <Box gap={1}>
      <Box width={22}>
        <Text bold>{profile.id}</Text>
        {profile.isDefault && <Text dimColor> ★</Text>}
      </Box>
      <Box width={10}>
        <Badge color={status.color}>{status.label}</Badge>
      </Box>
      <Box width={26}>
        <Text dimColor>{profile.email}</Text>
      </Box>
      <Text dimColor>{profile.clonePrefix}owner/repo.git</Text>
    </Box>
  );
}
