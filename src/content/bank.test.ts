import { describe, expect, it } from "vitest";
import { bankSchema, bankStats, isFillExercise, loadBank, optionsFor } from "./bank.js";

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

  it("accepts a valid fill exercise, defaulting tolerance to 1", () => {
    const ok = {
      target: "es",
      skills: [{ key: "k", cefr: "A1", name: { de: "n", en: "n" }, lessons: [{ exercises: [{ stem: { de: "s", en: "s" }, answers: ["hola", "buenas"] }] }] }],
    };
    const parsed = bankSchema.parse(ok);
    const ex = parsed.skills[0]!.lessons[0]!.exercises[0]!;
    expect(isFillExercise(ex)).toBe(true);
    if (isFillExercise(ex)) expect(ex.tolerance).toBe(1);
  });

  it("rejects a fill exercise with an empty answers array", () => {
    const bad = {
      target: "es",
      skills: [{ key: "k", cefr: "A1", name: { de: "n", en: "n" }, lessons: [{ exercises: [{ stem: { de: "s", en: "s" }, answers: [] }] }] }],
    };
    expect(() => bankSchema.parse(bad)).toThrow();
  });

  it("rejects an out-of-range fill tolerance", () => {
    const bad = {
      target: "es",
      skills: [{ key: "k", cefr: "A1", name: { de: "n", en: "n" }, lessons: [{ exercises: [{ stem: { de: "s", en: "s" }, answers: ["a"], tolerance: 9 }] }] }],
    };
    expect(() => bankSchema.parse(bad)).toThrow();
  });

  it("isFillExercise distinguishes mcq from fill items in the real banks", () => {
    const ka = loadBank("ka");
    const skill = ka.skills.find((s) => s.key === "greetings")!;
    const kinds = skill.lessons.flatMap((l) => l.exercises.map(isFillExercise));
    expect(kinds).toContain(true); // the fill lesson added in this change
    expect(kinds).toContain(false); // the original mcq lessons
  });

  it("bankStats reports a per-type breakdown that sums to the exercise total", () => {
    const stats = bankStats(loadBank("es"));
    expect(stats.perType.mcq + stats.perType.fill).toBe(stats.exercises);
    expect(stats.perType.fill).toBeGreaterThan(0);
  });
});
