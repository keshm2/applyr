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

/** Session-cap tiers — the cap picker colors by cost so the difference
 *  between a 3-job test and a 25-job MAX run is visible at a glance. */
export interface CapTier {
  name: string;
  color: string;
}
export function capTier(cap: number): CapTier {
  if (cap >= 25) return { name: "MAX", color: theme.danger };
  if (cap >= 15) return { name: "heavy", color: theme.warn };
  if (cap >= 6) return { name: "standard", color: theme.accent };
  return { name: "light", color: theme.good };
}

/** hsl(hue, 100%, 65%) → #rrggbb — drives the animated MAX-cap warning. */
export function hueColor(hue: number): string {
  const h = ((hue % 360) + 360) % 360;
  const c = 0.7; // chroma at 100% saturation, 65% lightness
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = 0.65 - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] :
    h < 120 ? [x, c, 0] :
    h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] :
    h < 300 ? [x, 0, c] : [c, 0, x];
  const hex = (v: number) =>
    Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** ASCII banner — the one loud element. Rows fade violet → maroon. */
export const BANNER_ROWS = [
  " █████╗ ██████╗ ██████╗ ██╗     ██╗   ██╗██████╗ ",
  "██╔══██╗██╔══██╗██╔══██╗██║     ╚██╗ ██╔╝██╔══██╗",
  "███████║██████╔╝██████╔╝██║      ╚████╔╝ ██████╔╝",
  "██╔══██║██╔═══╝ ██╔═══╝ ██║       ╚██╔╝  ██╔══██╗",
  "██║  ██║██║     ██║     ███████╗   ██║   ██║  ██║",
  "╚═╝  ╚═╝╚═╝     ╚═╝     ╚══════╝   ╚═╝   ╚═╝  ╚═╝",
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
export const MIN_ROWS = 12;

/** Build/release marker shown in the side panel footer. */
export const BUILD_MARKER = "0.5.5a";

/** Side panel width — narrow enough to coexist with content on 64-col+
 *  terminals. The panel hides below that width (see App showSidebar). */
export const SIDE_PANEL_WIDTH = 20;