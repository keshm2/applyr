import fs from "node:fs/promises";
import path from "node:path";
import { readJobCacheSupabaseConfig } from "./supabaseConfig.js";
import type { JobSource, SearchJob } from "./jobsSort.js";

// Cache lookups must never make a search feel slower than today. Tuned
// against the live table: a full 4-source, ~35-company concurrent batch
// measured 232-655ms unfiltered (jd_text is the dominant per-row cost —
// see UNFILTERED_PER_COMPANY_LIMIT/FILTERED_PER_COMPANY_LIMIT below),
// with real margin below this budget. If a lookup doesn't come back
// within it, falling through to the existing live fetch (its own,
// longer per-source budget — see SOURCE_DEADLINE_MS in jobs.ts) is
// always the safer failure mode.
const CACHE_LOOKUP_TIMEOUT_MS = 1200;

// Per company, not overall. Capping per company (via the job_cache_search
// RPC's lateral join, not a plain global LIMIT) is load-bearing: a
// global LIMIT across N companies returns Postgres's first-scanned rows
// combined, which in practice let 1-2 companies fill the whole cap and
// left every other configured company with zero results even though
// real cached rows existed for them (see migration 0004's header).
//
// Two different limits, not one — measured live, they have very
// different cost profiles now that the RPC pre-filters by title
// (migration 0005) before applying either cap:
// - UNFILTERED_PER_COMPANY_LIMIT (browsing, no search query typed):
//   10, picked empirically — measured live at 10/15/25/40 across all
//   four sources, and 10 was the last value with consistently fast
//   (sub-second), non-spiky latency; 15 already showed occasional 2s
//   spikes. jd_text (full description text, required so checkJobFit()
//   works on cache-derived jobs without a live refetch) is what makes
//   row count this expensive with nothing narrowing the row set first.
// - FILTERED_PER_COMPANY_LIMIT (a real search query, so titleWords is
//   non-empty): the ILIKE pre-filter already narrows each company down
//   to plausibly-relevant rows before this cap ever applies, so a much
//   higher cap costs almost nothing — measured live, raising a
//   pre-filtered query from 10 to 75 went 77ms -> 103ms. Confirmed live
//   this mattered: a real "software engineer intern" search had 19
//   matching rows sitting past the old shared 10-cap for one source
//   alone, silently excluded even though the RPC had already filtered
//   down to genuine candidates.
// Matches jobs.ts's MAX_PAGE_SIZE — a merged, deduped, final result
// page can never exceed that regardless of source, so there's no
// value in capping any single company past it.
const UNFILTERED_PER_COMPANY_LIMIT = 10;
const FILTERED_PER_COMPANY_LIMIT = 75;

export interface JobCacheLookup {
  source: JobSource;
  companySlugs: string[];
  /** '' for the unfiltered-board sources (Ashby/Lever/Greenhouse/
   *  SmartRecruiters all support a full, unfiltered board fetch — see
   *  refreshJobCache.ts, which is what populates rows under query=''). */
  query: string;
  /** The user's actual search words (lowercased), used as a loose
   *  ILIKE pre-filter inside the job_cache_search RPC (migration 0005)
   *  — applied BEFORE the per-company cap, not after. Without this, a
   *  narrow query like "intern" could come back with zero cache
   *  results for a company that has real intern postings cached,
   *  simply because none of them happened to land in an arbitrary
   *  unfiltered top-N sample (confirmed live). Empty/omitted disables
   *  filtering (the browse-everything case — also switches to the
   *  lower UNFILTERED_PER_COMPANY_LIMIT). Deliberately loose (plain substring, not the
   *  inflection-aware matching titleMatchesQuery does) — that function
   *  still runs afterward on the merged result set and is the
   *  authoritative filter; this only has to be loose enough not to
   *  exclude a real match before that ever sees it. */
  titleWords?: string[];
}

interface JobCacheRow {
  company: string;
  title: string;
  url: string;
  apply_url: string | null;
  external_job_id: string | null;
  location: string | null;
  jd_text: string | null;
  posted_at: string | null;
}

/**
 * Reads cached postings from the shared Supabase job_cache table via the
 * job_cache_search RPC (supabase/migrations/0003_job_cache.sql,
 * 0004_job_cache_search_fn.sql) in place of a live per-source fetch.
 * Read-only, anon-key access — the RPC is `security invoker`, subject to
 * job_cache's own RLS policy, which allows public SELECT on unexpired
 * rows regardless of sign-in state, since postings aren't personal data.
 *
 * Returns undefined — never throws — whenever the cache isn't usable for
 * any reason: no config/job_cache_supabase.json on this install,
 * unreachable, slow, or genuinely empty. Every caller treats undefined as
 * "fall back to the existing live fetch," exactly as if this function
 * didn't exist. A cache MISS is not evidence of zero jobs — an empty
 * resultset must never be returned as "here are the results," only as
 * "try live." Deliberately its own config, separate from
 * config/supabase.json (hosted auth) — see supabaseConfig.ts's
 * readJobCacheSupabaseConfig for why.
 */
export async function readJobCache(root: string, lookup: JobCacheLookup): Promise<SearchJob[] | undefined> {
  if (lookup.companySlugs.length === 0) return undefined;
  const config = readJobCacheSupabaseConfig(root);
  if (!config) return undefined;

  const titleWords = lookup.titleWords ?? [];
  const perCompanyLimit = titleWords.length > 0 ? FILTERED_PER_COMPANY_LIMIT : UNFILTERED_PER_COMPANY_LIMIT;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CACHE_LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(`${config.url}/rest/v1/rpc/job_cache_search`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${config.anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_source: lookup.source,
        p_company_slugs: lookup.companySlugs,
        p_query: lookup.query,
        p_per_company_limit: perCompanyLimit,
        p_title_words: titleWords,
      }),
    });
    if (!response.ok) return undefined;
    const rows = (await response.json()) as JobCacheRow[];
    if (rows.length === 0) return undefined;
    return rows.map((row): SearchJob => ({
      source: lookup.source,
      company: row.company,
      title: row.title,
      url: row.url,
      apply_url: row.apply_url ?? undefined,
      external_job_id: row.external_job_id ?? undefined,
      location: row.location ?? undefined,
      jd_text: row.jd_text ?? undefined,
      posted_at: row.posted_at ?? undefined,
    }));
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

const CACHE_SOURCE_KEY: Partial<Record<JobSource, string>> = {
  ashbyhq: "ashby_company_slugs",
  lever: "lever_company_slugs",
  greenhouse: "greenhouse_company_slugs",
  smartrecruiters: "smartrecruiters_company_slugs",
};

/**
 * Which of a user's own configured company slugs (config/targets.json,
 * per-user, not this file) are actually covered by the shared cache
 * (config/job_cache_targets.json, committed, the same 47-ish companies
 * for every install). These are two independent lists — a personal
 * install's targets are never the same set as the shared cache's, so
 * the overlap is often partial.
 *
 * This function exists to fix a real bug found live: readJobCache()
 * doing one combined lookup across a source's full slug list treated
 * ANY non-empty result as a full cache hit, silently never live-fetching
 * whichever of the user's companies simply weren't in the shared cache
 * at all (confirmed live: as low as 0% overlap on some sources) — every
 * search was quietly missing most of a user's own configured companies.
 * Callers (jobs.ts's maybeCached) use this to split a source's slugs
 * into a cache-eligible subset and a live-only subset that always gets
 * live-fetched regardless of the cache outcome.
 *
 * Never throws — a missing/unreadable file just means nothing is
 * cache-eligible, which safely forces every company to live-fetch
 * rather than silently dropping any of them.
 */
export async function cacheEligibleSlugs(root: string, source: JobSource, requested: string[]): Promise<Set<string>> {
  const key = CACHE_SOURCE_KEY[source];
  if (!key || requested.length === 0) return new Set();
  try {
    const raw = await fs.readFile(path.join(root, "config", "job_cache_targets.json"), "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const cachedSlugs = new Set((parsed[key] as string[] | undefined) ?? []);
    return new Set(requested.filter((slug) => cachedSlugs.has(slug)));
  } catch {
    return new Set();
  }
}
