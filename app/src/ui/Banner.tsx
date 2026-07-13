import React from "react";
import { Box, Text } from "ink";
import { BANNER_ROWS, BANNER_GRADIENT, BANNER_WIDTH, theme } from "../theme.js";

/** Terminals shorter than this get the one-line wordmark even when wide —
 *  six rows of art plus the shell chrome (7) leaves too little room for
 *  any screen's minimum content below ~24 rows. */
const FULL_ART_MIN_ROWS = 24;

export type BannerVariant = "art" | "wordmark";

export function bannerVariant(columns: number, rows: number): BannerVariant {
  return columns >= BANNER_WIDTH + 2 && rows >= FULL_ART_MIN_ROWS ? "art" : "wordmark";
}

/** Rows the banner occupies — the app shell uses this to size the
 *  content region responsively. */
export function bannerHeight(columns: number, rows: number): number {
  return bannerVariant(columns, rows) === "art" ? BANNER_ROWS.length : 1;
}

/**
 * The persistent applyr banner. Violet→maroon gradient by row, centered
 * to the current terminal width; collapses to a centered one-line
 * wordmark when the terminal is too narrow or too short for the art
 * (never corrupts layout).
 */
export function Banner({ columns, rows }: { columns: number; rows: number }) {
  if (bannerVariant(columns, rows) === "wordmark") {
    return (
      <Box paddingX={1} justifyContent="center">
        <Text bold color={theme.accent}>
          APPLYR
        </Text>
        <Text dimColor> — job application agent</Text>
      </Box>
    );
  }
  // Each art row sits in its own full-width row Box with justifyContent
  // center — Ink's alignItems="center" on a column doesn't reliably
  // center <Text> children cross-axis, but a row Box stretches to the
  // full width and centers its <Text> child deterministically.
  return (
    <Box flexDirection="column" paddingX={1}>
      {BANNER_ROWS.map((row, i) => (
        <Box key={i} justifyContent="center">
          <Text color={BANNER_GRADIENT[i]}>{row}</Text>
        </Box>
      ))}
    </Box>
  );
}
