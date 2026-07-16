import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { statusGlyph, theme } from "../theme.js";
import { InlineTextInput } from "./TextInput.js";

/**
 * Query box + suggestion list — preferred job locations and target
 * companies. Enter with text + a highlighted suggestion toggles it
 * (adds if absent, removes if already added — shown via the `[✓]`
 * bracket-checkbox next to it, the same convention Settings uses
 * everywhere else). Deliberately does NOT list every already-added item
 * — with a few dozen vetted companies that list grew long and cluttered
 * the page for no benefit (the final set is already visible once you
 * search for it again) — just a small running count.
 *
 * `suggestions` is expected to be the FULL match list (no pre-slicing
 * by the caller) — this component scrolls a `maxVisible`-tall window
 * over it that follows `suggestionIndex`, the same cursor-follows-window
 * pattern Settings' checklist and ReviewScreen/HistoryScreen use, so a
 * long list (a big "already added" set, or many search hits) is fully
 * reachable via up/down instead of being hard-cut at whatever fits on
 * screen.
 */
export function MultiEntryAutocomplete({
  label,
  query,
  cursor,
  focused,
  suggestions,
  suggestionIndex,
  addedItems,
  warning,
  placeholder,
  bordered = false,
  showLabel = true,
  maxVisible = 8,
  help,
}: {
  label: string;
  query: string;
  cursor: number;
  focused: boolean;
  suggestions: string[];
  suggestionIndex: number;
  addedItems: string[];
  warning?: string;
  placeholder?: string;
  /** Wraps the field in a bordered box — Settings' "popup" submenu look.
   *  Defaults to false so the onboarding wizard (which can show two of
   *  these on one page side by side) keeps its existing unbordered
   *  layout unchanged. */
  bordered?: boolean;
  /** Renders the field's own label/title row. Defaults to true; a caller
   *  that already shows the label itself (Settings' shared popup
   *  wrapper) passes false to avoid a duplicate title. */
  showLabel?: boolean;
  /** How many suggestion rows to show at once before scrolling. */
  maxVisible?: number;
  /** Explanatory line under the label, shown only while focused. */
  help?: string;
}) {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const maxOffset = Math.max(0, suggestions.length - maxVisible);
    setOffset((o) => {
      if (suggestions.length <= maxVisible) return 0;
      if (suggestionIndex < o) return suggestionIndex;
      if (suggestionIndex >= o + maxVisible) return Math.min(maxOffset, suggestionIndex - maxVisible + 1);
      return Math.min(o, maxOffset);
    });
  }, [suggestionIndex, suggestions.length, maxVisible]);

  const windowed = suggestions.slice(offset, offset + maxVisible);

  const body = (
    <Box flexDirection="column" marginBottom={bordered ? 0 : 1}>
      {showLabel && !bordered ? (
        <Text color={focused ? theme.accent : undefined} bold={focused} wrap="truncate-end">
          {focused ? "> " : "  "}
          {label}
        </Text>
      ) : null}
      {focused && help ? (
        <Box paddingLeft={bordered ? 0 : 2}>
          <Text dimColor wrap="wrap">
            {help}
          </Text>
        </Box>
      ) : null}
      <Box paddingLeft={bordered ? 0 : 2} flexDirection="column">
        <InlineTextInput value={query} cursor={cursor} active={focused} placeholder={placeholder} wrap="truncate-end" />
        {addedItems.length > 0 ? (
          <Text dimColor wrap="truncate-end">
            {addedItems.length} added
          </Text>
        ) : null}
        {focused && suggestions.length > 0 ? (
          <Box flexDirection="column">
            {offset > 0 ? <Text dimColor>↑ {offset} more</Text> : null}
            {windowed.map((s, wi) => {
              const i = offset + wi;
              const hit = i === suggestionIndex;
              const already = addedItems.includes(s);
              return (
                <Text key={s} wrap="truncate-end">
                  <Text color={hit ? theme.accent : undefined} bold={hit}>
                    {hit ? "> " : "  "}[
                  </Text>
                  <Text color={already ? theme.good : undefined}>{already ? statusGlyph.applied : " "}</Text>
                  <Text color={hit ? theme.accent : undefined} bold={hit}>
                    {"] "}
                    {s}
                  </Text>
                </Text>
              );
            })}
            {offset + maxVisible < suggestions.length ? (
              <Text dimColor>↓ {suggestions.length - offset - maxVisible} more</Text>
            ) : null}
          </Box>
        ) : null}
        {warning ? (
          <Text color={theme.warn} wrap="wrap">
            ⚠ {warning}
          </Text>
        ) : null}
      </Box>
    </Box>
  );
  if (!bordered) return body;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text bold color={theme.accent}>
        {label}
      </Text>
      {body}
    </Box>
  );
}
