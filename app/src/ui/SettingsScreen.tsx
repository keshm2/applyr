import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { statusGlyph, theme } from "../theme.js";
import {
  effectiveEnv,
  readDiscordEnabled,
  readDiscordRoute,
  readEnvOverride,
  readSafeField,
  writeDiscordEnabled,
  writeDiscordRoute,
  writeEnvOverride,
  writeSafeField,
} from "../settings.js";
import {
  InlineTextInput,
  deleteBackward,
  insertAtCursor,
  moveCursorLeft,
  moveCursorRight,
} from "./TextInput.js";

/**
 * Settings tab: view and edit the config that drives applyr —
 * personal info (config/targets.json safe_fields), Discord webhooks
 * (config/discord_config.json), and persisted APPLYR_* environment
 * overrides (config/env.json, exported by the runner; a real env var
 * always wins). Every list uses the same `> [x]` menu format, every
 * field shows its CURRENT value before editing, and the selected
 * field's explanation is always visible below the list.
 */

interface Field {
  key: string;
  label: string;
  explain: string;
  kind: "personal" | "discord-route" | "discord-enabled" | "env";
  /** Default shown for env fields when neither env nor config set it. */
  fallback?: string;
}

interface Section {
  name: string;
  description: string;
  fields: Field[];
}

const SECTIONS: Section[] = [
  {
    name: "Personal info",
    description:
      "Your safe_fields — the only values ever typed into application forms — plus how the TUI addresses you. Stored in config/targets.json (gitignored, local only).",
    fields: [
      { kind: "personal", key: "preferred_name", label: "Preferred name", explain: "How the TUI greets you in the sidebar. Leave empty to fall back to your first name." },
      { kind: "personal", key: "first_name", label: "First name", explain: "Legal first name typed into application forms." },
      { kind: "personal", key: "last_name", label: "Last name", explain: "Legal last name typed into application forms." },
      { kind: "personal", key: "email", label: "Email", explain: "Contact email used on applications." },
      { kind: "personal", key: "phone", label: "Phone", explain: "Contact phone number used on applications." },
      { kind: "personal", key: "linkedin_url", label: "LinkedIn URL", explain: "Full LinkedIn profile URL for application forms." },
      { kind: "personal", key: "github_url", label: "GitHub URL", explain: "Full GitHub profile URL for application forms." },
      { kind: "personal", key: "graduation_date", label: "Graduation", explain: "Graduation date (Month Year) — forms and the fit gate both use it." },
    ],
  },
  {
    name: "Discord webhooks",
    description:
      "Optional status updates. Each Discord webhook is bound to ONE channel — separate channels need separate links. Stored in config/discord_config.json.",
    fields: [
      { kind: "discord-enabled", key: "enabled", label: "Enabled", explain: "Master switch — enter toggles it. Off: outcomes stay local (state files + TUI) and no webhook is ever called." },
      { kind: "discord-route", key: "success", label: "success", explain: "Webhook URL for successful applications. Required when Discord is enabled." },
      { kind: "discord-route", key: "needs_review", label: "needs_review", explain: "Webhook URL for jobs that need your manual review. Required when enabled." },
      { kind: "discord-route", key: "failed", label: "failed", explain: "Webhook URL for failed application attempts. Required when enabled." },
      { kind: "discord-route", key: "summary", label: "summary", explain: "Webhook URL for the end-of-batch summary. Optional — empty falls back to the success webhook." },
    ],
  },
  {
    name: "Environment",
    description:
      "Persisted APPLYR_* overrides, saved to config/env.json and exported by every run. A variable set in your real shell environment always wins. Empty a value to return to the default.",
    fields: [
      { kind: "env", key: "APPLYR_LOG_DIR", label: "Log directory", explain: "Where run/session logs and the heartbeat are stored. Relative paths resolve inside the project. (Agent fetch-scratch stays in the project's logs/tmp.)", fallback: "logs" },
      { kind: "env", key: "APPLYR_SESSION_CAP", label: "Session cap", explain: "Default applications-per-run cap, 1-25. Runs may lower it; 25 is the hard ceiling.", fallback: "25" },
      { kind: "env", key: "APPLYR_KEEP_SESSION_LOGS", label: "Keep logs", explain: "How many session logs to keep before the oldest are pruned.", fallback: "30" },
      { kind: "env", key: "APPLYR_LOCK_MAX_AGE_MIN", label: "Lock max age", explain: "Minutes before a hung run's lock is force-reclaimed by the next scheduled tick.", fallback: "60" },
      { kind: "env", key: "APPLYR_AUTO_UPDATE", label: "Auto-update", explain: "1 = self-update from GitHub main on every run/launch; 0 = never update automatically.", fallback: "1" },
      { kind: "env", key: "APPLYR_HARNESS", label: "Harness", explain: "Coding agent for runs: opencode | claude | codex | copilot. Empty = config/harness.json, then auto-detect.", fallback: "(harness.json / auto)" },
    ],
  },
];

function currentValue(root: string, field: Field): { value: string; note: string } {
  switch (field.kind) {
    case "personal": {
      const v = readSafeField(root, field.key);
      return { value: v || "(not set)", note: "" };
    }
    case "discord-enabled":
      return { value: readDiscordEnabled(root) ? "yes" : "no", note: "" };
    case "discord-route": {
      const v = readDiscordRoute(root, field.key);
      return { value: v || "(not set)", note: "" };
    }
    case "env": {
      const eff = effectiveEnv(root, field.key, field.fallback ?? "");
      return { value: eff.value || "(not set)", note: eff.origin };
    }
  }
}

export function SettingsScreen({
  root,
  active,
  onInputActiveChange,
  onSettingsChange,
  contentRows = 20,
}: {
  root: string;
  active: boolean;
  onInputActiveChange: (active: boolean) => void;
  /** Fired after any write so the shell (sidebar name, etc.) refreshes. */
  onSettingsChange?: () => void;
  contentRows?: number;
}) {
  const [sectionCursor, setSectionCursor] = useState(0);
  const [inSection, setInSection] = useState(false);
  const [fieldCursor, setFieldCursor] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [editCursor, setEditCursor] = useState(0);
  const [message, setMessage] = useState("");
  const [nonce, setNonce] = useState(0); // re-read files after writes

  const section = SECTIONS[sectionCursor];
  const field = section.fields[fieldCursor];

  // Inside a section (or editing) this screen owns the keyboard — esc
  // backs out one level instead of jumping to the welcome menu.
  const captures = active && (inSection || editing);
  useEffect(() => {
    onInputActiveChange(captures);
    return () => onInputActiveChange(false);
  }, [captures, onInputActiveChange]);

  const save = (value: string) => {
    try {
      if (field.kind === "personal") writeSafeField(root, field.key, value);
      else if (field.kind === "discord-route") writeDiscordRoute(root, field.key, value);
      else if (field.kind === "env") writeEnvOverride(root, field.key, value);
      setMessage(`Saved ${field.label}.`);
      onSettingsChange?.();
    } catch (err) {
      setMessage(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    setNonce((n) => n + 1);
  };

  useInput(
    (input, key) => {
      if (editing) {
        if (key.return) {
          setEditing(false);
          save(editValue.trim());
        } else if (key.escape) {
          setEditing(false);
          setMessage("Edit cancelled — value unchanged.");
        } else if (key.leftArrow) {
          setEditCursor(moveCursorLeft({ value: editValue, cursor: editCursor }).cursor);
        } else if (key.rightArrow) {
          setEditCursor(moveCursorRight({ value: editValue, cursor: editCursor }).cursor);
        } else if (key.backspace || key.delete) {
          const next = deleteBackward({ value: editValue, cursor: editCursor });
          setEditValue(next.value);
          setEditCursor(next.cursor);
        } else if (!key.ctrl && !key.meta && input && !/\p{C}/u.test(input)) {
          const next = insertAtCursor({ value: editValue, cursor: editCursor }, input);
          setEditValue(next.value);
          setEditCursor(next.cursor);
        }
        return;
      }
      if (inSection) {
        if (key.escape) {
          setInSection(false);
          setMessage("");
          return;
        }
        if (key.upArrow || input === "k") return setFieldCursor((c) => Math.max(0, c - 1));
        if (key.downArrow || input === "j")
          return setFieldCursor((c) => Math.min(section.fields.length - 1, c + 1));
        if (key.return || input === "e") {
          if (field.kind === "discord-enabled") {
            const next = !readDiscordEnabled(root);
            writeDiscordEnabled(root, next);
            setMessage(`Discord reporting ${next ? "enabled" : "disabled"}.`);
            setNonce((n) => n + 1);
            onSettingsChange?.();
            return;
          }
          const current = currentValue(root, field);
          const initial =
            field.kind === "env"
              ? readEnvOverride(root, field.key)
              : current.value === "(not set)" ? "" : current.value;
          setEditValue(initial);
          setEditCursor(initial.length);
          setEditing(true);
          setMessage("");
        }
        return;
      }
      // Section menu — plain navigation; esc here is App's (welcome menu).
      if (key.upArrow || input === "k")
        return setSectionCursor((c) => (c + SECTIONS.length - 1) % SECTIONS.length);
      if (key.downArrow || input === "j" || key.tab)
        return setSectionCursor((c) => (c + 1) % SECTIONS.length);
      if (key.return) {
        setInSection(true);
        setFieldCursor(0);
        setMessage("");
      }
    },
    { isActive: active && Boolean(process.stdin.isTTY) },
  );

  void nonce; // reads below re-run every render; nonce forces one after writes

  if (!inSection) {
    const selected = SECTIONS[sectionCursor];
    return (
      <Box flexDirection="column">
        <Text bold color={theme.accent}>
          Settings <Text dimColor>view current values, then change them</Text>
        </Text>
        <Box marginTop={1} flexDirection="column">
          {SECTIONS.map((s, i) => {
            const focused = i === sectionCursor;
            return (
              <Text key={s.name} color={focused ? theme.accent : undefined} bold={focused} wrap="truncate-end">
                {focused ? ">" : " "} [{focused ? "x" : " "}] {s.name}
              </Text>
            );
          })}
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>About</Text>
          <Text wrap="wrap">{selected.description}</Text>
        </Box>
        {message ? (
          <Box marginTop={1}>
            <Text dimColor>{message}</Text>
          </Box>
        ) : null}
      </Box>
    );
  }

  const rows = section.fields.map((f) => ({ f, cur: currentValue(root, f) }));
  return (
    <Box flexDirection="column">
      <Text bold color={theme.accent}>
        Settings <Text dimColor>· {section.name}</Text>
      </Text>
      <Box marginTop={1} flexDirection="column">
        {rows.map(({ f, cur }, i) => {
          const focused = i === fieldCursor;
          const line = `${focused ? ">" : " "} [${focused ? "x" : " "}] ${f.label.padEnd(15)} ${cur.value}${cur.note && cur.note !== "default" ? `  (${cur.note})` : ""}`;
          return focused ? (
            <Text key={f.key} color={theme.accent} bold wrap="truncate-end">{line}</Text>
          ) : (
            <Text key={f.key} wrap="truncate-end">{line}</Text>
          );
        })}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text dimColor>{field.label} — currently: {currentValue(root, field).value}</Text>
        <Text wrap="wrap">{field.explain}</Text>
      </Box>

      {editing ? (
        <Box marginTop={1}>
          <Text color={theme.accent}>new value </Text>
          <InlineTextInput
            value={editValue}
            cursor={editCursor}
            active
            placeholder="(empty clears the value)"
            wrap="truncate-end"
          />
        </Box>
      ) : null}

      {message ? (
        <Box marginTop={1}>
          <Text color={message.startsWith("Save failed") ? theme.danger : undefined} dimColor={!message.startsWith("Save failed")}>
            {statusGlyph.applied} {message}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

export const SETTINGS_HINTS = "↑↓ section · enter open";
export const SETTINGS_SECTION_HINTS = "↑↓ field · enter edit/toggle · esc back";
export const SETTINGS_EDIT_HINTS = "type · enter save · esc cancel · backspace erase";
