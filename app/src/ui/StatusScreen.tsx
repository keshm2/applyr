import React from "react";
import { Box, Text } from "ink";
import type { AresState, Heartbeat } from "../state.js";
import { theme, statusGlyph } from "../theme.js";

interface Props {
  state: AresState;
  lastRun: string;
  sessionLog?: string;
  unresolvedQueue: number;
  heartbeat?: Heartbeat;
  /** Inside the persistent app the shell owns the title and hints. */
  embedded?: boolean;
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Box>
      <Text dimColor>{label.padEnd(13)}</Text>
      <Text bold color={color}>
        {value}
      </Text>
    </Box>
  );
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
  const healthy = heartbeat ? heartbeat.last_run_exit_code === 0 : null;
  return (
    <Box flexDirection="column" paddingX={embedded ? 0 : 1}>
      {embedded ? (
        <Text bold color={theme.accent}>
          Status
        </Text>
      ) : (
        <Text bold color={theme.accent}>
          Ares — status
        </Text>
      )}

      {/* Outcomes */}
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Outcomes</Text>
        <Box flexDirection="column" marginTop={1}>
          <Stat
            label="Applied"
            value={`${statusGlyph.applied} ${counts.applied}`}
            color={theme.good}
          />
          <Stat
            label="Needs review"
            value={`${statusGlyph.needs_review} ${counts.needs_review}`}
            color={theme.warn}
          />
          <Stat
            label="Failed"
            value={`${statusGlyph.failed} ${counts.failed}`}
            color={theme.danger}
          />
        </Box>
      </Box>

      {/* Pipeline */}
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Pipeline</Text>
        <Box flexDirection="column" marginTop={1}>
          <Stat label="Review queue" value={`${unresolvedQueue} pending`} color={unresolvedQueue > 0 ? theme.warn : undefined} />
          <Stat label="Registry" value={`${state.registry.length} jobs seen`} />
        </Box>
      </Box>

      {/* Scheduler heartbeat */}
      {heartbeat ? (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Scheduler</Text>
          <Box marginTop={1}>
            <Text dimColor>{"Health".padEnd(13)}</Text>
            {healthy ? (
              <Text bold color={theme.good}>
                {statusGlyph.applied} healthy
              </Text>
            ) : (
              <Text bold color={theme.danger}>
                {statusGlyph.failed} exit {heartbeat.last_run_exit_code} ·{" "}
                {heartbeat.consecutive_nonzero_exits} consecutive
              </Text>
            )}
          </Box>
          <Text dimColor>run #{heartbeat.run_counter} at {heartbeat.last_run_completed_at}</Text>
        </Box>
      ) : null}

      {/* Last run footer */}
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Last run: {lastRun}</Text>
        {sessionLog ? <Text dimColor>Session log: {sessionLog}</Text> : null}
      </Box>

      {embedded ? null : (
        <Box marginTop={1}>
          <Text dimColor>Open the app with: ares (screens: status · jobs · review · history)</Text>
        </Box>
      )}
    </Box>
  );
}
