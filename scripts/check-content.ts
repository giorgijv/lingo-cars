import { bankStats, loadBank, TARGET_LANGS } from "../src/content/bank.js";

/**
 * Content pipeline gate: validates every content/{target}.json against the
 * bank schema and prints stats. Non-zero exit on any violation — wired into
 * CI ahead of the tests so broken content can't ship.
 */
let failed = false;

for (const target of TARGET_LANGS) {
  try {
    const bank = loadBank(target);
    const s = bankStats(bank);
    const perCefr = Object.entries(s.perCefr)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join(" ");
    console.log(`✓ content/${target}.json — ${s.skills} skills, ${s.lessons} lessons, ${s.exercises} exercises (${perCefr})`);
  } catch (err) {
    failed = true;
    console.error(`✗ content/${target}.json INVALID`);
    console.error(err instanceof Error ? err.message : err);
  }
}

process.exit(failed ? 1 : 0);
