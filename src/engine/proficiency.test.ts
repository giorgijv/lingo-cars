import { describe, it, expect } from "vitest";
import { tierMasteryFrom, streakFromDates, type PerSkillMastery } from "./proficiency.js";

const mk = (retrievability: number, coverage: number): PerSkillMastery[string] => ({
  retrievability,
  coverage,
  reps: 0,
  lapses: 0,
  seen: 0,
  total: 0,
});

describe("tierMasteryFrom", () => {
  it("is 0 with no tier skills", () => {
    expect(tierMasteryFrom({}, [])).toBe(0);
  });

  it("counts unseen tier skills as 0 (progress THROUGH the tier)", () => {
    const perSkill: PerSkillMastery = { a: mk(1, 1) }; // b, c unseen
    expect(tierMasteryFrom(perSkill, ["a", "b", "c"])).toBeCloseTo(1 / 3, 6);
  });

  it("is coverage-weighted retrievability, averaged over all tier skills", () => {
    const perSkill: PerSkillMastery = { a: mk(1, 1), b: mk(0.5, 0.5) };
    // (1*1 + 0.5*0.5) / 2 = 0.625
    expect(tierMasteryFrom(perSkill, ["a", "b"])).toBeCloseTo(0.625, 6);
  });

  it("is 1 only when every tier skill is fully covered and fully retained", () => {
    const perSkill: PerSkillMastery = { a: mk(1, 1), b: mk(1, 1) };
    expect(tierMasteryFrom(perSkill, ["a", "b"])).toBe(1);
  });
});

describe("streakFromDates", () => {
  const d = (iso: string) => new Date(iso);
  it("is 0 for no activity", () => {
    expect(streakFromDates([])).toBe(0);
  });
  it("counts consecutive UTC days ending at the latest", () => {
    expect(streakFromDates([d("2026-03-03T10:00Z"), d("2026-03-02T23:00Z"), d("2026-03-01T00:00Z")])).toBe(3);
  });
  it("collapses multiple attempts on the same day", () => {
    expect(streakFromDates([d("2026-03-02T08:00Z"), d("2026-03-02T20:00Z"), d("2026-03-01T09:00Z")])).toBe(2);
  });
  it("breaks the streak on a gap", () => {
    expect(streakFromDates([d("2026-03-05T10:00Z"), d("2026-03-04T10:00Z"), d("2026-03-01T10:00Z")])).toBe(2);
  });
});
