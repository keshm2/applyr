import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { RainbowText } from "./KeyHints.js";
import { theme, BUILD_MARKER, SIDE_PANEL_WIDTH } from "../theme.js";

type Mode = "manual" | "automatic";

/**
 * Persistent right-side status panel. Shown beside the content region
 * when the terminal is wide and tall enough (see App's showSidebar); on
 * narrower/shorter terminals it hides and the content takes the full
 * width. The panel owns its own 1 s clock state so only it re-renders —
 * the parent App and active screen are unaffected. The parent wraps the
 * panel in a bordered Box whose left border is the separator between
 * main content and sidebar; paddingLeft here pads content away from it.
 *
 * `Test User` is a UI placeholder only — there is no backend account
 * store yet. The rainbow text reuses the existing RainbowText helper.
 */
export function SidePanel({
  applied,
  pending,
  mode,
}: {
  applied: number;
  pending: number;
  mode: Mode;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const timeStr = now.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <Box flexDirection="column" width={SIDE_PANEL_WIDTH} paddingLeft={1}>
      <Text dimColor>Welcome</Text>
      <RainbowText>Test User</RainbowText>

      <Box marginTop={1} flexDirection="column">
        <Text bold>{dateStr}</Text>
        <Text bold color={theme.accent}>
          {timeStr}
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text dimColor>{"Applied".padEnd(8)}</Text>
          <Text bold color={theme.good}>
            {applied}
          </Text>
        </Box>
        <Box>
          <Text dimColor>{"Queue".padEnd(8)}</Text>
          <Text bold color={pending > 0 ? theme.warn : undefined}>
            {pending}
          </Text>
        </Box>
        <Box>
          <Text dimColor>{"Mode".padEnd(8)}</Text>
          <Text bold color={mode === "manual" ? theme.accent : theme.warn}>
            {mode === "manual" ? "MANUAL" : "AUTO"}
          </Text>
        </Box>
      </Box>

      {/* Flex spacer pins the build marker to the bottom of the panel. */}
      <Box flexGrow={1} />
      <Box paddingTop={1}>
        <Text dimColor>build {BUILD_MARKER}</Text>
      </Box>
    </Box>
  );
}
