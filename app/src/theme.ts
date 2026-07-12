/**
 * Color roles — defined once, referenced everywhere. The terminal's own
 * foreground/background is the ground; outcome colors (good/warn/danger)
 * are reserved for outcomes and never used decoratively. Ink/chalk
 * degrades hex to 256/16 colors and honors NO_COLOR automatically;
 * meaning never rides on color alone (symbols + position carry it too).
 */
export const theme = {
  accent: "#8B5CF6", // violet — active tab, selection, titles
  good: "green",
  warn: "yellow",
  danger: "red",
} as const;

export const statusColor: Record<string, string> = {
  applied: theme.good,
  needs_review: theme.warn,
  failed: theme.danger,
};

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
