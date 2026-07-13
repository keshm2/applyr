import React from "react";
import { Box, Text } from "ink";
import type { Heartbeat } from "../state.js";
import { theme } from "../theme.js";

function DetailRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Box>
      <Text dimColor>{label.padEnd(14)}</Text>
      <Text color={color} bold={Boolean(color)} wrap="truncate-end">
        {value}
      </Text>
    </Box>
  );
}

export interface WelcomeOption {
  label: string;
  description: string;
}

/**
 * Launch surface on every plain `applyr` run. It is an actual menu,
 * not a splash screen, so the first interaction can be "take me where
 * I want to go" instead of "dismiss this and remember hotkeys".
 */
export function WelcomeScreen({
  contentRows,
  columns,
  options,
  cursor,
  counts,
  unresolvedQueue,
  registryCount,
  heartbeat,
  lastRun,
}: {
  contentRows: number;
  columns: number;
  options: WelcomeOption[];
  cursor: number;
  counts: { applied: number; needsReview: number; failed: number };
  unresolvedQueue: number;
  registryCount: number;
  heartbeat?: Heartbeat;
  lastRun: string;
}) {
  const selected = options[cursor] ?? options[0];
  const wide = columns >= 104 && contentRows >= 18;
  const showLastRun = contentRows >= 16;
  const health = heartbeat
    ? heartbeat.last_run_exit_code === 0
      ? { label: "healthy", color: theme.good }
      : { label: `exit ${heartbeat.last_run_exit_code}`, color: theme.danger }
    : { label: "not installed", color: undefined };

  return (
    <Box flexDirection="column">
      <Text bold color={theme.accent}>
        Welcome to applyr
      </Text>
      <Box marginTop={1}>
        <Text wrap="wrap">
          Choose what you want to do first. Manual browsing, automatic runs,
          review triage, and history all land in the same local record.
        </Text>
      </Box>

      <Box marginTop={1} flexDirection={wide ? "row" : "column"}>
        <Box flexDirection="column" marginRight={wide ? 4 : 0} width={wide ? 44 : undefined}>
          <Text dimColor>Start here</Text>
          <Box marginTop={1} flexDirection="column">
            {options.map((option, index) => {
              const focused = index === cursor;
              return (
                <Text key={option.label} color={focused ? theme.accent : undefined} bold={focused}>
                  {focused ? ">" : " "} [{focused ? "x" : " "}] {option.label}
                </Text>
              );
            })}
          </Box>
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>Selected</Text>
            <Text wrap="wrap">{selected.description}</Text>
          </Box>
        </Box>

        <Box flexDirection="column" marginTop={wide ? 0 : 1}>
          <Text dimColor>Current state</Text>
          <Box marginTop={1} flexDirection="column">
            <DetailRow label="Applied" value={String(counts.applied)} color={theme.good} />
            <DetailRow label="Needs review" value={String(counts.needsReview)} color={theme.warn} />
            <DetailRow label="Failed" value={String(counts.failed)} color={theme.danger} />
            <DetailRow label="Queue" value={`${unresolvedQueue} pending`} color={unresolvedQueue > 0 ? theme.warn : undefined} />
            <DetailRow label="Registry" value={`${registryCount} jobs seen`} />
            <DetailRow label="Scheduler" value={health.label} color={health.color} />
          </Box>
          {showLastRun ? (
            <Box marginTop={1} flexDirection="column">
              <Text dimColor>Last run</Text>
              <Text wrap="truncate-end">{lastRun}</Text>
            </Box>
          ) : null}
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Use ↑/↓, j/k, or tab to move. Enter opens the selected page.</Text>
      </Box>
    </Box>
  );
}
