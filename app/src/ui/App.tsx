import React, { useEffect, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { Banner } from "./Banner.js";
import { StatusScreen } from "./StatusScreen.js";
import { ReviewScreen, REVIEW_HINTS } from "./ReviewScreen.js";
import { HistoryScreen, HISTORY_HINTS } from "./HistoryScreen.js";
import { RunScreen, RUN_HINTS } from "./RunScreen.js";
import { loadState, isResolved, lastRunLine, latestSessionLog, readHeartbeat } from "../state.js";
import type { AresState } from "../state.js";
import { theme } from "../theme.js";

export type Tab = "status" | "review" | "history" | "run";
const TABS: Tab[] = ["status", "review", "history", "run"];
const TAB_LABEL: Record<Tab, string> = {
  status: "1 Status",
  review: "2 Review",
  history: "3 History",
  run: "4 Run",
};
const TAB_HINTS: Record<Tab, string> = {
  status: "",
  review: REVIEW_HINTS,
  history: HISTORY_HINTS,
  run: RUN_HINTS,
};

/** The persistent shell: banner, tab row, content region, key-hint bar. */
export function App({ root, initialTab = "status" }: { root: string; initialTab?: Tab }) {
  const { exit } = useApp();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [state, setState] = useState<AresState>(() => loadState(root));
  const [columns, setColumns] = useState(process.stdout.columns ?? 80);

  useEffect(() => {
    const onResize = () => setColumns(process.stdout.columns ?? 80);
    process.stdout.on("resize", onResize);
    return () => {
      process.stdout.off("resize", onResize);
    };
  }, []);

  const refresh = () => setState(loadState(root));

  useInput(
    (input, key) => {
      if (input === "q" || key.escape) return exit();
      if (input === "R") return refresh();
      if (key.tab) {
        const next = TABS[(TABS.indexOf(tab) + (key.shift ? TABS.length - 1 : 1)) % TABS.length];
        setTab(next);
        refresh();
        return;
      }
      const idx = Number.parseInt(input, 10);
      if (idx >= 1 && idx <= TABS.length) {
        setTab(TABS[idx - 1]);
        refresh();
      }
    },
    { isActive: Boolean(process.stdin.isTTY) },
  );

  const unresolved = state.queue.filter((e) => !isResolved(state, e)).length;

  return (
    <Box flexDirection="column" paddingTop={1}>
      <Banner columns={columns} />
      <Box paddingX={1} marginTop={1}>
        {TABS.map((t) => (
          <Box key={t} marginRight={2}>
            {t === tab ? (
              <Text bold color={theme.accent}>
                {TAB_LABEL[t]}
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
      <Box paddingX={1} marginTop={1} flexDirection="column" minHeight={8}>
        {tab === "status" ? (
          <StatusScreen
            state={state}
            lastRun={lastRunLine(root)}
            sessionLog={latestSessionLog(root)}
            unresolvedQueue={unresolved}
            heartbeat={readHeartbeat(root)}
            embedded
          />
        ) : tab === "review" ? (
          <ReviewScreen root={root} active={tab === "review"} />
        ) : tab === "history" ? (
          <HistoryScreen state={state} active={tab === "history"} />
        ) : (
          <RunScreen root={root} active={tab === "run"} />
        )}
      </Box>
      <Box paddingX={1} marginTop={1}>
        <Text dimColor>
          1-4/tab screens{TAB_HINTS[tab] ? ` · ${TAB_HINTS[tab]}` : ""} · R refresh · q quit
        </Text>
      </Box>
    </Box>
  );
}
