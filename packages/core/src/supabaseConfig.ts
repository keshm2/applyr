import fs from "node:fs";
import path from "node:path";

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

/**
 * Reads config/supabase.json — the live, gitignored Supabase project URL +
 * anon key (config/supabase.example.json is the committed placeholder
 * template, same convention as every other config/*.example.json file).
 * Returns undefined when the file is missing or still holds the example
 * placeholders, so callers (the desktop app's entry/auth screens) can show
 * a "hosted mode isn't configured yet" state instead of crashing.
 */
export function readSupabaseConfig(root: string): SupabaseConfig | undefined {
  return readSupabaseConfigFile(root, "supabase.json");
}

/**
 * Reads config/job_cache_supabase.json — a deliberately separate project
 * from config/supabase.json's (hosted auth/profile sync). Split apart
 * 2026-07-23 after the auth project's disk I/O usage climbed toward its
 * free-tier limit (partly from job_cache's own write volume — ~14k rows
 * across 47 companies, refreshed hourly) and started producing Cloudflare
 * 522s on unrelated requests; the two workloads no longer share one
 * project's resource ceiling. job_cache holds no personal data (see
 * supabase/migrations/0003_job_cache.sql's RLS comment), so this project
 * doesn't need to be the same one hosted auth uses — jobCache.ts and
 * refreshJobCache.ts are the only callers, both entirely independent of
 * the desktop app's SupabaseAdapter/auth flow, which still reads
 * readSupabaseConfig() above unchanged.
 */
export function readJobCacheSupabaseConfig(root: string): SupabaseConfig | undefined {
  return readSupabaseConfigFile(root, "job_cache_supabase.json");
}

function readSupabaseConfigFile(root: string, filename: string): SupabaseConfig | undefined {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(root, "config", filename), "utf8"),
    ) as Partial<SupabaseConfig>;
    const url = (parsed.url ?? "").trim();
    const anonKey = (parsed.anonKey ?? "").trim();
    if (!url || !anonKey) return undefined;
    if (url.includes("YOUR_PROJECT_REF") || anonKey === "YOUR_SUPABASE_ANON_KEY") return undefined;
    return { url, anonKey };
  } catch {
    return undefined;
  }
}
