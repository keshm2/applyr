/**
 * Color roles — defined once, referenced everywhere. The terminal's own
 * foreground/background is the ground; outcome colors (good/warn/danger)
 * are reserved for outcomes and never used decoratively. Ink/chalk
 * degrades hex to 256/16 colors and honors NO_COLOR automatically;
 * meaning never rides on color alone — the glyph map below pairs a
 * symbol with every semantic color so the 16-color / NO_COLOR runs stay
 * legible.
 */
export const theme = {
  accent: "#8B5CF6", // violet — active tab, selection, titles
  rule: "#6D28D9", // dim violet — header/footer rules only
  good: "green",
  warn: "yellow",
  danger: "red",
} as const;

export const statusColor: Record<string, string> = {
  applied: theme.good,
  needs_review: theme.warn,
  failed: theme.danger,
};

/** Status glyphs — paired with statusColor so meaning survives NO_COLOR. */
export const statusGlyph: Record<string, string> = {
  applied: "✓",
  needs_review: "◐",
  failed: "✗",
};

/** Selection marker — the one place boldness is spent on focus. */
export const SELECT_MARKER = "▸";

/** ASCII banner — the one loud element. Rows fade violet → maroon. */
export const BANNER_ROWS = [
  " █████╗ ██████╗ ███████╗███████╗",
  "██╔══██╗██╔══██╗██╔════╝██╔════╝",
  "███████║██████╔╝█████╗  ███████╗",
  "██╔══██║██╔══██╗██╔══╝  ╚════██║",
  "██║  ██║██║  ██║███████╗███████║",
  "╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚══════╝",
] as const;

export const BANNER_GRADIENT = [
  "#A78BFA", // violet
  "#9265F0",
  "#7C3AED",
  "#7E22CE", // purple
  "#8B1E5B", // plum
  "#800020", // maroon
] as const;

export const BANNER_WIDTH = BANNER_ROWS[0].length;

/** Below this size the app shows a "terminal too small" notice. The tab
 *  row is the binding constraint (~40 cols); the banner collapses earlier
 *  but the tab row would wrap before that matters. */
export const MIN_COLUMNS = 40;
export const MIN_ROWS = 10;