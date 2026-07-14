import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { py } from "./platform.js";

const execFileAsync = promisify(execFile);
const FETCH_TIMEOUT_MS = 15_000;
const RESULT_CAP = 50;

export type JobSource = "ashbyhq" | "lever" | "workday";

export interface SearchJob {
  source: JobSource;
  company: string;
  title: string;
  url: string;
  apply_url?: string;
  external_job_id?: string;
  location?: string;
  jd_text?: string;
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

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function sourceSummary(total: number, failed: number, count: number): SourceResult {
  if (total === 0) return { state: "skipped", count: 0, detail: "not configured" };
  if (failed > 0) {
    return { state: "warning", count, detail: `${failed}/${total} boards failed` };
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
        }];
      });
    }),
  );
  const jobs = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const failed = results.filter((result) => result.status === "rejected").length;
  return { jobs, source: sourceSummary(slugs.length, failed, jobs.length) };
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
        }];
      });
    }),
  );
  const jobs = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const failed = results.filter((result) => result.status === "rejected").length;
  return { jobs, source: sourceSummary(slugs.length, failed, jobs.length) };
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

async function fetchWorkday(root: string, query: string): Promise<{ jobs: SearchJob[]; source: SourceResult }> {
  try {
    const wd = py(["scripts/jobs/fetch_workday_listings.py", "--search", query, "--limit", String(RESULT_CAP), "--timeout", "15"]);
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

export async function searchJobs(root: string, query: string): Promise<SearchResult> {
  const targets = await readTargets(root);
  const ashbySlugs = configured(targets.ashby_company_slugs);
  const leverSlugs = configured(targets.lever_company_slugs);
  const [ashby, lever, workday] = await Promise.all([
    fetchAshby(ashbySlugs),
    fetchLever(leverSlugs),
    fetchWorkday(root, query),
  ]);
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const seen = new Set<string>();
  const jobs = [...ashby.jobs, ...lever.jobs, ...workday.jobs]
    .filter((job) => {
      const title = job.title.toLowerCase();
      return terms.every((term) => title.includes(term));
    })
    .filter((job) => {
      if (seen.has(job.url)) return false;
      seen.add(job.url);
      return true;
    })
    .slice(0, RESULT_CAP);
  return { jobs, sources: { ashbyhq: ashby.source, lever: lever.source, workday: workday.source } };
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
