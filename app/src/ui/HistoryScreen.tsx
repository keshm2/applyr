import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { AresState } from "../state.js";
import { statusColor } from "../theme.js";

const PAGE = 12;

export function HistoryScreen({ state, active }: { state: AresState; active: boolean }) {
  const jobs = [...state.applied].reverse(); // newest first
  const [offset, setOffset] = useState(0);

  useInput(
    (input, key) => {
      if (key.downArrow || input === "j")
        setOffset((o) => Math.min(Math.max(0, jobs.length - PAGE), o + 1));
      if (key.upArrow || input === "k") setOffset((o) => Math.max(0, o - 1));
    },
    { isActive: active && Boolean(process.stdin.isTTY) },
  );

  return (
    <Box flexDirection="column">
      <Text bold>
        History <Text dimColor>({jobs.length} outcomes, newest first)</Text>
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {jobs.length === 0 ? (
          <Text dimColor>No applications recorded yet.</Text>
        ) : (
          jobs.slice(offset, offset + PAGE).map((job, i) => (
            <Text key={`${job.job_id}-${offset + i}`}>
              <Text color={statusColor[job.status] ?? "white"}>{job.status.padEnd(14)}</Text>
              <Text dimColor>{job.date_applied}</Text>
              {"  "}
              {job.company} — {job.title}
              {typeof job.ats_score === "number" ? (
                <Text dimColor>{`  (ats ${job.ats_score})`}</Text>
              ) : null}
            </Text>
          ))
        )}
      </Box>
    </Box>
  );
}

export const HISTORY_HINTS = "↑/↓ scroll";
