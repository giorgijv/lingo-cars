import { describe, it, expect } from "vitest";
import { evaluateTier } from "./mastery.js";
import { PROMOTION } from "../config.js";
import type { PerSkillMastery, SkillMastery } from "./proficiency.js";

// Build a per-skill map for `ids`, each with the given retrievability/coverage/reps.
function tier(
  ids: string[],
  { r, cov, reps }: { r: number; cov: number; reps: number },
): { perSkill: PerSkillMastery; tierSkillIds: string[] } {
  const perSkill: PerSkillMastery = {};
  for (const id of ids) {
    const m: SkillMastery = { retrievability: r, coverage: cov, reps, lapses: 0, seen: 1, total: 1 };
    perSkill[id] = m;
  }
  return { perSkill, tierSkillIds: ids };
}

const MASTERED = { r: 1, cov: 1, reps: PROMOTION.minReps };
const STRUGGLING = { r: 0.4, cov: 1, reps: PROMOTION.minReps }; // practiced but low mastery
const UNTOUCHED = { r: 0, cov: 0, reps: 0 };

describe("evaluateTier — promotion", () => {
  it("promotes A1 -> A2 when mastered with coverage", () => {
    const d = evaluateTier({ currentCefr: "A1", ...tier(["a", "b", "c"], MASTERED) });
    expect(d.action).toBe("promote");
    expect(d.nextCefr).toBe("A2");
  });

  it("does NOT promote C1 -> C2 (checkpoint required), holds instead", () => {
    const d = evaluateTier({ currentCefr: "C1", ...tier(["x", "y"], MASTERED) });
    expect(d.action).toBe("hold");
    expect(d.nextCefr).toBe("C1");
    expect(d.reason).toMatch(/checkpoint/i);
  });

  it("holds at C2 (top tier) even when mastered", () => {
    const d = evaluateTier({ currentCefr: "C2", ...tier(["x"], MASTERED) });
    expect(d.action).toBe("hold");
  });

  it("does not promote on high mastery but insufficient coverage", () => {
    // reps below minReps => no evidence => no promotion
    const d = evaluateTier({ currentCefr: "A1", ...tier(["a", "b"], { r: 1, cov: 1, reps: 1 }) });
    expect(d.action).toBe("hold");
    expect(d.reason).toMatch(/coverage/i);
  });
});

describe("evaluateTier — demotion (D6 safety net)", () => {
  it("demotes B1 -> A2 when practiced hard yet mastery stays low", () => {
    const d = evaluateTier({ currentCefr: "B1", ...tier(["a", "b", "c"], STRUGGLING) });
    expect(d.action).toBe("demote");
    expect(d.nextCefr).toBe("A2");
    expect(d.reason).toMatch(/recalibrat/i);
  });

  it("never demotes a learner who simply hasn't practiced", () => {
    const d = evaluateTier({ currentCefr: "B1", ...tier(["a", "b", "c"], UNTOUCHED) });
    expect(d.action).toBe("hold");
  });

  it("never demotes below A1", () => {
    const d = evaluateTier({ currentCefr: "A1", ...tier(["a", "b"], STRUGGLING) });
    expect(d.action).toBe("hold");
  });
});

describe("evaluateTier — hysteresis hold band", () => {
  it("holds in the mid band (between demoteBelow and promoteAt)", () => {
    const d = evaluateTier({ currentCefr: "A2", ...tier(["a", "b"], { r: 0.7, cov: 1, reps: PROMOTION.minReps }) });
    expect(d.action).toBe("hold");
    expect(d.tierMastery).toBeGreaterThan(PROMOTION.demoteBelow);
    expect(d.tierMastery).toBeLessThan(PROMOTION.promoteAt);
  });
});

describe("evaluateTier — degenerate input", () => {
  it("holds with no tier skills", () => {
    const d = evaluateTier({ currentCefr: "A1", perSkill: {}, tierSkillIds: [] });
    expect(d.action).toBe("hold");
    expect(d.tierMastery).toBe(0);
    expect(d.coverage).toBe(0);
  });
});
