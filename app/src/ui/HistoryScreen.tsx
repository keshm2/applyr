import React, { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { AresState } from "../state.js";

const PAGE = 15;

const STATUS_COLOR: Record<string, string> = {
  applied: "green",
  needs_review: "yellow",
  failed: "red",
};

export function HistoryScreen({ state }: { state: AresState }) {
  const { exit } = useApp();
  const jobs = [...state.applied].reverse(); // newest first
  const [offset, setOffset] = useState(0);

  useInput((input, key) => {
    if (input === "q" || key.escape) return exit();
    if (key.downArrow) setOffset((o) => Math.min(Math.max(0, jobs.length - PAGE), o + 1));
    if (key.upArrow) setOffset((o) => Math.max(0, o - 1));
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">
        Ares — history ({jobs.length} outcomes, newest first)
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {jobs.length === 0 ? (
          <Text dimColor>No applications recorded yet.</Text>
        ) : (
          jobs.slice(offset, offset + PAGE).map((job, i) => (
            <Text key={`${job.job_id}-${offset + i}`}>
              <Text color={STATUS_COLOR[job.status] ?? "white"}>
                {job.status.padEnd(14)}
              </Text>
              {job.date_applied}  {job.company} — {job.title}
              {typeof job.ats_score === "number" ? ` (ats ${job.ats_score})` : ""}
            </Text>
          ))
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑/↓ scroll · q quit</Text>
      </Box>
    </Box>
  );
}
