import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { latestSessionLog } from "../state.js";
import { theme } from "../theme.js";

const TAIL = 12;

type Phase = "idle" | "running" | "done";

/**
 * Trigger a run without leaving the app: spawns run_job_agent.sh and
 * tails the session log into the content region. The script owns
 * locking, validation, and the harness invocation.
 */
export function RunScreen({ root, active }: { root: string; active: boolean }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const child = useRef<ChildProcess | null>(null);
  const logBefore = useRef<string | undefined>(undefined);

  const start = () => {
    if (phase === "running") return;
    logBefore.current = latestSessionLog(root);
    setLines([]);
    setExitCode(null);
    setPhase("running");
    const proc = spawn("bash", ["scripts/run_job_agent.sh"], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.current = proc;
    const push = (chunk: Buffer) =>
      setLines((prev) => [...prev, ...chunk.toString().split("\n").filter(Boolean)].slice(-TAIL));
    proc.stdout?.on("data", push);
    proc.stderr?.on("data", push);
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
    (input) => {
      if (input === "s" && phase !== "running") start();
    },
    { isActive: active && Boolean(process.stdin.isTTY) },
  );

  return (
    <Box flexDirection="column">
      <Text bold>
        Run{" "}
        {phase === "running" ? (
          <Text color={theme.accent}>● running…</Text>
        ) : phase === "done" ? (
          exitCode === 0 ? (
            <Text color={theme.good}>✓ complete</Text>
          ) : (
            <Text color={theme.danger}>✗ exited {exitCode} — see logs/run_job_agent.log</Text>
          )
        ) : (
          <Text dimColor>idle</Text>
        )}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {phase === "idle" ? (
          <>
            <Text dimColor>
              Press s to start a run via scripts/run_job_agent.sh — it scrapes the
            </Text>
            <Text dimColor>
              configured boards, fit-gates, tailors, and applies (25/session cap).
            </Text>
          </>
        ) : lines.length === 0 ? (
          <Text dimColor>waiting for session log…</Text>
        ) : (
          lines.map((line, i) => (
            <Text key={i} dimColor wrap="truncate-end">
              {line}
            </Text>
          ))
        )}
      </Box>
    </Box>
  );
}

export const RUN_HINTS = "s start run";
