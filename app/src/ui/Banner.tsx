import React from "react";
import { Box, Text } from "ink";
import { BANNER_ROWS, BANNER_GRADIENT, BANNER_WIDTH, theme } from "../theme.js";

/**
 * The persistent Ares banner. Violet→maroon gradient by row; collapses
 * to a plain bold wordmark when the terminal is too narrow for the art
 * (never corrupts layout).
 */
export function Banner({ columns }: { columns: number }) {
  if (columns < BANNER_WIDTH + 2) {
    return (
      <Box paddingX={1}>
        <Text bold color={theme.accent}>
          ARES
        </Text>
        <Text dimColor> — job application agent</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" paddingX={1}>
      {BANNER_ROWS.map((row, i) => (
        <Text key={i} color={BANNER_GRADIENT[i]}>
          {row}
        </Text>
      ))}
    </Box>
  );
}