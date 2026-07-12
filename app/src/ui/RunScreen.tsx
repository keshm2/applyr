import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { latestSessionLog } from "../state.js";
import { theme, statusGlyph, SELECT_MARKER } from "../theme.js";

const TAIL = 12;

type Phase = "idle" | "running" | "done";

/**
 * Trigger a run without leaving the app: spawns run_job_agent.sh and
 * tails the session log into the content region. The script owns
 * locking, validation, and the harness invocation.
 */
export function RunScreen({
  root,
  active,
  onInputActiveChange,
  onRunningChange,
}: {
  root: string;
  active: boolean;
  onInputActiveChange: (active: boolean) => void;
  onRunningChange: (running: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [countInput, setCountInput] = useState("");
  const [sessionCap, setSessionCap] = useState<number | null>(null);
  const [editingCount, setEditingCount] = useState(true);
  const [inputMessage, setInputMessage] = useState("Enter this cycle's application cap (1–25).");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const child = useRef<ChildProcess | null>(null);
  const logBefore = useRef<string | undefined>(undefined);

  useEffect(() => {
    const capturesInput = active && editingCount && phase !== "running";
    onInputActiveChange(capturesInput);
    return () => onInputActiveChange(false);
  }, [active, editingCount, onInputActiveChange, phase]);

  useEffect(() => {
    onRunningChange(phase === "running");
    return () => onRunningChange(false);
  }, [onRunningChange, phase]);

  const commitCount = () => {
    if (!countInput) {
      setInputMessage("A count from 1 to 25 is required before starting.");
      return;
    }
    const cap = Math.max(1, Math.min(25, Number.parseInt(countInput, 10)));
    setCountInput(String(cap));
    setSessionCap(cap);
    setEditingCount(false);
    setInputMessage(`Ready to run with a ${cap}-application cap.`);
  };

  const start = () => {
    if (phase === "running" || sessionCap === null) return;
    logBefore.current = latestSessionLog(root);
    setLines([]);
    setExitCode(null);
    setPhase("running");
    const proc = spawn("bash", ["scripts/run_job_agent.sh"], {
      cwd: root,
      env: { ...process.env, ARES_SESSION_CAP: String(sessionCap) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.current = proc;
    const push = (chunk: Buffer) =>
      setLines((prev) => [...prev, ...chunk.toString().split("\n").filter(Boolean)].slice(-TAIL));
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
          setLines(content.slice(-TAIL));
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
        else if (key.escape) setEditingCount(false);
        else if (key.backspace || key.delete) {
          setCountInput((value) => value.slice(0, -1));
          setSessionCap(null);
        } else if (/^\d$/.test(input) && countInput.length < 2) {
          setCountInput((value) => value + input);
          setSessionCap(null);
        }
        return;
      }
      if (input === "e" && phase !== "running") {
        setEditingCount(true);
        setSessionCap(null);
        setInputMessage("Enter this cycle's application cap (1–25).");
      }
      if (input === "s" && phase !== "running" && sessionCap !== null) start();
    },
    { isActive: active && Boolean(process.stdin.isTTY) },
  );

  return (
    <Box flexDirection="column">
      <Text bold color={theme.accent}>
        Jobs <Text dimColor>automatic run</Text>{" "}
        {phase === "running" ? (
          <Text color={theme.accent}>● running…</Text>
        ) : phase === "done" ? (
          exitCode === 0 ? (
            <Text color={theme.good}>{statusGlyph.applied} complete</Text>
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
        <Text dimColor>cycle cap </Text>
        <Text color={editingCount ? theme.accent : undefined} inverse={editingCount}>
          {countInput || "1–25"}
        </Text>
        {editingCount ? <Text color={theme.accent}>▏</Text> : null}
        <Text dimColor>  {inputMessage}</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {phase === "idle" ? (
          <Box flexDirection="column">
            <Text dimColor>{statusGlyph.needs_review} No run in progress.</Text>
            <Box marginTop={1} flexDirection="column">
              <Text>
                {sessionCap === null ? (
                  <>Enter a count above, then press enter.</>
                ) : (
                  <>Press <Text bold color={theme.accent}>s</Text> to start via{" "}<Text dimColor>scripts/run_job_agent.sh</Text></>
                )}
              </Text>
              <Text dimColor>scrapes configured boards · fit-gates · tailors · applies ({sessionCap ?? "–"}/25 cap)</Text>
            </Box>
          </Box>
        ) : lines.length === 0 ? (
          <Text dimColor>waiting for session log…</Text>
        ) : (
          <Box flexDirection="column">
            <Text dimColor>session log (last {lines.length} lines)</Text>
            <Box flexDirection="column" marginTop={1}>
              {lines.map((line, i) => (
                <Text key={i} dimColor wrap="truncate-end">
                  {line}
                </Text>
              ))}
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}

export const RUN_HINTS = "enter set · esc release · e edit · s start";
