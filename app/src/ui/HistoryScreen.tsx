import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { AresState } from "../state.js";
import { statusColor, statusGlyph, theme, SELECT_MARKER } from "../theme.js";

const PAGE = 12;

export function HistoryScreen({ state, active }: { state: AresState; active: boolean }) {
  const jobs = [...state.applied].reverse(); // newest first
  const [cursor, setCursor] = useState(0);
  const [offset, setOffset] = useState(0);

  const clampCursor = (c: number) => Math.max(0, Math.min(jobs.length - 1, c));
  const maxOffset = Math.max(0, jobs.length - PAGE);

  useEffect(() => {
    setCursor((current) => clampCursor(current));
    setOffset((current) => Math.min(current, maxOffset));
  }, [jobs.length, maxOffset]);

  useInput(
    (input, key) => {
      if (key.downArrow || input === "j") {
        setCursor((c) => {
          const next = clampCursor(c + 1);
          setOffset((o) => (next >= o + PAGE ? Math.min(maxOffset, next - PAGE + 1) : o));
          return next;
        });
      }
      if (key.upArrow || input === "k") {
        setCursor((c) => {
          const next = clampCursor(c - 1);
          setOffset((o) => (next < o ? Math.max(0, o - 1) : o));
          return next;
        });
      }
    },
    { isActive: active && Boolean(process.stdin.isTTY) },
  );

  const selected = jobs[cursor];
  const page = jobs.slice(offset, offset + PAGE);

  return (
    <Box flexDirection="column">
      <Text bold color={theme.accent}>
        History{" "}
        <Text dimColor>
          ({jobs.length} outcomes, newest first)
        </Text>
      </Text>

      <Box flexDirection="column" marginTop={1}>
        {jobs.length === 0 ? (
          <Box flexDirection="column">
            <Text dimColor>{statusGlyph.needs_review} No applications recorded yet.</Text>
            <Text dimColor>Outcomes from agent runs appear here.</Text>
          </Box>
        ) : (
          page.map((job, i) => {
            const idx = offset + i;
            const marker = idx === cursor ? SELECT_MARKER : " ";
            const glyph = statusGlyph[job.status] ?? "•";
            const atsTail =
              typeof job.ats_score === "number" ? `  ats ${job.ats_score}` : "";
            // Selected row: one inverse string (monochrome accent — selection
            // is the dominant signal, glyph still carries status meaning).
            // Non-selected row: same character grid, status prefix colored,
            // date dimmed. Both share the exact same spacing so columns align.
            if (idx === cursor) {
              return (
                <Text key={`${job.job_id}-${idx}`} color={theme.accent} inverse wrap="truncate-end">
                  {`${marker} ${glyph} ${job.status.padEnd(13)} ${job.date_applied}  ${job.company} — ${job.title}${atsTail}`}
                </Text>
              );
            }
            return (
              <Text key={`${job.job_id}-${idx}`} wrap="truncate-end">
                {`${marker} `}
                <Text color={statusColor[job.status] ?? "white"}>{`${glyph} ${job.status.padEnd(13)}`}</Text>
                <Text dimColor>{` ${job.date_applied}  `}</Text>
                {`${job.company} — ${job.title}`}
                {atsTail ? <Text dimColor>{atsTail}</Text> : null}
              </Text>
            );
          })
        )}
      </Box>

      {selected ? (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>url  {selected.url}</Text>
          {selected.reasoning ? (
            <Text dimColor>why  {selected.reasoning}</Text>
          ) : null}
          {typeof selected.ats_score === "number" ? (
            <Text dimColor>ats  {selected.ats_score} · {selected.source ?? "?"} · {selected.resume_used ?? "?"}</Text>
          ) : null}
        </Box>
      ) : null}

      {jobs.length > PAGE ? (
        <Box marginTop={1}>
          <Text dimColor>
            rows {offset + 1}–{Math.min(offset + PAGE, jobs.length)} of {jobs.length} · ↑/↓ to navigate
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

export const HISTORY_HINTS = "↑/↓ navigate";
