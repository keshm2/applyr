import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { latestSessionLog, readHeartbeat } from "../state.js";
import { py } from "../platform.js";
import { theme, statusGlyph, capTier } from "../theme.js";
import { RainbowText } from "./KeyHints.js";
import {
  InlineTextInput,
  deleteBackward,
  insertAtCursor,
  moveCursorLeft,
  moveCursorRight,
} from "./TextInput.js";

// Keep a deep buffer; how many lines actually render is derived from the
// live terminal height so the log fills the content region.
const TAIL_BUFFER = 200;
const GAUGE_WIDTH = 14;
const PROMPT_MAX = 500;

type Phase = "idle" | "running" | "done";

/**
 * Trigger a run without leaving the app: spawns run_job_agent.py and
 * tails the session log into the content region. The script owns
 * locking, validation, and the harness invocation.
 *
 * Two typed inputs, both opt-in (never captured on mount): `e` sets the
 * per-cycle application cap (1–25, tier-colored, MAX warns loudly), and
 * `p` sets an optional extra instruction the orchestrator receives via
 * APPLYR_EXTRA_PROMPT — leave it empty to run the standard workflow.
 */
export function RunScreen({
  root,
  active,
  onInputActiveChange,
  onRunningChange,
  contentRows = 20,
}: {
  root: string;
  active: boolean;
  onInputActiveChange: (active: boolean) => void;
  onRunningChange: (running: boolean) => void;
  /** Rows the shell hands this screen — the log tail fills them. */
  contentRows?: number;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [countInput, setCountInput] = useState("");
  const [countCursor, setCountCursor] = useState(0);
  const [sessionCap, setSessionCap] = useState<number | null>(null);
  // Browse mode first: entering automatic mode must never steal the
  // keyboard — typing starts only when the user presses e or p.
  const [editingCount, setEditingCount] = useState(false);
  const [promptInput, setPromptInput] = useState("");
  const [promptCursor, setPromptCursor] = useState(0);
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [inputMessage, setInputMessage] = useState("Press e to set this cycle's application cap (1–25).");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const child = useRef<ChildProcess | null>(null);
  const logBefore = useRef<string | undefined>(undefined);

  // Elapsed-run clock — ticks only while a run is live.
  useEffect(() => {
    if (phase !== "running" || startedAt === null) return;
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [phase, startedAt]);

  const editing = editingCount || editingPrompt;

  useEffect(() => {
    const capturesInput = active && editing && phase !== "running";
    onInputActiveChange(capturesInput);
    return () => onInputActiveChange(false);
  }, [active, editing, onInputActiveChange, phase]);

  useEffect(() => {
    onRunningChange(phase === "running");
    return () => onRunningChange(false);
  }, [onRunningChange, phase]);

  const commitCount = (): number | null => {
    if (!countInput) {
      setInputMessage("Type a count from 1 to 25 first, then press enter.");
      return null;
    }
    const cap = Math.max(1, Math.min(25, Number.parseInt(countInput, 10)));
    setCountInput(String(cap));
    setCountCursor(String(cap).length);
    setSessionCap(cap);
    setEditingCount(false);
    setInputMessage(
      cap === 25
        ? "MAX cap set — press s to start anyway, or e to lower it."
        : `Ready — press s to start with a ${cap}-application cap.`,
    );
    return cap;
  };

  const start = (capOverride?: number) => {
    const cap = capOverride ?? sessionCap;
    if (phase === "running" || cap === null) return;
    logBefore.current = latestSessionLog(root);
    setLines([]);
    setExitCode(null);
    setStartedAt(Date.now());
    setElapsed(0);
    setPhase("running");
    const extraPrompt = promptInput.trim();
    const runner = py(["scripts/runtime/run_job_agent.py"]);
    const proc = spawn(runner.cmd, runner.args, {
      cwd: root,
      // APPLYR_SESSION_CAP is the documented name; the legacy ARES_* name
      // is still set so an un-migrated runner copy honors the cap too.
      env: {
        ...process.env,
        APPLYR_SESSION_CAP: String(cap),
        ARES_SESSION_CAP: String(cap),
        ...(extraPrompt ? { APPLYR_EXTRA_PROMPT: extraPrompt } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.current = proc;
    const push = (chunk: Buffer) =>
      setLines((prev) => [...prev, ...chunk.toString().split("\n").filter(Boolean)].slice(-TAIL_BUFFER));
    proc.stdout?.on("data", push);
    proc.stderr?.on("data", push);
    proc.on("error", (err) => {
      setLines([`could not start runner: ${err.message}`]);
      setExitCode(1);
      setPhase("done");
    });
    proc.on("close", (code) => {
      setExitCode(code ?? 1);
      setPhase("done");
    });
  };

  // While running, tail the new session log (the transcript goes to a
  // file, not stdout).
  useEffect(() => {
    if (phase !== "running") return;
    const poll = setInterval(() => {
      const current = latestSessionLog(root);
      if (current && current !== logBefore.current && fs.existsSync(current)) {
        try {
          const content = fs.readFileSync(current, "utf8").trimEnd().split("\n");
          setLines(content.slice(-TAIL_BUFFER));
        } catch {
          /* transient read race — next tick */
        }
      }
    }, 1000);
    return () => clearInterval(poll);
  }, [phase, root]);

  useInput(
    (input, key) => {
      if (editingCount && phase !== "running") {
        if (key.return) commitCount();
        else if (input === "s") {
          // s while typing commits the typed count and starts immediately —
          // otherwise s is a silently dead key until enter is pressed.
          const cap = commitCount();
          if (cap !== null) start(cap);
        } else if (key.escape) {
          setEditingCount(false);
          if (sessionCap === null) {
            setInputMessage("Cap not set — press e to type a count (1–25).");
          }
        } else if (key.leftArrow) {
          const next = moveCursorLeft({ value: countInput, cursor: countCursor });
          setCountCursor(next.cursor);
        } else if (key.rightArrow) {
          const next = moveCursorRight({ value: countInput, cursor: countCursor });
          setCountCursor(next.cursor);
        } else if (key.backspace || key.delete) {
          // macOS Backspace arrives as DEL (0x7f) → key.delete in Ink;
          // both erase backward (see SearchScreen).
          const next = deleteBackward({ value: countInput, cursor: countCursor });
          setCountInput(next.value);
          setCountCursor(next.cursor);
          setSessionCap(null);
        } else if (/^\d+$/.test(input)) {
          const next = insertAtCursor(
            { value: countInput, cursor: countCursor },
            input,
            { maxLength: 2, sanitize: (value) => value.replace(/\D+/g, "") },
          );
          setCountInput(next.value);
          setCountCursor(next.cursor);
          setSessionCap(null);
        }
        return;
      }
      if (editingPrompt && phase !== "running") {
        if (key.return || key.escape) {
          setEditingPrompt(false);
          setInputMessage(
            promptInput.trim()
              ? "Extra prompt set — it is passed to the agent with the run."
              : "No extra prompt — the agent runs the standard workflow.",
          );
        } else if (key.leftArrow) {
          const next = moveCursorLeft({ value: promptInput, cursor: promptCursor });
          setPromptCursor(next.cursor);
        } else if (key.rightArrow) {
          const next = moveCursorRight({ value: promptInput, cursor: promptCursor });
          setPromptCursor(next.cursor);
        } else if (key.backspace || key.delete) {
          const next = deleteBackward({ value: promptInput, cursor: promptCursor });
          setPromptInput(next.value);
          setPromptCursor(next.cursor);
        } else if (!key.ctrl && !key.meta && input && !/\p{C}/u.test(input)) {
          const next = insertAtCursor(
            { value: promptInput, cursor: promptCursor },
            input,
            { maxLength: PROMPT_MAX },
          );
          setPromptInput(next.value);
          setPromptCursor(next.cursor);
        }
        return;
      }
      if (phase === "running") return;
      if (input === "e") {
        setEditingCount(true);
        setSessionCap(null);
        setCountCursor(countInput.length);
        setInputMessage("Enter this cycle's application cap (1–25).");
      }
      if (input === "p") {
        setEditingPrompt(true);
        setPromptCursor(promptInput.length);
        setInputMessage("Optional: type an extra instruction for the agent, enter when done (empty = standard workflow).");
      }
      if (input === "s") {
        if (sessionCap === null) {
          setInputMessage("Set the cycle cap first — press e, type a count (1–25), then enter.");
        } else {
          start();
        }
      }
    },
    { isActive: active && Boolean(process.stdin.isTTY) },
  );

  // Tier feedback follows what the user is typing, not just the committed
  // value, so "25" glows before enter is pressed.
  const displayCap = editingCount
    ? (countInput ? Math.min(25, Number.parseInt(countInput, 10)) : null)
    : sessionCap;
  const tier = displayCap !== null && Number.isFinite(displayCap) ? capTier(displayCap) : null;

  // Cockpit gauge + outcome counters. The heartbeat is the honest source
  // for per-run counts (the runner writes it after every run); while a
  // run is live we show the elapsed clock instead of guessing from the
  // log tail. Re-read each render — renders are keypress/phase driven.
  const gaugeFill =
    displayCap !== null && Number.isFinite(displayCap)
      ? Math.max(1, Math.round((displayCap / 25) * GAUGE_WIDTH))
      : 0;
  const gauge = "█".repeat(gaugeFill) + "░".repeat(GAUGE_WIDTH - gaugeFill);
  const heartbeat = readHeartbeat(root);
  const runClock = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  // Cockpit chrome: title, gauge, prompt, counters, message, log header,
  // margins. What's left belongs to the log tail.
  const tailRows = Math.max(5, contentRows - (displayCap === 25 ? 10 : 9));

  return (
    <Box flexDirection="column">
      <Text bold color={theme.accent}>
        Jobs <Text dimColor>automatic run</Text>{" "}
        {phase === "running" ? (
          <Text color={theme.accent}>● running {runClock}</Text>
        ) : phase === "done" ? (
          exitCode === 0 ? (
            <Text color={theme.good}>{statusGlyph.applied} complete in {runClock}</Text>
          ) : (
            <Text color={theme.danger}>
              {statusGlyph.failed} exited {exitCode} — see logs/run_job_agent.log
            </Text>
          )
        ) : (
          <Text dimColor>idle</Text>
        )}
      </Text>

      <Box marginTop={1}>
        <Text dimColor>cap     </Text>
        {displayCap === 25 ? (
          // MAX: the gauge itself goes rainbow, matching the warning line.
          <RainbowText>{gauge}</RainbowText>
        ) : (
          <Text color={tier?.color}>{gauge}</Text>
        )}
        <Text>{"  "}</Text>
        <InlineTextInput
          value={countInput}
          cursor={countCursor}
          active={editingCount}
          placeholder="1–25"
        />
        <Text dimColor>/25</Text>
        {tier ? (
          <Text bold color={tier.color}>
            {"  "}{tier.name}
          </Text>
        ) : null}
      </Box>
      {displayCap === 25 ? (
        <Box>
          <Text>{"             "}</Text>
          <RainbowText>⚠ MAX — 25 applications will eat through your token budget</RainbowText>
        </Box>
      ) : null}

      <Box>
        <Text dimColor>prompt  </Text>
        <InlineTextInput
          value={promptInput}
          cursor={promptCursor}
          active={editingPrompt}
          placeholder="(none — standard workflow)"
          wrap="truncate-end"
        />
      </Box>

      {/* Outcome counters — heartbeat counts (last completed run) plus
          the live clock while running. */}
      <Box>
        <Text dimColor>{phase === "done" ? "run     " : "last    "}</Text>
        {heartbeat ? (
          <>
            <Text bold color={theme.good}>{heartbeat.last_run_counts?.applied ?? 0}</Text>
            <Text dimColor> applied  </Text>
            <Text bold color={theme.warn}>{heartbeat.last_run_counts?.needs_review ?? 0}</Text>
            <Text dimColor> review  </Text>
            <Text bold color={theme.danger}>{heartbeat.last_run_counts?.failed ?? 0}</Text>
            <Text dimColor> failed  </Text>
            <Text dimColor>{heartbeat.last_run_counts?.skipped_unfit ?? 0} unfit</Text>
          </>
        ) : (
          <Text dimColor>no runs recorded yet</Text>
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor wrap="truncate-end">{inputMessage}</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {phase === "idle" ? (
          <Box flexDirection="column">
            <Text dimColor>{statusGlyph.needs_review} No run in progress.</Text>
            <Box marginTop={1} flexDirection="column">
              <Text>
                {sessionCap === null ? (
                  <>Press <Text bold color={theme.accent}>e</Text>, type a count, then enter. Optional: <Text bold color={theme.accent}>p</Text> for an extra prompt.</>
                ) : (
                  <>Press <Text bold color={theme.accent}>s</Text> to start via{" "}<Text dimColor>scripts/runtime/run_job_agent.py</Text></>
                )}
              </Text>
              <Text dimColor>scrapes configured boards · fit-gates · tailors · applies ({sessionCap ?? "–"}/25 cap)</Text>
            </Box>
          </Box>
        ) : lines.length === 0 ? (
          <Text dimColor>waiting for session log…</Text>
        ) : (
          <Box flexDirection="column">
            <Text dimColor>session log</Text>
            {lines.slice(-tailRows).map((line, i) => (
              <Text key={i} dimColor wrap="truncate-end">
                {line}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}

export const RUN_HINTS = "e cap · p prompt · s start";
export const RUN_EDIT_HINTS = "type · ←→ move · backspace erase · enter set · esc done";
