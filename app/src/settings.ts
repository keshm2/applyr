import fs from "node:fs";
import path from "node:path";

/**
 * Read/write helpers for the Settings screen. These touch CONFIG files
 * only (config/targets.json safe_fields, config/discord_config.json,
 * config/env.json) — the same files the setup wizard writes; runtime
 * STATE stays with the Python helpers. Writes are read-modify-write so
 * unrelated keys are preserved.
 */

type Json = Record<string, unknown>;

function readJson(file: string): Json {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return typeof parsed === "object" && parsed !== null ? (parsed as Json) : {};
  } catch {
    return {};
  }
}

function writeJson(file: string, data: Json): void {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

// --- Personal info (config/targets.json safe_fields) -----------------------

const targetsPath = (root: string) => path.join(root, "config", "targets.json");

export function readSafeField(root: string, key: string): string {
  const safe = (readJson(targetsPath(root)).safe_fields ?? {}) as Json;
  const val = String(safe[key] ?? "").trim();
  return val === "REPLACE_ME" || /^YOUR_/.test(val) ? "" : val;
}

export function writeSafeField(root: string, key: string, value: string): void {
  const file = targetsPath(root);
  const targets = readJson(file);
  const safe = (targets.safe_fields ?? {}) as Json;
  safe[key] = value;
  targets.safe_fields = safe;
  writeJson(file, targets);
}

/** Name the TUI greets the user by: preferred_name, else first_name. */
export function displayName(root: string): string | undefined {
  return readSafeField(root, "preferred_name") || readSafeField(root, "first_name") || undefined;
}

// --- Discord (config/discord_config.json) ----------------------------------

const discordPath = (root: string) => path.join(root, "config", "discord_config.json");

export function readDiscordEnabled(root: string): boolean {
  const cfg = readJson(discordPath(root));
  if (!fs.existsSync(discordPath(root))) return false;
  return cfg.enabled === undefined ? true : Boolean(cfg.enabled);
}

export function writeDiscordEnabled(root: string, enabled: boolean): void {
  const file = discordPath(root);
  const cfg = readJson(file);
  cfg.enabled = enabled;
  if (cfg.webhooks === undefined) cfg.webhooks = {};
  writeJson(file, cfg);
}

export function readDiscordRoute(root: string, route: string): string {
  const hooks = (readJson(discordPath(root)).webhooks ?? {}) as Json;
  const val = String(hooks[route] ?? "").trim();
  return val === "REPLACE_ME" ? "" : val;
}

export function writeDiscordRoute(root: string, route: string, url: string): void {
  const file = discordPath(root);
  const cfg = readJson(file);
  const hooks = (cfg.webhooks ?? {}) as Json;
  if (url) hooks[route] = url;
  else delete hooks[route];
  cfg.webhooks = hooks;
  if (cfg.enabled === undefined) cfg.enabled = true;
  writeJson(file, cfg);
}

// --- Environment overrides (config/env.json) --------------------------------
// Persisted APPLYR_* overrides; the runner exports them at startup and the
// TUI reads them for its own paths. A real environment variable always wins.

const envPath = (root: string) => path.join(root, "config", "env.json");

export function readEnvOverride(root: string, key: string): string {
  return String(readJson(envPath(root))[key] ?? "").trim();
}

export function writeEnvOverride(root: string, key: string, value: string): void {
  const file = envPath(root);
  const cfg = readJson(file);
  if (value) cfg[key] = value;
  else delete cfg[key];
  writeJson(file, cfg);
}

/** Effective value + where it came from (env > config/env.json > default). */
export function effectiveEnv(
  root: string,
  key: string,
  fallback: string,
): { value: string; origin: "env" | "config" | "default" } {
  const fromEnv = (process.env[key] ?? "").trim();
  if (fromEnv) return { value: fromEnv, origin: "env" };
  const fromConfig = readEnvOverride(root, key);
  if (fromConfig) return { value: fromConfig, origin: "config" };
  return { value: fallback, origin: "default" };
}

/** Log directory honored by the runner and the TUI's log readers. */
export function logDir(root: string): string {
  const dir = effectiveEnv(root, "APPLYR_LOG_DIR", "logs").value;
  return path.isAbsolute(dir) ? dir : path.join(root, dir);
}
