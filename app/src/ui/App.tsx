import React, { useCallback, useEffect, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { Banner } from "./Banner.js";
import { StatusScreen } from "./StatusScreen.js";
import { ReviewScreen, REVIEW_HINTS } from "./ReviewScreen.js";
import { HistoryScreen, HISTORY_HINTS } from "./HistoryScreen.js";
import { RunScreen, RUN_HINTS } from "./RunScreen.js";
import { SearchScreen, SEARCH_HINTS } from "./SearchScreen.js";
import { loadState, isResolved, lastRunLine, latestSessionLog, readHeartbeat } from "../state.js";
import type { AresState } from "../state.js";
import { theme, MIN_COLUMNS, MIN_ROWS, SELECT_MARKER } from "../theme.js";

export type Tab = "status" | "jobs" | "review" | "history";
export type Mode = "manual" | "automatic";
const TABS: Tab[] = ["status", "jobs", "review", "history"];
const TAB_LABEL: Record<Tab, string> = {
  status: "Status",
  jobs: "Jobs",
  review: "Review",
  history: "History",
};
const TAB_HINTS: Omit<Record<Tab, string>, "jobs"> = {
  status: "",
  review: REVIEW_HINTS,
  history: HISTORY_HINTS,
};

/** The persistent shell: banner, tab row, content region, key-hint bar. */
export function App({ root, initialTab = "status" }: { root: string; initialTab?: Tab }) {
  const { exit } = useApp();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [mode, setMode] = useState<Mode>("manual");
  const [state, setState] = useState<AresState>(() => loadState(root));
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [childInputActive, setChildInputActive] = useState(false);
  const [runInProgress, setRunInProgress] = useState(false);
  const [columns, setColumns] = useState(process.stdout.columns ?? Number(process.env.COLUMNS) ?? 80);
  const [rows, setRows] = useState(process.stdout.rows ?? Number(process.env.LINES) ?? 24);

  useEffect(() => {
    const onResize = () => {
      setColumns(process.stdout.columns ?? Number(process.env.COLUMNS) ?? 80);
      setRows(process.stdout.rows ?? Number(process.env.LINES) ?? 24);
    };
    process.stdout.on("resize", onResize);
    return () => {
      process.stdout.off("resize", onResize);
    };
  }, []);

  const refresh = useCallback(() => {
    setState(loadState(root));
    setRefreshNonce((n) => n + 1);
  }, [root]);

  useInput(
    (input, key) => {
      if (input === "q" || key.escape) return exit();
      if (input === "R") return refresh();
      if (input === "m") {
        if (runInProgress) return;
        setMode((current) => current === "manual" ? "automatic" : "manual");
        return;
      }
      if (key.tab) {
        if (runInProgress) return;
        const next = TABS[(TABS.indexOf(tab) + (key.shift ? TABS.length - 1 : 1)) % TABS.length];
        setTab(next);
        refresh();
        return;
      }
      const idx = Number.parseInt(input, 10);
      if (idx >= 1 && idx <= TABS.length) {
        if (runInProgress && TABS[idx - 1] !== "jobs") return;
        setTab(TABS[idx - 1]);
        refresh();
      }
    },
    { isActive: Boolean(process.stdin.isTTY) && !childInputActive },
  );

  const unresolved = state.queue.filter((e) => !isResolved(state, e)).length;

  // Below the supported minimum, show a designed notice instead of a
  // corrupted layout.
  if (columns < MIN_COLUMNS || rows < MIN_ROWS) {
    return (
      <Box flexDirection="column" paddingX={1} paddingTop={2} alignItems="center">
        <Text bold color={theme.accent}>
          Ares
        </Text>
        <Text dimColor>terminal too small</Text>
        <Box marginTop={1} flexDirection="column" alignItems="center">
          <Text dimColor>need at least {MIN_COLUMNS}×{MIN_ROWS}, have {columns}×{rows}</Text>
          <Text dimColor>resize or widen the window, then reopen with `ares`</Text>
        </Box>
      </Box>
    );
  }

  const tty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const ruleWidth = Math.max(0, columns - 2); // paddingX 1 each side
  const globalHints = tab === "jobs"
    ? runInProgress ? `run active · q quit · ${mode.toUpperCase()}` : `m mode · q quit · ${mode.toUpperCase()}`
    : `m mode · R refresh · 1-4 tabs · q quit · ${mode.toUpperCase()}`;
  const tabHints = tab === "jobs" ? (mode === "manual" ? SEARCH_HINTS : RUN_HINTS) : TAB_HINTS[tab];

  return (
    <Box flexDirection="column" height={tty ? rows : undefined}>
      <Banner columns={columns} />
      <Box paddingX={1} justifyContent="flex-end">
        <Text dimColor>MODE </Text>
        <Text bold color={mode === "manual" ? theme.accent : theme.warn}>
          {mode === "manual" ? "MANUAL" : "AUTO"}
        </Text>
      </Box>
      {/* Tab row */}
      <Box paddingX={1} marginTop={1}>
        {TABS.map((t, i) => (
          <Box key={t} marginRight={2}>
            <Text dimColor>{i + 1} </Text>
            {t === tab ? (
              <Text bold color={theme.accent}>
                {SELECT_MARKER} {TAB_LABEL[t]}
              </Text>
            ) : (
              <Text dimColor>{TAB_LABEL[t]}</Text>
            )}
            {t === "review" && unresolved > 0 ? (
              <Text color={theme.warn}> ({unresolved})</Text>
            ) : null}
          </Box>
        ))}
      </Box>
      {/* Header rule — anchors the header band. */}
      <Box paddingX={1}>
        <Text color={theme.rule}>{"─".repeat(ruleWidth)}</Text>
      </Box>
      {/* Content region — fills available height so the hint bar sinks to the bottom. */}
      <Box paddingX={1} marginTop={1} flexDirection="column" flexGrow={1} flexShrink={1}>
        {tab === "status" ? (
          <StatusScreen
            state={state}
            lastRun={lastRunLine(root)}
            sessionLog={latestSessionLog(root)}
            unresolvedQueue={unresolved}
            heartbeat={readHeartbeat(root)}
            embedded
          />
        ) : tab === "jobs" ? (
          mode === "manual" ? (
            <SearchScreen
              root={root}
              active
              onInputActiveChange={setChildInputActive}
              onStateChange={refresh}
              rows={rows}
            />
          ) : (
            <RunScreen
              root={root}
              active
              onInputActiveChange={setChildInputActive}
              onRunningChange={setRunInProgress}
            />
          )
        ) : tab === "review" ? (
          <ReviewScreen
            root={root}
            active={tab === "review"}
            refreshNonce={refreshNonce}
            onStateChange={refresh}
          />
        ) : (
          <HistoryScreen state={state} active={tab === "history"} />
        )}
      </Box>
      {/* Hint bar — pinned to the bottom as a status bar. */}
      <Box paddingX={1} marginTop={1}>
        <Text dimColor>
          {tabHints ? (
            <>
              {tabHints} <Text color={theme.rule}>·</Text> {globalHints}
            </>
          ) : (
            globalHints
          )}
        </Text>
      </Box>
    </Box>
  );
}
