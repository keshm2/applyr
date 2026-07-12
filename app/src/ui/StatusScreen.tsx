import React from "react";
import { Box, Text } from "ink";
import type { AresState } from "../state.js";

interface Props {
  state: AresState;
  lastRun: string;
  sessionLog?: string;
  unresolvedQueue: number;
}

export function StatusScreen({ state, lastRun, sessionLog, unresolvedQueue }: Props) {
  const counts = { applied: 0, needs_review: 0, failed: 0 };
  for (const job of state.applied) {
    if (job.status in counts) counts[job.status as keyof typeof counts] += 1;
  }
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">
        Ares — status
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text>
          Applied <Text color="green">{counts.applied}</Text> · Needs review{" "}
          <Text color="yellow">{counts.needs_review}</Text> · Failed{" "}
          <Text color="red">{counts.failed}</Text>
        </Text>
        <Text>
          Review queue: <Text color="yellow">{unresolvedQueue}</Text> pending · Registry:{" "}
          {state.registry.length} jobs seen
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Last run: {lastRun}</Text>
        {sessionLog ? <Text dimColor>Latest session log: {sessionLog}</Text> : null}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          Commands: ares run · ares review · ares history · ares setup [--check]
        </Text>
      </Box>
    </Box>
  );
}
