import React, { useMemo, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { loadState, isResolved, registryByJobId, todayIso } from "../state.js";
import type { AresState, QueueEntry, AppliedJob } from "../state.js";
import { appendAppliedJob, recordEvent, openUrl, helperError } from "../helpers.js";

interface Props {
  root: string;
}

/**
 * Review-queue triage. The queue file is append-only, so triage records
 * outcomes through the helpers (applied_jobs append + registry event) and
 * derives "resolved" instead of deleting entries.
 */
export function ReviewScreen({ root }: Props) {
  const { exit } = useApp();
  const [state, setState] = useState<AresState>(() => loadState(root));
  const [cursor, setCursor] = useState(0);
  const [showResolved, setShowResolved] = useState(false);
  const [message, setMessage] = useState("");

  const entries = useMemo(
    () => state.queue.filter((e) => showResolved || !isResolved(state, e)),
    [state, showResolved],
  );
  const selected: QueueEntry | undefined = entries[cursor];

  const refresh = () => {
    setState(loadState(root));
    setCursor((c) => Math.max(0, Math.min(c, entries.length - 2)));
  };

  const markApplied = (entry: QueueEntry) => {
    const record: AppliedJob = {
      job_id: entry.job_id,
      company: entry.company,
      title: entry.title,
      url: entry.url,
      date_applied: todayIso(),
      status: "applied",
      role_type: entry.role_type ?? "internship",
      source: entry.source ?? "simplify",
      resume_used: entry.resume_used ?? "balanced",
      ats_score: entry.ats_score ?? 0,
      location_tier: entry.location_tier ?? "fallback",
      cover_letter_used: entry.cover_letter_used ?? false,
      reasoning: "Marked applied manually via TUI review-queue triage",
    };
    appendAppliedJob(root, record);
    const reg = registryByJobId(state.registry, entry.job_id);
    if (reg?.job_key) {
      recordEvent(root, {
        job_key: reg.job_key,
        status: "applied",
        reasoning: "Marked applied manually via TUI review-queue triage",
      });
    }
    setMessage(`Recorded applied: ${entry.company} — ${entry.title}`);
  };

  const dismiss = (entry: QueueEntry) => {
    const reg = registryByJobId(state.registry, entry.job_id);
    if (!reg?.job_key) {
      setMessage("Cannot dismiss: no registry record for this job (no job_key to record against).");
      return;
    }
    recordEvent(root, {
      job_key: reg.job_key,
      status: "skipped_unfit",
      reasoning: "Dismissed by operator in TUI review-queue triage",
    });
    setMessage(`Dismissed: ${entry.company} — ${entry.title}`);
  };

  useInput((input, key) => {
    if (input === "q" || key.escape) return exit();
    if (key.upArrow) return setCursor((c) => Math.max(0, c - 1));
    if (key.downArrow) return setCursor((c) => Math.min(entries.length - 1, c + 1));
    if (input === "x") return setShowResolved((s) => !s);
    if (!selected) return;
    try {
      if (input === "o") {
        openUrl(selected.url);
        setMessage(`Opened ${selected.url}`);
      } else if (input === "a") {
        markApplied(selected);
        refresh();
      } else if (input === "d") {
        dismiss(selected);
        refresh();
      }
    } catch (err) {
      setMessage(helperError(err));
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">
        Ares — review queue ({entries.length} {showResolved ? "total" : "pending"})
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {entries.length === 0 ? (
          <Text dimColor>Nothing to review.</Text>
        ) : (
          entries.slice(0, 15).map((entry, i) => {
            const resolved = isResolved(state, entry);
            return (
              <Text key={`${entry.job_id}-${i}`} inverse={i === cursor}>
                {resolved ? "✓ " : "• "}
                {entry.company} — {entry.title}
                {typeof entry.ats_score === "number" ? ` (ats ${entry.ats_score})` : ""}
                {resolved ? "  [resolved]" : ""}
              </Text>
            );
          })
        )}
      </Box>
      {selected ? (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>{selected.url}</Text>
          {selected.reasoning ? <Text dimColor>why: {selected.reasoning}</Text> : null}
        </Box>
      ) : null}
      {message ? (
        <Box marginTop={1}>
          <Text color="yellow">{message}</Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text dimColor>↑/↓ select · o open · a mark applied · d dismiss · x show resolved · q quit</Text>
      </Box>
    </Box>
  );
}
