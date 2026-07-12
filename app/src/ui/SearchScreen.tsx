import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { openUrl } from "../helpers.js";
import {
  checkJobFit,
  errorMessage,
  saveJobForReview,
  searchJobs,
  type FitResult,
  type JobSource,
  type SearchJob,
  type SourceResult,
} from "../jobs.js";
import { SELECT_MARKER, statusGlyph, theme } from "../theme.js";

const SOURCE_LABEL: Record<JobSource, string> = {
  ashbyhq: "Ashby",
  lever: "Lever",
  workday: "Workday",
};

type Action = "idle" | "searching" | "fitting" | "saving";

export function SearchScreen({
  root,
  active,
  onInputActiveChange,
  onStateChange,
  rows,
}: {
  root: string;
  active: boolean;
  onInputActiveChange: (active: boolean) => void;
  onStateChange: () => void;
  rows: number;
}) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(true);
  const [action, setAction] = useState<Action>("idle");
  const [jobs, setJobs] = useState<SearchJob[]>([]);
  const [sources, setSources] = useState<Partial<Record<JobSource, SourceResult>>>({});
  const [cursor, setCursor] = useState(0);
  const [offset, setOffset] = useState(0);
  const [message, setMessage] = useState("Type a title query and press enter to search live boards.");
  const [fits, setFits] = useState<Record<string, FitResult>>({});
  const visible = Math.max(2, Math.min(9, rows - 20));

  const busy = action !== "idle";
  const capturesInput = active && editing && !busy;
  useEffect(() => {
    onInputActiveChange(capturesInput);
    return () => onInputActiveChange(false);
  }, [capturesInput, onInputActiveChange]);

  useEffect(() => {
    const next = Math.max(0, Math.min(jobs.length - 1, cursor));
    if (next !== cursor) setCursor(next);
    const maxOffset = Math.max(0, jobs.length - visible);
    if (offset > maxOffset) setOffset(maxOffset);
  }, [cursor, jobs.length, offset, visible]);

  const move = (delta: number) => {
    const next = Math.max(0, Math.min(jobs.length - 1, cursor + delta));
    setCursor(next);
    setOffset((current) => {
      if (next < current) return next;
      if (next >= current + visible) return next - visible + 1;
      return current;
    });
  };

  const search = async () => {
    setEditing(false);
    setAction("searching");
    setMessage("Fetching configured Ashby, Lever, and Workday sources…");
    try {
      const result = await searchJobs(root, query.trim());
      setJobs(result.jobs);
      setSources(result.sources);
      setCursor(0);
      setOffset(0);
      setMessage(result.jobs.length === 0 ? "No matching titles found. Press / to refine the query." : `${result.jobs.length} matching postings`);
    } catch (err) {
      setMessage(`Search failed: ${errorMessage(err)}`);
    } finally {
      setAction("idle");
    }
  };

  const fit = async (job: SearchJob) => {
    setAction("fitting");
    setMessage(`Running deterministic fit gate for ${job.title}…`);
    try {
      const result = await checkJobFit(root, job);
      setFits((current) => ({ ...current, [job.url]: result }));
      setMessage(result.reasoning);
    } catch (err) {
      setMessage(`Fit check failed: ${errorMessage(err)}`);
    } finally {
      setAction("idle");
    }
  };

  const save = async (job: SearchJob) => {
    setAction("saving");
    setMessage(`Saving ${job.title} to review…`);
    try {
      const result = await saveJobForReview(root, job);
      setMessage(result === "saved" ? "Saved to review queue." : "Already saved; no duplicate records written.");
      if (result === "saved") onStateChange();
    } catch (err) {
      setMessage(`Save failed: ${errorMessage(err)}`);
    } finally {
      setAction("idle");
    }
  };

  useInput(
    (input, key) => {
      if (editing) {
        if (key.return) void search();
        else if (key.escape) setEditing(false);
        else if (key.backspace || key.delete) setQuery((value) => value.slice(0, -1));
        else if (!key.ctrl && !key.meta && input && !/\p{C}/u.test(input)) setQuery((value) => value + input);
        return;
      }
      if (busy) return;
      if (input === "/") return setEditing(true);
      if (key.downArrow || input === "j") return move(1);
      if (key.upArrow || input === "k") return move(-1);
      const selected = jobs[cursor];
      if (!selected) return;
      if (input === "o") {
        try {
          openUrl(selected.apply_url || selected.url);
          setMessage("Opened posting in your browser.");
        } catch (err) {
          setMessage(`Could not open browser: ${errorMessage(err)}`);
        }
      }
      if (input === "f") void fit(selected);
      if (input === "s") void save(selected);
    },
    { isActive: active && Boolean(process.stdin.isTTY) },
  );

  const selected = jobs[cursor];
  const selectedFit = selected ? fits[selected.url] : undefined;
  const page = jobs.slice(offset, offset + visible);

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color={theme.accent}>Jobs </Text><Text dimColor>manual search · query </Text>
        <Text color={editing ? theme.accent : undefined} inverse={editing}>{query || "type a job title"}</Text>
        {editing ? <Text color={theme.accent}>▏</Text> : null}
      </Box>
      <Box>
        {(["ashbyhq", "lever", "workday"] as JobSource[]).map((source) => (
          <Box key={source} marginRight={2}>
            <Text dimColor>{SOURCE_LABEL[source]} </Text>
            <SourceBadge result={sources[source]} loading={action === "searching"} />
          </Box>
        ))}
      </Box>
      <Box flexDirection="column">
        {page.map((job, index) => {
          const absolute = offset + index;
          const fitResult = fits[job.url];
          const fitTail = fitResult ? `  ${fitResult.fit_status} ${fitResult.fit_score}` : "";
          const line = `${absolute === cursor ? SELECT_MARKER : " "} ${job.company.padEnd(15)} ${job.title}${fitTail}`;
          return absolute === cursor ? (
            <Text key={job.url} color={theme.accent} inverse wrap="truncate-end">{line}</Text>
          ) : (
            <Text key={job.url} wrap="truncate-end">{line}</Text>
          );
        })}
      </Box>
      {selected ? (
        <Box flexDirection="column">
          <Text dimColor wrap="truncate-end">{selected.source} · {selected.location || "location not listed"} · {selected.apply_url || selected.url}</Text>
          {selectedFit ? (
            <Text color={selectedFit.fit_status === "candidate" ? theme.good : selectedFit.fit_status === "needs_review" ? theme.warn : theme.danger} wrap="truncate-end">
              {selectedFit.fit_status} · score {selectedFit.fit_score} · {selectedFit.reasoning}
            </Text>
          ) : null}
        </Box>
      ) : null}
      <Box>
        <Text color={message.startsWith("Search failed") || message.startsWith("Fit check failed") || message.startsWith("Save failed") ? theme.danger : undefined} dimColor={!busy && !message.startsWith("Saved")} wrap="truncate-end">
          {busy ? "● " : ""}{message}
        </Text>
      </Box>
    </Box>
  );
}

function SourceBadge({ result, loading }: { result?: SourceResult; loading: boolean }) {
  if (loading) return <Text color={theme.accent}>● loading</Text>;
  if (!result) return <Text dimColor>–</Text>;
  if (result.state === "warning") return <Text color={theme.warn}>{statusGlyph.needs_review} {result.detail}</Text>;
  if (result.state === "skipped") return <Text dimColor>– off</Text>;
  return <Text color={theme.good}>{statusGlyph.applied} {result.count}</Text>;
}

export const SEARCH_HINTS = "/ query · ↑↓ move · o open · f fit · s save";
