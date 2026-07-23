/**
 * Populates the shared Supabase job_cache table (see
 * supabase/migrations/0003_job_cache.sql) so searchJobs()'s cache checks
 * (jobCache.ts) actually have something to hit. NOT part of this
 * package's public export surface (see package.json's "exports" map —
 * this file is deliberately absent from it) and never imported by any
 * TUI/desktop entry point, so it never ships inside app/'s bundled CLI
 * or the desktop app's Node subprocess bridge.
 *
 * Run standalone, holding the Supabase secret key (Project Settings →
 * API Keys → "Secret keys" — sb_secret_..., the current replacement for
 * the legacy service_role JWT; authorizes via the same service_role
 * Postgres role and still sets BYPASSRLS, so it bypasses RLS identically.
 * This is the only thing in the whole codebase that should ever hold
 * that key; it must never reach config/supabase.json, a client bundle,
 * or any file that gets committed):
 *
 *   SUPABASE_SECRET_KEY=sb_secret_... node packages/core/dist/refreshJobCache.js
 *
 * Locally, the project URL comes from config/supabase.json (same file
 * the desktop app reads). In CI (.github/workflows/refresh-job-cache.yml,
 * scheduled every 90 minutes — under job_cache's 2h TTL) that file
 * doesn't exist on a fresh checkout, so SUPABASE_URL is read as a direct
 * override first — not secret, just the project's own URL, stored as a
 * plain repo secret alongside SUPABASE_SECRET_KEY for convenience.
 *
 * Refreshes the four sources that support a full, unfiltered board fetch
 * — Ashby, Lever, Greenhouse, SmartRecruiters — using
 * config/job_cache_targets.json's company slugs. That file is
 * deliberately separate from config/targets.json (gitignored, holds this
 * operator's personal profile/PII) — it's committed, so a CI checkout
 * can see it, and it must only ever hold company slugs. Every row is
 * written under query='' (see jobCache.ts's header for why: query-string
 * matching happens downstream against the merged result set, identically
 * whether a job came from cache or a live fetch).
 *
 * Amazon/Oracle/Workday are Python-backed and query-parameterized (their
 * APIs don't offer a "list everything" mode the way the four above do —
 * see jobs.ts's fetchAmazon/fetchOracle/fetchWorkday) — deliberately
 * left out of this first pass rather than guessing at a query set to
 * seed them with. searchJobs() already skips the cache check for those
 * three entirely (see maybeCached's call sites in jobs.ts), so this gap
 * is inert, not silently broken.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { findProjectRoot } from "./project.js";
import { readSupabaseConfig } from "./supabaseConfig.js";
import { configured, fetchAshby, fetchLever, fetchGreenhouse, fetchSmartRecruiters } from "./jobs.js";
import type { SearchJob, JobSource } from "./jobsSort.js";

const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // matches job_cache's own column default (2h) — kept explicit here so upserts refresh it, not just inserts.

interface JobCacheTargets {
  ashby_company_slugs?: string[];
  lever_company_slugs?: string[];
  greenhouse_company_slugs?: string[];
  smartrecruiters_company_slugs?: string[];
}

async function readJobCacheTargets(root: string): Promise<JobCacheTargets> {
  const raw = await fs.readFile(path.join(root, "config", "job_cache_targets.json"), "utf8");
  return JSON.parse(raw) as JobCacheTargets;
}

interface RefreshSource {
  source: JobSource;
  slugs: string[];
  fetch: () => Promise<{ jobs: SearchJob[] }>;
}

function jobCacheRow(source: JobSource, slug: string, query: string, job: SearchJob, now: Date) {
  return {
    source,
    company_slug: slug,
    query,
    job_key: job.external_job_id || job.url,
    external_job_id: job.external_job_id ?? null,
    company: job.company,
    title: job.title,
    location: job.location ?? null,
    url: job.url,
    apply_url: job.apply_url ?? null,
    normalized_url: job.url,
    ats_system: source,
    posted_at: job.posted_at ?? null,
    jd_text: job.jd_text ?? null,
    fetched_at: now.toISOString(),
    expires_at: new Date(now.getTime() + CACHE_TTL_MS).toISOString(),
  };
}

async function upsert(url: string, secretKey: string, rows: ReturnType<typeof jobCacheRow>[]): Promise<void> {
  if (rows.length === 0) return;
  // apikey + an *identical* Authorization: Bearer value — the new key
  // format (secret or publishable) is rejected in Authorization unless
  // it exactly matches apikey (see Supabase's API keys docs); this is
  // the one header shape that's valid for both the new secret key and
  // the legacy service_role JWT, so it works either way.
  const response = await fetch(`${url}/rest/v1/job_cache?on_conflict=source,company_slug,query,job_key`, {
    method: "POST",
    headers: {
      apikey: secretKey,
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!response.ok) {
    throw new Error(`job_cache upsert failed: HTTP ${response.status} — ${await response.text()}`);
  }
}

async function main(): Promise<void> {
  // SUPABASE_SECRET_KEY is the current name; SUPABASE_SERVICE_ROLE_KEY
  // still honored for anyone running this against a project still on
  // legacy JWT keys.
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secretKey) {
    console.error("SUPABASE_SECRET_KEY is not set — refusing to run. This must never live in a file.");
    process.exit(1);
  }
  const root = findProjectRoot();
  // SUPABASE_URL overrides config/supabase.json when set (CI has no such
  // file on a fresh checkout — see this file's header). Locally, neither
  // set, falls back to the same config file the desktop app reads.
  const url = process.env.SUPABASE_URL || readSupabaseConfig(root)?.url;
  if (!url) {
    console.error("Neither SUPABASE_URL nor a configured config/supabase.json was found — nothing to refresh against.");
    process.exit(1);
  }
  const targets = await readJobCacheTargets(root);

  const sources: RefreshSource[] = [
    { source: "ashbyhq", slugs: configured(targets.ashby_company_slugs), fetch: () => fetchAshby(configured(targets.ashby_company_slugs)) },
    { source: "lever", slugs: configured(targets.lever_company_slugs), fetch: () => fetchLever(configured(targets.lever_company_slugs)) },
    { source: "greenhouse", slugs: configured(targets.greenhouse_company_slugs), fetch: () => fetchGreenhouse(configured(targets.greenhouse_company_slugs)) },
    { source: "smartrecruiters", slugs: configured(targets.smartrecruiters_company_slugs), fetch: () => fetchSmartRecruiters(configured(targets.smartrecruiters_company_slugs), "") },
  ];

  const now = new Date();
  for (const { source, slugs, fetch } of sources) {
    if (slugs.length === 0) {
      console.log(`${source}: no company slugs configured, skipping`);
      continue;
    }
    const { jobs } = await fetch();
    // job.company is the slug itself for these four sources (see jobs.ts's
    // fetchAshby/fetchLever/fetchGreenhouse/fetchSmartRecruiters), so this
    // groups fetched postings back by the slug they actually came from.
    const rows = jobs.map((job) => jobCacheRow(source, job.company, "", job, now));
    await upsert(url, secretKey, rows);
    console.log(`${source}: cached ${rows.length} postings across ${slugs.length} companies`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
