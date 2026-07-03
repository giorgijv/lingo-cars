import { describe, expect, it } from "vitest";
import { bankSchema, bankStats, isFillExercise, isListenExercise, isSpeakExercise, loadBank, optionsFor } from "./bank.js";

describe("content pipeline", () => {
  it("every target bank loads and validates", () => {
    for (const t of ["es", "ka", "ru", "de", "en"] as const) {
      const bank = loadBank(t);
      expect(bank.target).toBe(t);
      expect(bank.skills.length).toBeGreaterThan(0);
    }
  });

  it("every bank spans A1..C2", () => {
    for (const t of ["es", "ka", "ru", "de", "en"] as const) {
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

  it("Russian carries the same depth skills (script, cases, verb aspect)", () => {
    const keys = loadBank("ru").skills.map((s) => s.key);
    expect(keys).toEqual(expect.arrayContaining(["alphabet", "cases", "verbs"]));
    const stats = bankStats(loadBank("ru"));
    expect(stats.exercises).toBeGreaterThanOrEqual(78);
  });

  it("German and English (reverse pairs: es/ka/ru → de/en) carry the same depth skills", () => {
    for (const t of ["de", "en"] as const) {
      const keys = loadBank(t).skills.map((s) => s.key);
      expect(keys).toEqual(expect.arrayContaining(["alphabet", "cases", "verbs"]));
      const stats = bankStats(loadBank(t));
      expect(stats.exercises).toBeGreaterThanOrEqual(78);
    }
  });

  it("de/en banks carry stems for all three reverse-pair sources (es, ka, ru)", () => {
    for (const t of ["de", "en"] as const) {
      const bank = loadBank(t);
      for (const skill of bank.skills) {
        for (const lang of ["es", "ka", "ru"] as const) {
          expect(skill.name[lang], `${t}/${skill.key} name missing '${lang}'`).toBeTruthy();
        }
        for (const l of skill.lessons) {
          for (const ex of l.exercises) {
            for (const lang of ["es", "ka", "ru"] as const) {
              expect(ex.stem[lang], `${t}/${skill.key} exercise missing '${lang}' stem`).toBeTruthy();
            }
          }
        }
      }
    }
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
    expect(stats.perType.mcq + stats.perType.fill + stats.perType.listen + stats.perType.speak).toBe(stats.exercises);
    expect(stats.perType.fill).toBeGreaterThan(0);
    expect(stats.perType.listen).toBeGreaterThan(0);
    expect(stats.perType.speak).toBeGreaterThan(0);
  });

  it("accepts a valid listen exercise whose transcript matches options[correctIndex]", () => {
    const ok = {
      target: "es",
      skills: [{ key: "k", cefr: "A1", name: { de: "n", en: "n" }, lessons: [{ exercises: [{ stem: { de: "s", en: "s" }, transcript: "hola", options: ["hola", "adiós"], correctIndex: 0 }] }] }],
    };
    const parsed = bankSchema.parse(ok);
    const ex = parsed.skills[0]!.lessons[0]!.exercises[0]!;
    expect(isListenExercise(ex)).toBe(true);
  });

  it("rejects a listen exercise whose transcript doesn't match options[correctIndex]", () => {
    const bad = {
      target: "es",
      skills: [{ key: "k", cefr: "A1", name: { de: "n", en: "n" }, lessons: [{ exercises: [{ stem: { de: "s", en: "s" }, transcript: "hola", options: ["adiós", "gracias"], correctIndex: 0 }] }] }],
    };
    expect(() => bankSchema.parse(bad)).toThrow();
  });

  it("rejects a listen exercise with an out-of-range correctIndex", () => {
    const bad = {
      target: "es",
      skills: [{ key: "k", cefr: "A1", name: { de: "n", en: "n" }, lessons: [{ exercises: [{ stem: { de: "s", en: "s" }, transcript: "hola", options: ["hola", "adiós"], correctIndex: 5 }] }] }],
    };
    expect(() => bankSchema.parse(bad)).toThrow();
  });

  it("isListenExercise distinguishes listen from mcq/fill in the real banks", () => {
    const es = loadBank("es");
    const skill = es.skills.find((s) => s.key === "greetings")!;
    const kinds = skill.lessons.flatMap((l) => l.exercises.map((ex) => (isListenExercise(ex) ? "listen" : isFillExercise(ex) ? "fill" : "mcq")));
    expect(kinds).toContain("listen");
    expect(kinds).toContain("mcq");
  });

  it("accepts a valid speak exercise, defaulting tolerance to 2", () => {
    const ok = {
      target: "es",
      skills: [{ key: "k", cefr: "A1", name: { de: "n", en: "n" }, lessons: [{ exercises: [{ stem: { de: "s", en: "s" }, text: "Hola, ¿cómo estás?" }] }] }],
    };
    const parsed = bankSchema.parse(ok);
    const ex = parsed.skills[0]!.lessons[0]!.exercises[0]!;
    expect(isSpeakExercise(ex)).toBe(true);
    if (isSpeakExercise(ex)) expect(ex.tolerance).toBe(2);
  });

  it("rejects a speak exercise with an empty text", () => {
    const bad = {
      target: "es",
      skills: [{ key: "k", cefr: "A1", name: { de: "n", en: "n" }, lessons: [{ exercises: [{ stem: { de: "s", en: "s" }, text: "" }] }] }],
    };
    expect(() => bankSchema.parse(bad)).toThrow();
  });

  it("rejects a speak exercise with an out-of-range tolerance", () => {
    const bad = {
      target: "es",
      skills: [{ key: "k", cefr: "A1", name: { de: "n", en: "n" }, lessons: [{ exercises: [{ stem: { de: "s", en: "s" }, text: "hola", tolerance: 9 }] }] }],
    };
    expect(() => bankSchema.parse(bad)).toThrow();
  });

  it("isSpeakExercise distinguishes speak from the other three types in the real banks", () => {
    const es = loadBank("es");
    const skill = es.skills.find((s) => s.key === "greetings")!;
    const kinds = skill.lessons.flatMap((l) =>
      l.exercises.map((ex) => (isSpeakExercise(ex) ? "speak" : isListenExercise(ex) ? "listen" : isFillExercise(ex) ? "fill" : "mcq")),
    );
    expect(kinds).toContain("speak");
    expect(kinds).toContain("mcq");
  });
});
