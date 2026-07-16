import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { py } from "./platform.js";
import { effectiveEnv, readTargetsArrayList } from "./settings.js";

const execFileAsync = promisify(execFile);
const FETCH_TIMEOUT_MS = 15_000;
// User-configurable via Settings > Environment > "Jobs per page"
// (APPLYR_JOBS_PER_PAGE) — how many results one manual search keeps.
export const MIN_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 75;
export const DEFAULT_PAGE_SIZE = 50;

function resolvePageSize(root: string): number {
  const raw = Number.parseInt(effectiveEnv(root, "APPLYR_JOBS_PER_PAGE", String(DEFAULT_PAGE_SIZE)).value, 10);
  if (!Number.isFinite(raw)) return DEFAULT_PAGE_SIZE;
  return Math.max(MIN_PAGE_SIZE, Math.min(MAX_PAGE_SIZE, raw));
}

/** Most-recently-posted first — the manual search's default (only) sort.
 *  Jobs with no parseable posted_at sort last, never first, so an
 *  unknown date never masquerades as "newest". */
function postedTime(job: SearchJob): number {
  const t = job.posted_at ? new Date(job.posted_at).getTime() : NaN;
  return Number.isNaN(t) ? -Infinity : t;
}

export function sortByPostedDesc(jobs: SearchJob[]): SearchJob[] {
  return [...jobs].sort((a, b) => postedTime(b) - postedTime(a));
}

/**
 * Does this posting sit in one of the user's preferred_locations?
 *
 * Deliberately forgiving in one direction only: a preference of
 * "Seattle, WA" matches a posting that says just "Seattle" or "Seattle,
 * Washington, United States", because boards write locations a dozen
 * different ways. It never matches on the state alone — "WA" appearing
 * somewhere is not a Seattle job.
 */
export function isPreferredLocation(job: SearchJob, preferred: string[]): boolean {
  const loc = (job.location ?? "").toLowerCase();
  if (!loc || preferred.length === 0) return false;
  return preferred.some((p) => {
    const needle = p.trim().toLowerCase();
    if (!needle) return false;
    if (loc.includes(needle)) return true;
    // Compare on the city part only ("Seattle, WA" -> "seattle"); require a
    // real word so a 1-2 char fragment can't match half the country.
    const city = needle.split(",")[0]?.trim() ?? "";
    return city.length >= 3 && loc.includes(city);
  });
}

/**
 * Preferred-location matches first, then newest-first within each group.
 *
 * preferred_locations is a priority list, not a filter (AGENTS.md
 * "Location handling"), and this is the manual search's expression of that
 * priority: jobs where the user actually wants to work land on the first
 * page, everything else still appears, just after them. With no preferred
 * locations set this degrades exactly to sortByPostedDesc.
 */
export function sortByPreferredThenPosted(jobs: SearchJob[], preferred: string[]): SearchJob[] {
  if (preferred.length === 0) return sortByPostedDesc(jobs);
  return [...jobs].sort((a, b) => {
    const pa = isPreferredLocation(a, preferred) ? 1 : 0;
    const pb = isPreferredLocation(b, preferred) ? 1 : 0;
    if (pa !== pb) return pb - pa;
    return postedTime(b) - postedTime(a);
  });
}

/** Split a title into comparable word tokens (drops punctuation, so
 *  "Engineer, Backend" and "Engineer (Backend)" tokenize the same). */
function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9+#]+/i).filter(Boolean);
}

// "intern" needs its own rule in BOTH directions. A subsequence scorer
// treats it as satisfied by scattered letters ("Identity"); plain substring
// makes it a prefix of "Internal"/"International"/"Internet". So it matches
// only as a whole word — intern/interns/internship/internships.
const INTERN_RE = /\bintern(s|ship|ships)?\b/i;

/**
 * Does one query word match a job title?
 *
 * The old rule was `titleLower.includes(term)` for every term, which is
 * why searching "software engineering intern" missed "Software Engineer
 * Intern": "engineering" is not a substring of "engineer". Job titles and
 * the words people search with differ constantly by inflection
 * (engineer/engineering, develop/developer/development,
 * grad/graduate/graduating), and requiring the exact literal form hid real
 * postings.
 *
 * So a term now matches a title word when either is a prefix of the other
 * — which covers every inflection pair above without a stemmer, since the
 * divergence is always in the suffix. The min-length guard is what keeps
 * that honest: short tokens ("ai", "ml", "go", "qa") must match a title
 * word exactly, so "ai" can't match "aid" and "go" can't match "google".
 */
const MIN_PREFIX_LEN = 4;

export function termMatchesTitle(term: string, title: string): boolean {
  if (term === "intern") return INTERN_RE.test(title);
  const titleWords = words(title);
  return titleWords.some((word) => {
    if (word === term) return true;
    if (Math.min(word.length, term.length) < MIN_PREFIX_LEN) return false;
    return word.startsWith(term) || term.startsWith(word);
  });
}

/** Every query word must match somewhere in the title (AND, not OR) — so
 *  a search stays predictable and narrow; only the per-word comparison got
 *  more forgiving, not the overall gate. */
export function titleMatchesQuery(title: string, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  return terms.every((term) => termMatchesTitle(term, title));
}

export type JobSource = "ashbyhq" | "lever" | "workday" | "greenhouse";

export interface SearchJob {
  source: JobSource;
  company: string;
  title: string;
  url: string;
  apply_url?: string;
  external_job_id?: string;
  location?: string;
  jd_text?: string;
  /** ISO 8601 when known. Ashby/Lever/Greenhouse give an exact timestamp;
   *  Workday's public API only exposes a bucketed relative-age string
   *  ("Posted 3 Days Ago"), approximated to an ISO date on the Python side. */
  posted_at?: string;
}

export interface SourceResult {
  state: "ready" | "warning" | "skipped";
  count: number;
  detail?: string;
}

export interface SearchResult {
  jobs: SearchJob[];
  sources: Record<JobSource, SourceResult>;
}

export interface FitResult {
  fit_status: "candidate" | "needs_review" | "skipped_unfit";
  fit_score: number;
  reasoning: string;
}

interface Targets {
  ashby_company_slugs?: string[];
  lever_company_slugs?: string[];
  greenhouse_company_slugs?: string[];
  preferred_locations?: string[];
}

interface CanonicalJob extends SearchJob {
  job_key: string;
  job_id: string;
  location_tier?: string;
  internship_term?: string;
}

function configured(values: string[] | undefined): string[] {
  return (values ?? []).filter((value) => value && value !== "REPLACE_ME");
}

function displayText(value: unknown): string {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim();
}

function webUrl(value: unknown): string {
  const raw = String(value ?? "").trim();
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

async function readTargets(root: string): Promise<Targets> {
  return JSON.parse(await fs.readFile(path.join(root, "config", "targets.json"), "utf8")) as Targets;
}

/** One retry on any failure (timeout, network blip, transient 5xx/429) —
 *  hitting 8+ boards concurrently occasionally trips a board's rate
 *  limiter or a slow DNS/TLS handshake, and a single retry after a short
 *  pause clears most of those without masking a genuinely dead/renamed
 *  slug (which fails the retry too, and is what should still surface). */
async function fetchJson(url: string, attempt = 0): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (err) {
    if (attempt < 1) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return fetchJson(url, attempt + 1);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function isoOrUndefined(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const d = typeof value === "number" ? new Date(value) : new Date(String(value));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

const SLUG_NAME_MAX = 14;

function sourceSummary(total: number, failedSlugs: string[], count: number): SourceResult {
  if (total === 0) return { state: "skipped", count: 0, detail: "not configured" };
  if (failedSlugs.length > 0) {
    const short = (s: string) => (s.length > SLUG_NAME_MAX ? `${s.slice(0, SLUG_NAME_MAX)}…` : s);
    const names = failedSlugs.slice(0, 2).map(short).join(", ") + (failedSlugs.length > 2 ? "…" : "");
    return { state: "warning", count, detail: `${failedSlugs.length}/${total} failed: ${names}` };
  }
  return { state: "ready", count };
}

async function fetchAshby(slugs: string[]): Promise<{ jobs: SearchJob[]; source: SourceResult }> {
  const results = await Promise.allSettled(
    slugs.map(async (slug) => {
      const payload = (await fetchJson(
        `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`,
      )) as { jobs?: Array<Record<string, unknown>> };
      return (payload.jobs ?? []).flatMap((job): SearchJob[] => {
        const title = displayText(job.title);
        const url = webUrl(job.jobUrl ?? job.applyUrl);
        if (!title || !url) return [];
        return [{
          source: "ashbyhq",
          company: slug,
          title,
          url,
          apply_url: webUrl(job.applyUrl) || undefined,
          external_job_id: displayText(job.id) || undefined,
          location: displayText(job.location) || undefined,
          jd_text: String(job.descriptionPlain ?? "").trim() || undefined,
          posted_at: isoOrUndefined(job.publishedAt),
        }];
      });
    }),
  );
  const jobs = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const failedSlugs = slugs.filter((_, i) => results[i].status === "rejected");
  return { jobs, source: sourceSummary(slugs.length, failedSlugs, jobs.length) };
}

async function fetchLever(slugs: string[]): Promise<{ jobs: SearchJob[]; source: SourceResult }> {
  const results = await Promise.allSettled(
    slugs.map(async (slug) => {
      const payload = (await fetchJson(
        `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`,
      )) as Array<Record<string, unknown>>;
      return (Array.isArray(payload) ? payload : []).flatMap((job): SearchJob[] => {
        const title = displayText(job.text);
        const url = webUrl(job.hostedUrl ?? job.applyUrl);
        if (!title || !url) return [];
        const categories = (job.categories ?? {}) as Record<string, unknown>;
        return [{
          source: "lever",
          company: slug,
          title,
          url,
          apply_url: webUrl(job.applyUrl) || undefined,
          external_job_id: displayText(job.id) || undefined,
          location: displayText(categories.location) || undefined,
          jd_text: String(job.descriptionPlain ?? "").trim() || undefined,
          posted_at: isoOrUndefined(job.createdAt),
        }];
      });
    }),
  );
  const jobs = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const failedSlugs = slugs.filter((_, i) => results[i].status === "rejected");
  return { jobs, source: sourceSummary(slugs.length, failedSlugs, jobs.length) };
}

async function fetchGreenhouse(slugs: string[]): Promise<{ jobs: SearchJob[]; source: SourceResult }> {
  const results = await Promise.allSettled(
    slugs.map(async (slug) => {
      const payload = (await fetchJson(
        `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`,
      )) as { jobs?: Array<Record<string, unknown>> };
      return (payload.jobs ?? []).flatMap((job): SearchJob[] => {
        const title = displayText(job.title);
        const url = webUrl(job.absolute_url);
        if (!title || !url) return [];
        const location = (job.location ?? {}) as Record<string, unknown>;
        return [{
          source: "greenhouse",
          company: slug,
          title,
          url,
          external_job_id: displayText(job.id) || undefined,
          location: displayText(location.name) || undefined,
          jd_text: String(job.content ?? "").replace(/<[^>]+>/g, " ").trim() || undefined,
          posted_at: isoOrUndefined(job.updated_at),
        }];
      });
    }),
  );
  const jobs = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const failedSlugs = slugs.filter((_, i) => results[i].status === "rejected");
  return { jobs, source: sourceSummary(slugs.length, failedSlugs, jobs.length) };
}

async function runJson(root: string, command: string, args: string[]): Promise<unknown> {
  const { stdout } = await execFileAsync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 60_000,
  });
  return JSON.parse(stdout);
}

/** runJson under the resolved Python interpreter (cross-platform). */
function runPyJson(root: string, args: string[]): Promise<unknown> {
  const p = py(args);
  return runJson(root, p.cmd, p.args);
}

async function fetchWorkday(root: string, query: string, pageSize: number): Promise<{ jobs: SearchJob[]; source: SourceResult }> {
  try {
    const wd = py(["scripts/jobs/fetch_workday_listings.py", "--search", query, "--limit", String(pageSize), "--timeout", "15"]);
    const { stdout, stderr } = await execFileAsync(
      wd.cmd,
      wd.args,
      { cwd: root, encoding: "utf8", maxBuffer: 10 * 1024 * 1024, timeout: 60_000 },
    );
    const jobs = stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line) as SearchJob)
      .map((job) => ({
        ...job,
        company: displayText(job.company),
        title: displayText(job.title),
        url: webUrl(job.url),
        location: displayText(job.location) || undefined,
      }))
      .filter((job) => job.company && job.title && job.url);
    const skipped = /tenants=0/.test(stderr);
    return {
      jobs,
      source: skipped
        ? { state: "skipped", count: 0, detail: "not configured" }
        : { state: "ready", count: jobs.length },
    };
  } catch (err) {
    return { jobs: [], source: { state: "warning", count: 0, detail: errorMessage(err) } };
  }
}

const DISABLED_SOURCE: SourceResult = { state: "skipped", count: 0, detail: "disabled" };

export async function searchJobs(
  root: string,
  query: string,
  enabled: Partial<Record<JobSource, boolean>> = {},
): Promise<SearchResult> {
  const targets = await readTargets(root);
  const pageSize = resolvePageSize(root);
  const isOn = (source: JobSource) => enabled[source] !== false;
  const ashbySlugs = isOn("ashbyhq") ? configured(targets.ashby_company_slugs) : [];
  const leverSlugs = isOn("lever") ? configured(targets.lever_company_slugs) : [];
  const greenhouseSlugs = isOn("greenhouse") ? configured(targets.greenhouse_company_slugs) : [];
  const [ashby, lever, greenhouse, workday] = await Promise.all([
    fetchAshby(ashbySlugs),
    fetchLever(leverSlugs),
    fetchGreenhouse(greenhouseSlugs),
    isOn("workday") ? fetchWorkday(root, query, pageSize) : Promise.resolve({ jobs: [], source: DISABLED_SOURCE }),
  ]);
  const seen = new Set<string>();
  const deduped = [...ashby.jobs, ...lever.jobs, ...greenhouse.jobs, ...workday.jobs].filter((job) => {
    if (seen.has(job.url)) return false;
    seen.add(job.url);
    return true;
  });
  // Cut stale postings — old listings that are probably already filled or
  // pulled crowd out genuinely fresh ones, and a bounded window is also
  // what makes the table's year-less short date display unambiguous (see
  // SearchScreen's formatPosted). Unknown-age jobs (no posted_at) are kept
  // rather than dropped — missing data isn't evidence of staleness.
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const recent = deduped.filter((job) => {
    if (!job.posted_at) return true;
    const t = new Date(job.posted_at).getTime();
    return Number.isNaN(t) || t >= sixMonthsAgo.getTime();
  });
  // Title-only match, every query word required, inflection-tolerant per
  // word — see titleMatchesQuery for why exact substring matching was
  // hiding real postings.
  const matched = recent.filter((job) => titleMatchesQuery(job.title, query));
  // Preferred locations sort to the first page; everything else follows.
  const preferred = readTargetsArrayList(root, "preferred_locations");
  const jobs = sortByPreferredThenPosted(matched, preferred).slice(0, pageSize);

  // Counts reflect postings that actually matched the query, not the raw
  // firehose fetched from each board — a lone "2260" next to Ashby told
  // the user nothing about their search and mostly just cluttered the row.
  const matchedCountBySource: Partial<Record<JobSource, number>> = {};
  for (const job of matched) {
    matchedCountBySource[job.source] = (matchedCountBySource[job.source] ?? 0) + 1;
  }
  const withMatchedCount = (source: SourceResult, key: JobSource): SourceResult =>
    source.state === "skipped" ? source : { ...source, count: matchedCountBySource[key] ?? 0 };

  return {
    jobs,
    sources: {
      ashbyhq: withMatchedCount(ashby.source, "ashbyhq"),
      lever: withMatchedCount(lever.source, "lever"),
      greenhouse: withMatchedCount(greenhouse.source, "greenhouse"),
      workday: withMatchedCount(workday.source, "workday"),
    },
  };
}

async function canonicalize(root: string, job: SearchJob): Promise<CanonicalJob> {
  return await runPyJson(root, [
    "scripts/state/job_state.py",
    "canonicalize",
    JSON.stringify(job),
  ]) as CanonicalJob;
}

export async function checkJobFit(root: string, job: SearchJob): Promise<FitResult> {
  let raw = job;
  if (job.source === "workday") {
    raw = await runPyJson(root, [
      "scripts/jobs/fetch_workday_listings.py",
      "--jd-url",
      job.url,
    ]) as SearchJob;
  }
  const canonical = await canonicalize(root, raw);
  const result = await runPyJson(root, [
    "scripts/jobs/evaluate_job_fit.py",
    JSON.stringify(canonical),
  ]) as FitResult;
  if (!["candidate", "needs_review", "skipped_unfit"].includes(result.fit_status)) {
    throw new Error("fit helper returned an unexpected status");
  }
  return result;
}

function roleType(title: string): "internship" | "new_grad" {
  const value = title.toLowerCase();
  const newGradTerms = [
    "new grad", "new graduate", "entry level", "entry-level", "associate",
    "junior", "early career", "university grad", "campus",
  ];
  return newGradTerms.some((term) => value.includes(term)) ? "new_grad" : "internship";
}

function exitCode(err: unknown): number | undefined {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === "number" ? code : Number(code);
  }
  return undefined;
}

async function appendEntry(root: string, file: string, entry: Record<string, unknown>): Promise<"saved" | "duplicate"> {
  try {
    const ap = py(["scripts/state/append_state_entry.py", file, JSON.stringify(entry)]);
    await execFileAsync(ap.cmd, ap.args, {
      cwd: root,
      encoding: "utf8",
    });
    return "saved";
  } catch (err) {
    if (exitCode(err) === 2) return "duplicate";
    throw err;
  }
}

export async function saveJobForReview(root: string, job: SearchJob): Promise<"saved" | "already_saved"> {
  const canonical = await canonicalize(root, job);
  await runPyJson(root, ["scripts/state/job_state.py", "upsert-job", JSON.stringify(canonical)]);
  const targets = await readTargets(root);
  const location = (canonical.location ?? "").toLowerCase();
  const preferred = (targets.preferred_locations ?? []).some((candidate) => {
    const value = candidate.toLowerCase();
    return Boolean(value && location.includes(value));
  });
  const entry = {
    job_id: canonical.job_id,
    company: canonical.company,
    title: canonical.title,
    url: canonical.apply_url || canonical.url,
    date_applied: new Date().toISOString().slice(0, 10),
    status: "needs_review",
    role_type: roleType(canonical.title),
    source: canonical.source,
    resume_used: "balanced",
    ats_score: 0,
    location_tier: preferred ? "preferred" : "fallback",
    cover_letter_used: false,
    reasoning: "Saved manually from TUI job search",
  };
  if (await appendEntry(root, "data/applied_jobs.json", entry) === "duplicate") {
    return "already_saved";
  }
  await appendEntry(root, "data/review_queue.json", entry);
  await runPyJson(root, [
    "scripts/state/job_state.py",
    "record-event",
    JSON.stringify({
      job_key: canonical.job_key,
      status: "needs_review",
      company: canonical.company,
      title: canonical.title,
      url: entry.url,
      reasoning: entry.reasoning,
    }),
  ]);
  return "saved";
}

export function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "stderr" in err) {
    const stderr = String((err as { stderr?: unknown }).stderr ?? "").trim();
    if (stderr) return stderr.split("\n").slice(-2).join(" ");
  }
  return err instanceof Error ? err.message : String(err);
}
