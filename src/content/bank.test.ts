import { describe, expect, it } from "vitest";
import { bankSchema, bankStats, loadBank, optionsFor } from "./bank.js";

describe("content pipeline", () => {
  it("both target banks load and validate", () => {
    for (const t of ["es", "ka"] as const) {
      const bank = loadBank(t);
      expect(bank.target).toBe(t);
      expect(bank.skills.length).toBeGreaterThan(0);
    }
  });

  it("every bank spans A1..C2", () => {
    for (const t of ["es", "ka"] as const) {
      const s = bankStats(loadBank(t));
      for (const level of ["A1", "A2", "B1", "B2", "C1", "C2"]) {
        expect(s.perCefr[level] ?? 0, `${t} has no ${level} items`).toBeGreaterThan(0);
      }
    }
  });

  it("Georgian carries the Phase 2 depth skills (script, cases, verbs)", () => {
    const keys = loadBank("ka").skills.map((s) => s.key);
    expect(keys).toEqual(expect.arrayContaining(["alphabet", "cases", "verbs"]));
    const stats = bankStats(loadBank("ka"));
    expect(stats.exercises).toBeGreaterThanOrEqual(78);
  });

  it("optionsFor resolves per-source option sets", () => {
    const ex = { stem: { de: "x", en: "x" }, options: { de: ["ja", "nein"], en: ["yes", "no"] }, correctIndex: 0 };
    expect(optionsFor(ex, "de")).toEqual(["ja", "nein"]);
    expect(optionsFor(ex, "en")).toEqual(["yes", "no"]);
  });

  it("rejects out-of-range correctIndex", () => {
    const bad = {
      target: "es",
      skills: [{ key: "k", cefr: "A1", name: { de: "n", en: "n" }, lessons: [{ exercises: [{ stem: { de: "s", en: "s" }, options: ["a", "b"], correctIndex: 5 }] }] }],
    };
    expect(() => bankSchema.parse(bad)).toThrow();
  });

  it("rejects unequal per-source option sets and duplicate skill keys", () => {
    const unequal = {
      target: "es",
      skills: [{ key: "k", cefr: "A1", name: { de: "n", en: "n" }, lessons: [{ exercises: [{ stem: { de: "s", en: "s" }, options: { de: ["a", "b"], en: ["a"] }, correctIndex: 0 }] }] }],
    };
    expect(() => bankSchema.parse(unequal)).toThrow();

    const mk = () => ({ key: "dup", cefr: "A1", name: { de: "n", en: "n" }, lessons: [{ exercises: [{ stem: { de: "s", en: "s" }, options: ["a", "b"], correctIndex: 0 }] }] });
    expect(() => bankSchema.parse({ target: "es", skills: [mk(), mk()] })).toThrow();
  });
});
