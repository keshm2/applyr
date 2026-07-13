import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { loadState, isResolved, isDismissed, registryByJobId, hasAppliedOrFailed, todayIso } from "../state.js";
import type { ApplyrState, QueueEntry, AppliedJob } from "../state.js";
import { appendAppliedJob, recordEvent, syncInternshipTracker, openUrl, helperError } from "../helpers.js";
import { theme, statusGlyph, SELECT_MARKER } from "../theme.js";

interface Props {
  root: string;
  /** Only the focused tab receives keys (and never on piped stdin). */
  active: boolean;
  /** Incremented by the shell on global refresh so this screen reloads
   *  its internal state copy — without this, App "R" only updates App's
   *  own state and this screen stays stale. */
  refreshNonce?: number;
  /** Notify the shell that a mutation occurred so top-level badges refresh. */
  onStateChange?: () => void;
  /** Rows the shell hands this screen — the list grows/shrinks with it. */
  contentRows?: number;
}

/**
 * Review-queue triage. The queue file is append-only, so triage records
 * outcomes through the helpers (applied_jobs append + registry event) and
 * derives "resolved" instead of deleting entries.
 */
export function ReviewScreen({ root, active, refreshNonce, onStateChange, contentRows = 20 }: Props) {
  const [state, setState] = useState<ApplyrState>(() => loadState(root));
  const [cursor, setCursor] = useState(0);
  const [offset, setOffset] = useState(0);
  const [showResolved, setShowResolved] = useState(false);
  const [message, setMessage] = useState("");
  // Screen-internal chrome: title, selection details, message, pagination.
  const visible = Math.max(3, Math.min(30, contentRows - 8));

  const entries = useMemo(
    () => state.queue.filter((e) => showResolved || !isResolved(state, e)),
    [state, showResolved],
  );
  const selected: QueueEntry | undefined = entries[cursor];

  // Shell-level refresh (App "R" / tab switch) reloads this screen's
  // internal state copy — without this, App refresh only updates its own
  // state and this screen stays stale.
  useEffect(() => {
    setState(loadState(root));
  }, [root, refreshNonce]);

  // Post-render safety clamp: refresh()'s cursor clamp runs against the
  // stale pre-render `entries` closure, so a concurrent queue shrink of
  // more than one item can leave the cursor out of bounds and `selected`
  // undefined until the next keypress. Re-clamp here against the actual
  // current entries.length every render so the cursor is always valid.
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, entries.length - 1)));
  }, [entries.length]);

  // Keep the selected row visible when the queue is longer than the visible
  // window. The cursor may legitimately move outside the first page; this
  // window follows it so there is always a visible selection marker.
  useEffect(() => {
    const maxOffset = Math.max(0, entries.length - visible);
    setOffset((o) => {
      if (entries.length <= visible) return 0;
      if (cursor < o) return cursor;
      if (cursor >= o + visible) return Math.min(maxOffset, cursor - visible + 1);
      return Math.min(o, maxOffset);
    });
  }, [cursor, entries.length, visible]);

  const refresh = () => {
    const fresh = loadState(root);
    const freshEntries = fresh.queue.filter((e) => showResolved || !isResolved(fresh, e));
    setState(fresh);
    setCursor((c) => Math.max(0, Math.min(c, Math.max(0, freshEntries.length - 1))));
    onStateChange?.();
  };

  const markApplied = (entry: QueueEntry) => {
    const reg = registryByJobId(state.registry, entry.job_id);
    if (!reg?.job_key) {
      throw new Error(
        `Cannot mark applied: no registry record / job_key for "${entry.company} — ${entry.title}" (job_id=${entry.job_id}). Canonicalize the job first.`,
      );
    }
    const missing: string[] = [];
    if (!entry.job_id) missing.push("job_id");
    if (!entry.company) missing.push("company");
    if (!entry.title) missing.push("title");
    if (!entry.url) missing.push("url");
    if (!entry.role_type) missing.push("role_type");
    if (!entry.source) missing.push("source");
    if (!entry.resume_used) missing.push("resume_used");
    if (typeof entry.ats_score !== "number") missing.push("ats_score");
    if (!entry.location_tier) missing.push("location_tier");
    if (missing.length > 0) {
      throw new Error(
        `Cannot mark applied: missing required field(s) ${missing.join(", ")} for "${entry.company ?? entry.job_id}". Refusing to fabricate values.`,
      );
    }
    const reasoning = "Marked applied manually via TUI review-queue triage";
    const record: AppliedJob = {
      job_id: entry.job_id,
      company: entry.company,
      title: entry.title,
      url: entry.url,
      date_applied: todayIso(),
      status: "applied",
      role_type: entry.role_type,
      source: entry.source,
      resume_used: entry.resume_used,
      ats_score: entry.ats_score,
      location_tier: entry.location_tier,
      cover_letter_used: entry.cover_letter_used ?? false,
      reasoning,
    };
    // Append the applied_jobs entry first — it is the dedup set the agent
    // reads before every run, so it must be durable even if the event
    // write that follows fails. A missing event is recoverable; a missing
    // applied_jobs entry risks re-applying to the same job.
    appendAppliedJob(root, record);
    recordEvent(root, {
      job_key: reg.job_key,
      status: "applied",
      reasoning,
      company: entry.company,
      title: entry.title,
      url: entry.url,
    });
    // Best-effort Sheets sync — mirrors the agent path. Only the
    // user-facing tracker fields are sent; internal-only fields stay local.
    // A disabled/unconfigured/failed sync is a warning, not an error: the
    // application is already recorded above and must stand regardless.
    const sync = syncInternshipTracker(root, {
      company: entry.company,
      title: entry.title,
      date_applied: record.date_applied,
      internship_term: reg.internship_term,
    });
    const base = `Recorded applied: ${entry.company} — ${entry.title}`;
    setMessage(sync.synced ? `${base} (synced to tracker)` : `${base} — ${sync.message}`);
  };

  const dismiss = (entry: QueueEntry) => {
    const fresh = loadState(root);
    if (hasAppliedOrFailed(fresh, entry)) {
      setMessage(
        `Cannot dismiss: "${entry.company} — ${entry.title}" already has an applied/failed outcome; dismiss would overwrite it with skipped_unfit.`,
      );
      return;
    }
    if (isDismissed(fresh, entry)) {
      setMessage(`Already dismissed: "${entry.company} — ${entry.title}" is already marked skipped_unfit.`);
      return;
    }
    const reg = registryByJobId(fresh.registry, entry.job_id);
    if (!reg?.job_key) {
      setMessage("Cannot dismiss: no registry record for this job (no job_key to record against).");
      return;
    }
    recordEvent(root, {
      job_key: reg.job_key,
      status: "skipped_unfit",
      reasoning: "Dismissed by operator in TUI review-queue triage",
      company: entry.company,
      title: entry.title,
      url: entry.url,
    });
    setMessage(`Dismissed: ${entry.company} — ${entry.title}`);
  };

  useInput(
    (input, key) => {
      if (key.upArrow || input === "k") return setCursor((c) => Math.max(0, c - 1));
      if (key.downArrow || input === "j")
        return setCursor((c) => Math.min(entries.length - 1, c + 1));
      if (input === "x") return setShowResolved((s) => !s);
      if (!selected) {
        if (input === "o" || input === "a" || input === "d" || key.return) {
          setMessage("Queue is empty — nothing selected.");
        }
        return;
      }
      try {
        if (input === "o" || key.return) {
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
    },
    { isActive: active && Boolean(process.stdin.isTTY) },
  );

  const empty = entries.length === 0;
  const page = entries.slice(offset, offset + visible);

  return (
    <Box flexDirection="column">
      <Text bold color={theme.accent}>
        Review queue{" "}
        <Text dimColor>
          ({entries.length} {showResolved ? "total" : "pending"})
        </Text>
      </Text>

      <Box flexDirection="column" marginTop={1}>
        {empty ? (
          <Box flexDirection="column">
            <Text dimColor>{statusGlyph.applied} Nothing to review.</Text>
            <Text dimColor>Queue is empty{showResolved ? "" : " — new items appear as the agent runs"}.</Text>
          </Box>
        ) : (
          page.map((entry, i) => {
            const idx = offset + i;
            const resolved = isResolved(state, entry);
            const marker = idx === cursor ? SELECT_MARKER : " ";
            const glyph = resolved ? statusGlyph.applied : "•";
            const ats =
              typeof entry.ats_score === "number" ? `  ats ${entry.ats_score}` : "";
            const tail = resolved ? "  [resolved]" : "";
            const label = `${glyph} ${entry.company} — ${entry.title}${ats}${tail}`;
            return idx === cursor ? (
              <Text key={`${entry.job_id}-${idx}`} color={theme.accent} inverse wrap="truncate-end">
                {`${marker} ${label}`}
              </Text>
            ) : (
              <Text key={`${entry.job_id}-${idx}`} wrap="truncate-end">
                {`${marker} ${label}`}
              </Text>
            );
          })
        )}
      </Box>

      {selected ? (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>url  {selected.url}</Text>
          {selected.reasoning ? <Text dimColor>why  {selected.reasoning}</Text> : null}
        </Box>
      ) : null}

      {message ? (
        <Box marginTop={1}>
          <Text color={theme.warn}>{statusGlyph.needs_review} {message}</Text>
        </Box>
      ) : null}

      {!empty && entries.length > visible ? (
        <Box marginTop={1}>
          <Text dimColor>
            rows {offset + 1}–{Math.min(offset + visible, entries.length)} of {entries.length} · ↑/↓ to navigate
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

export const REVIEW_HINTS = "↑↓ select · enter/o open · a applied · d dismiss · x resolved";
