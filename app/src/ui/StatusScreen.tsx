import React from "react";
import { Box, Text } from "ink";
import type { AresState, Heartbeat } from "../state.js";
import { theme } from "../theme.js";

interface Props {
  state: AresState;
  lastRun: string;
  sessionLog?: string;
  unresolvedQueue: number;
  heartbeat?: Heartbeat;
  /** Inside the persistent app the shell owns the title and hints. */
  embedded?: boolean;
}

export function StatusScreen({
  state,
  lastRun,
  sessionLog,
  unresolvedQueue,
  heartbeat,
  embedded,
}: Props) {
  const counts = { applied: 0, needs_review: 0, failed: 0 };
  for (const job of state.applied) {
    if (job.status in counts) counts[job.status as keyof typeof counts] += 1;
  }
  return (
    <Box flexDirection="column" paddingX={embedded ? 0 : 1}>
      {embedded ? (
        <Text bold>Status</Text>
      ) : (
        <Text bold color={theme.accent}>
          Ares — status
        </Text>
      )}
      <Box marginTop={1} flexDirection="column">
        <Text>
          Applied <Text color={theme.good}>{counts.applied}</Text> · Needs review{" "}
          <Text color={theme.warn}>{counts.needs_review}</Text> · Failed{" "}
          <Text color={theme.danger}>{counts.failed}</Text>
        </Text>
        <Text>
          Review queue: <Text color={theme.warn}>{unresolvedQueue}</Text> pending · Registry:{" "}
          {state.registry.length} jobs seen
        </Text>
      </Box>
      {heartbeat ? (
        <Box marginTop={1} flexDirection="column">
          <Text>
            Scheduler heartbeat:{" "}
            {heartbeat.last_run_exit_code === 0 ? (
              <Text color={theme.good}>✓ healthy</Text>
            ) : (
              <Text color={theme.danger}>
                ✗ last exit {heartbeat.last_run_exit_code} ({heartbeat.consecutive_nonzero_exits}{" "}
                consecutive)
              </Text>
            )}{" "}
            <Text dimColor>
              run #{heartbeat.run_counter} at {heartbeat.last_run_completed_at}
            </Text>
          </Text>
        </Box>
      ) : null}
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Last run: {lastRun}</Text>
        {sessionLog ? <Text dimColor>Latest session log: {sessionLog}</Text> : null}
      </Box>
      {embedded ? null : (
        <Box marginTop={1}>
          <Text dimColor>Open the app with: ares (screens: status · review · history · run)</Text>
        </Box>
      )}
    </Box>
  );
}
