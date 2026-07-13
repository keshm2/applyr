import React, { useCallback, useEffect, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { Banner, bannerHeight } from "./Banner.js";
import { StatusScreen } from "./StatusScreen.js";
import { ReviewScreen, REVIEW_HINTS } from "./ReviewScreen.js";
import { HistoryScreen, HISTORY_HINTS } from "./HistoryScreen.js";
import { RunScreen, RUN_HINTS, RUN_EDIT_HINTS } from "./RunScreen.js";
import { SearchScreen, SEARCH_HINTS, SEARCH_EDIT_HINTS } from "./SearchScreen.js";
import { HelpOverlay } from "./HelpOverlay.js";
import { WelcomeScreen, type WelcomeOption } from "./WelcomeScreen.js";
import { KeyHints } from "./KeyHints.js";
import { SidePanel } from "./SidePanel.js";
import { loadState, isResolved, lastRunLine, latestSessionLog, readHeartbeat } from "../state.js";
import type { ApplyrState } from "../state.js";
import { theme, MIN_COLUMNS, MIN_ROWS, SELECT_MARKER, SIDE_PANEL_WIDTH } from "../theme.js";

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

const WELCOME_OPTIONS: Array<WelcomeOption & { tab: Tab; mode?: Mode }> = [
  {
    label: "Manual job search",
    description: "Browse live postings, fit-check them on demand, and save promising roles into Review.",
    tab: "jobs",
    mode: "manual",
  },
  {
    label: "Automatic run",
    description: "Set a run cap, optionally add one extra instruction, then launch the full agent workflow.",
    tab: "jobs",
    mode: "automatic",
  },
  {
    label: "Review queue",
    description: "Open saved postings, mark them applied, or dismiss them without leaving the helper-backed flow.",
    tab: "review",
  },
  {
    label: "Status overview",
    description: "See outcome counts, scheduler health, and the current queue at a glance.",
    tab: "status",
  },
  {
    label: "Application history",
    description: "Browse recorded applications and outcomes in one place.",
    tab: "history",
  },
];

function welcomeIndexFor(tab: Tab, mode: Mode): number {
  if (tab === "jobs") return mode === "automatic" ? 1 : 0;
  if (tab === "review") return 2;
  if (tab === "history") return 4;
  return 3;
}

/** stdout size with an NaN-proof fallback (Number(undefined) is NaN,
 *  which `??` would happily keep). */
function stdoutSize(): { columns: number; rows: number } {
  const env = (name: string, fallback: number) => {
    const n = Number.parseInt(process.env[name] ?? "", 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    columns: process.stdout.columns || env("COLUMNS", 80),
    rows: process.stdout.rows || env("LINES", 24),
  };
}

/** The persistent shell: banner, tab row, content region, key-hint bar.
 *  Every band is derived from the live terminal size and re-derived on
 *  resize — nothing is laid out from fixed dimensions. */
export function App({ root, initialTab = "status" }: { root: string; initialTab?: Tab }) {
  const { exit } = useApp();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [mode, setMode] = useState<Mode>("manual");
  const [state, setState] = useState<ApplyrState>(() => loadState(root));
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [childInputActive, setChildInputActive] = useState(false);
  const [runInProgress, setRunInProgress] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [confirmQuit, setConfirmQuit] = useState(false);
  // The welcome walkthrough opens every plain `applyr` launch; jumping
  // straight to a screen (`applyr review`) skips it.
  const [welcome, setWelcome] = useState(initialTab === "status");
  const [welcomeCursor, setWelcomeCursor] = useState(() => welcomeIndexFor(initialTab, "manual"));
  const [size, setSize] = useState(stdoutSize);
  const { columns, rows } = size;

  useEffect(() => {
    const onResize = () => setSize(stdoutSize());
    process.stdout.on("resize", onResize);
    return () => {
      process.stdout.off("resize", onResize);
    };
  }, []);

  const refresh = useCallback(() => {
    setState(loadState(root));
    setRefreshNonce((n) => n + 1);
  }, [root]);

  const switchTab = useCallback(
    (next: Tab) => {
      if (runInProgress && next !== "jobs") return;
      setTab(next);
      refresh();
    },
    [refresh, runInProgress],
  );

  const openWelcomeSelection = useCallback(() => {
    const next = WELCOME_OPTIONS[welcomeCursor] ?? WELCOME_OPTIONS[0];
    if (runInProgress && next.tab !== "jobs") return;
    if (next.mode) setMode(next.mode);
    setTab(next.tab);
    setWelcome(false);
    refresh();
  }, [refresh, runInProgress, welcomeCursor]);

  useInput(
    (input, key) => {
      // Help overlay swallows everything; any close-ish key dismisses it.
      if (helpOpen) {
        if (input === "?" || key.escape || input === "q" || key.return) setHelpOpen(false);
        return;
      }
      // Welcome page is a real menu: the first interaction should route
      // the user somewhere useful, not just dismiss the screen.
      if (welcome) {
        if (input === "q") return exit();
        if (input === "?") return setHelpOpen(true);
        if (key.return) return openWelcomeSelection();
        if (key.tab || key.downArrow || input === "j") {
          return setWelcomeCursor((current) => (current + 1) % WELCOME_OPTIONS.length);
        }
        if (key.upArrow || input === "k") {
          return setWelcomeCursor((current) =>
            (current + WELCOME_OPTIONS.length - 1) % WELCOME_OPTIONS.length,
          );
        }
        return;
      }
      if (input === "q") {
        // Quitting mid-run is allowed (the run keeps going in the
        // background) but never on a single accidental keypress.
        if (runInProgress && !confirmQuit) {
          setConfirmQuit(true);
          return;
        }
        return exit();
      }
      setConfirmQuit(false);
      if (input === "?") return setHelpOpen(true);
      if (input === "w") {
        setWelcomeCursor(welcomeIndexFor(tab, mode));
        return setWelcome(true);
      }
      if (input === "R") return refresh();
      if (input === "m") {
        if (runInProgress) return;
        setMode((current) => (current === "manual" ? "automatic" : "manual"));
        return;
      }
      if (key.tab || key.rightArrow) {
        const step = key.tab && key.shift ? TABS.length - 1 : 1;
        return switchTab(TABS[(TABS.indexOf(tab) + step) % TABS.length]);
      }
      if (key.leftArrow) {
        return switchTab(TABS[(TABS.indexOf(tab) + TABS.length - 1) % TABS.length]);
      }
      const idx = Number.parseInt(input, 10);
      if (idx >= 1 && idx <= TABS.length) switchTab(TABS[idx - 1]);
    },
    { isActive: Boolean(process.stdin.isTTY) && !childInputActive },
  );

  const unresolved = state.queue.filter((e) => !isResolved(state, e)).length;
  const counts = { applied: 0, needsReview: 0, failed: 0 };
  for (const job of state.applied) {
    if (job.status === "applied") counts.applied += 1;
    if (job.status === "needs_review") counts.needsReview += 1;
    if (job.status === "failed") counts.failed += 1;
  }
  const heartbeat = readHeartbeat(root);
  const lastRun = lastRunLine(root);
  const sessionLog = latestSessionLog(root);

  // Below the supported minimum, show a designed notice instead of a
  // corrupted layout.
  if (columns < MIN_COLUMNS || rows < MIN_ROWS) {
    return (
      <Box flexDirection="column" paddingX={1} paddingTop={2} alignItems="center">
        <Text bold color={theme.accent}>
          applyr
        </Text>
        <Text dimColor>terminal too small</Text>
        <Box marginTop={1} flexDirection="column" alignItems="center">
          <Text dimColor>need at least {MIN_COLUMNS}×{MIN_ROWS}, have {columns}×{rows}</Text>
          <Text dimColor>resize or widen the window, then reopen with `applyr`</Text>
        </Box>
      </Box>
    );
  }

  const tty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  // Side panel: shown when the terminal is wide and tall enough; below
  // the threshold it hides and the content takes the full width (clean
  // degradation on narrower/shorter terminals).
  const showSidebar = columns >= 64 && rows >= 18;
  const sideOverhead = showSidebar ? SIDE_PANEL_WIDTH + 2 : 0; // panel + gutter
  // On very wide terminals, center a readable content column instead of
  // leaving the right half of the screen empty: the horizontal padding
  // grows so the ~140-col band sits mid-screen. The banner centers itself.
  // The sidebar's overhead is added to the centered band so the content
  // area stays as wide as it was without the sidebar. The band is wider
  // than before (140 vs 110) and the centering threshold higher (160 vs
  // 120) so content fills more of the screen on moderately wide terminals
  // instead of leaving large empty margins.
  const pad = columns > 160 + sideOverhead ? Math.floor((columns - 140 - sideOverhead) / 2) : 1;
  const ruleWidth = Math.max(0, columns - pad * 2);
  const contentCols = columns - pad * 2 - sideOverhead;

  // Responsive layout math: the shell chrome (banner, mode row, tabs,
  // rule, margins, hint bar) is measured, and what's left is handed to
  // the active screen so lists grow on tall terminals and shrink on
  // short ones instead of assuming a fixed page size.
  const bannerRows = bannerHeight(columns, rows);
  const chromeRows = bannerRows + 7; // mode 1 + tabs 2 + rule 1 + content margin 1 + hints 2
  const contentRows = Math.max(6, rows - chromeRows);

  // The hint bar always reflects what the keyboard will actually do right
  // now: typing captures keys (screens tell us via childInputActive), a
  // live run locks navigation, and everything else gets the standard set.
  // Every chunk is "key description" so KeyHints can color the key caps.
  let tabHints: string;
  if (tab === "jobs") {
    if (childInputActive) tabHints = mode === "manual" ? SEARCH_EDIT_HINTS : RUN_EDIT_HINTS;
    else tabHints = mode === "manual" ? SEARCH_HINTS : RUN_HINTS;
  } else {
    tabHints = TAB_HINTS[tab];
  }
  const globalHints = childInputActive
    ? "" // the edit hints above are the whole story while typing
    : runInProgress
      ? "q quit"
      : "1-4/←→ tabs · m mode · R reload · w welcome · ? help · q quit";
  const allHints = [tabHints, globalHints].filter(Boolean).join(" · ");

  // The frame is pinned to exactly the viewport height with overflow
  // clipped: a frame taller than the terminal is unmanageable for Ink
  // (it can't erase what scrolled away), which is what corrupts the
  // screen on resize and clips the banner. Children stack from the top
  // with no flex spacer, so the hint bar still hugs the content — the
  // unused rows sit below it. Screens size themselves from contentRows
  // so they fit instead of being clipped.
  return (
    <Box flexDirection="column" height={tty ? rows : undefined} overflow="hidden">
      <Banner columns={columns} rows={rows} />
      <Box paddingX={pad} justifyContent="flex-end">
        <Text dimColor>MODE </Text>
        <Text bold color={mode === "manual" ? theme.accent : theme.warn}>
          {mode === "manual" ? "MANUAL" : "AUTO"}
        </Text>
      </Box>
      {/* Tab row */}
      <Box paddingX={pad} marginTop={1}>
        {TABS.map((t, i) => (
          <Box key={t} marginRight={2}>
            <Text dimColor>{i + 1} </Text>
            {t === tab && !welcome ? (
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
      <Box paddingX={pad}>
        <Text color={theme.rule}>{"─".repeat(ruleWidth)}</Text>
      </Box>
{/* Content region. The help overlay hides (never unmounts) the active
           screen: unmounting RunScreen mid-run would drop the log tail and
           reset the run lock-out. flexGrow=1 fills the remaining vertical
           space so the hint bar pins to the bottom and the side panel
           stretches to the full content height (its build marker sits at
           the bottom via an internal flex spacer). The sidebar sits on the
           RIGHT with a dedicated left-border separator so the boundary
           between main content and sidebar is unmistakable. */}
      <Box
        paddingX={pad}
        marginTop={1}
        flexDirection="row"
        flexGrow={1}
        overflow="hidden"
      >
        <Box flexDirection="column" flexGrow={1}>
          {welcome ? (
            <WelcomeScreen
              contentRows={contentRows}
              columns={contentCols}
              options={WELCOME_OPTIONS}
              cursor={welcomeCursor}
              counts={counts}
              unresolvedQueue={unresolved}
              registryCount={state.registry.length}
              heartbeat={heartbeat}
              lastRun={lastRun}
            />
          ) : (
            <>
              {helpOpen ? <HelpOverlay contentRows={contentRows} /> : null}
              <Box display={helpOpen ? "none" : "flex"} flexDirection="column">
                {tab === "status" ? (
                  <StatusScreen
                    state={state}
                    lastRun={lastRun}
                    sessionLog={sessionLog}
                    unresolvedQueue={unresolved}
                    heartbeat={heartbeat}
                    embedded
                    contentRows={contentRows}
                  />
                ) : tab === "jobs" ? (
                  mode === "manual" ? (
                    <SearchScreen
                      root={root}
                      active={!helpOpen}
                      onInputActiveChange={setChildInputActive}
                      onStateChange={refresh}
                      contentRows={contentRows}
                    />
                  ) : (
                    <RunScreen
                      root={root}
                      active={!helpOpen}
                      onInputActiveChange={setChildInputActive}
                      onRunningChange={setRunInProgress}
                    />
                  )
                ) : tab === "review" ? (
                  <ReviewScreen
                    root={root}
                    active={tab === "review" && !helpOpen}
                    refreshNonce={refreshNonce}
                    onStateChange={refresh}
                    contentRows={contentRows}
                  />
                ) : (
                  <HistoryScreen
                    state={state}
                    active={tab === "history" && !helpOpen}
                    contentRows={contentRows}
                  />
                )}
              </Box>
            </>
          )}
        </Box>
        {showSidebar ? (
          <Box
            flexDirection="column"
            marginLeft={1}
            width={SIDE_PANEL_WIDTH + 1}
            borderStyle="single"
            borderRight={false}
            borderTop={false}
            borderBottom={false}
            borderColor={theme.rule}
          >
            <SidePanel applied={counts.applied} pending={unresolved} mode={mode} />
          </Box>
        ) : null}
      </Box>
      {/* Hint bar — pinned to the bottom as a status bar. */}
      <Box paddingX={pad} marginTop={1}>
        {confirmQuit ? (
          <Text color={theme.warn}>
            A run is in progress — press q again to quit (the run keeps going in the background), any other key to stay.
          </Text>
        ) : helpOpen ? (
          <KeyHints hints="?/esc/enter close help" />
        ) : welcome ? (
          <KeyHints hints="↑↓/j/k move · enter open · ? full key reference · q quit" />
        ) : (
          <>
            {runInProgress ? <Text color={theme.warn}>● run active — navigation locked  </Text> : null}
            {childInputActive ? <Text color={theme.warn}>✎ typing  </Text> : null}
            <KeyHints hints={allHints} />
          </>
        )}
      </Box>
    </Box>
  );
}
