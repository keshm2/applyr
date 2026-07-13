import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { runValidator } from "./helpers.js";

/**
 * Interactive replacement for hand-editing config/targets.json and
 * config/discord_config.json. Writes the same files the validator
 * already checks; Ashby/Lever slugs are left placeholder so the phase 6
 * vetted-list seeder fills them on the first validator run.
 *
 * `setup --check` skips the prompts and only runs the validator.
 */

type Json = Record<string, unknown>;

function readJson(file: string): Json {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Json;
}

function writeJson(file: string, data: Json): void {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export async function runWizard(root: string, checkOnly: boolean): Promise<number> {
  if (checkOnly) return report(runValidatorAndPrint(root));

  const targetsPath = path.join(root, "config", "targets.json");
  const discordPath = path.join(root, "config", "discord_config.json");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (question: string, fallback: string): Promise<string> => {
    const answer = (await rl.question(`${question}${fallback ? ` [${fallback}]` : ""}: `)).trim();
    return answer || fallback;
  };

  try {
    console.log("applyr setup wizard — writes config/targets.json and config/discord_config.json.");
    console.log("Press enter to accept the [default] shown for any prompt.\n");

    // targets.json — start from the live file if present, else the example.
    const targetsBase = fs.existsSync(targetsPath)
      ? targetsPath
      : path.join(root, "config", "targets.example.json");
    const targets = readJson(targetsBase);
    if (fs.existsSync(targetsPath)) {
      const keep = await ask("config/targets.json exists — edit it? (y/N)", "n");
      if (keep.toLowerCase() !== "y") {
        console.log("Keeping existing targets.json.\n");
      } else {
        await promptTargets(targets, ask);
        writeJson(targetsPath, targets);
        console.log(`Wrote ${targetsPath}\n`);
      }
    } else {
      await promptTargets(targets, ask);
      writeJson(targetsPath, targets);
      console.log(`Wrote ${targetsPath}\n`);
    }

    // discord_config.json
    if (fs.existsSync(discordPath)) {
      console.log("config/discord_config.json exists — keeping it.\n");
    } else {
      const discord: Json = { webhooks: {} };
      const webhooks = discord.webhooks as Json;
      console.log(
        "Discord webhooks (per-outcome routing). One webhook URL can be reused for every route.",
      );
      const success = await ask("webhooks.success (required)", "");
      webhooks.success = success;
      webhooks.needs_review = await ask("webhooks.needs_review", success);
      webhooks.failed = await ask("webhooks.failed", success);
      const summary = await ask("webhooks.summary (optional, falls back to success)", "");
      if (summary) webhooks.summary = summary;
      writeJson(discordPath, discord);
      console.log(`Wrote ${discordPath}\n`);
    }
  } finally {
    rl.close();
  }

  return report(runValidatorAndPrint(root));
}

async function promptTargets(
  targets: Json,
  ask: (q: string, d: string) => Promise<string>,
): Promise<void> {
  const safe = (targets.safe_fields ?? {}) as Json;
  console.log("-- Profile (safe_fields: the only values ever typed into application forms) --");
  const fields: Array<[string, string]> = [
    ["first_name", "First name"],
    ["last_name", "Last name"],
    ["email", "Email"],
    ["phone", "Phone"],
    ["linkedin_url", "LinkedIn URL"],
    ["github_url", "GitHub URL"],
    ["graduation_date", "Graduation date (Month Year)"],
    ["gpa", "GPA"],
    ["authorized_to_work", "Authorized to work? (Yes/No)"],
    ["require_sponsorship", "Require sponsorship? (Yes/No)"],
    ["citizenship_status", "Citizenship status"],
    ["currently_enrolled", "Currently enrolled? (Yes/No)"],
  ];
  for (const [key, label] of fields) {
    safe[key] = await ask(label, String(safe[key] ?? ""));
  }
  targets.safe_fields = safe;

  console.log("\n-- Targeting --");
  const locations = await ask(
    "Preferred locations (comma-separated)",
    ((targets.preferred_locations as string[]) ?? []).join(", "),
  );
  targets.preferred_locations = locations
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  targets.fallback_scope = await ask("Fallback scope", String(targets.fallback_scope ?? ""));
  targets.graduation_date = await ask(
    "Graduation date (for the fit gate)",
    String(targets.graduation_date ?? ""),
  );
  console.log(
    "\nAshby/Lever slugs stay as placeholders — the validator auto-seeds them " +
      "from the project's vetted lists on the next run (docs/SETUP.md 3.1).",
  );
}

function runValidatorAndPrint(root: string): boolean {
  const { ok, output } = runValidator(root);
  console.log(output);
  return ok;
}

function report(ok: boolean): number {
  console.log(ok ? "\nSetup looks good — config is valid." : "\nConfig is not valid yet — fix the ERROR lines above and re-run `applyr setup --check`.");
  return ok ? 0 : 1;
}
