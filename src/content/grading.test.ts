import { describe, expect, it } from "vitest";
import { gradeFillAnswer, levenshtein, normalizeAnswer, stripAccents } from "./grading.js";

describe("normalizeAnswer", () => {
  it("trims, lowercases, collapses whitespace, strips terminal punctuation", () => {
    expect(normalizeAnswer("  Hola!  ")).toBe("hola");
    expect(normalizeAnswer("¿Dónde   está?")).toBe("dónde está");
    expect(normalizeAnswer("Gracias.")).toBe("gracias");
  });
});

describe("stripAccents", () => {
  it("removes Spanish diacritics", () => {
    expect(stripAccents("dónde está")).toBe("donde esta");
    expect(stripAccents("mañana")).toBe("manana");
  });
  it("is a no-op on Georgian (Mkhedruli has no diacritics)", () => {
    expect(stripAccents("გამარჯობა")).toBe("გამარჯობა");
  });
  it("folds Russian ё to е (routinely typed as е)", () => {
    expect(stripAccents("ещё")).toBe("еще");
    expect(stripAccents("Ёлка")).toBe("Елка");
  });
});

describe("levenshtein", () => {
  it("is 0 for identical strings", () => {
    expect(levenshtein("hola", "hola")).toBe(0);
  });
  it("counts single-character edits", () => {
    expect(levenshtein("hola", "hala")).toBe(1); // substitution
    expect(levenshtein("hola", "hol")).toBe(1); // deletion
    expect(levenshtein("hola", "holaa")).toBe(1); // insertion
  });
  it("handles empty strings", () => {
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
  });
});

describe("gradeFillAnswer", () => {
  const answers = ["quisiera una habitación", "querría una habitación"];

  it("scores an exact match 1.0", () => {
    const g = gradeFillAnswer("quisiera una habitación", answers, 1);
    expect(g).toMatchObject({ correct: true, score: 1 });
  });

  it("is case- and whitespace-insensitive for an exact match", () => {
    const g = gradeFillAnswer("  QUISIERA   una Habitación  ", answers, 1);
    expect(g).toMatchObject({ correct: true, score: 1 });
  });

  it("scores an accent-only mismatch 0.85 (typo forgiven, downgraded)", () => {
    const g = gradeFillAnswer("quisiera una habitacion", answers, 1);
    expect(g).toMatchObject({ correct: true, score: 0.85 });
  });

  it("scores a small typo within tolerance 0.6", () => {
    const g = gradeFillAnswer("quisiera una habitacón", answers, 2); // one char off from the accent-stripped miss too
    expect(g.correct).toBe(true);
    expect(g.score).toBeLessThanOrEqual(0.85);
  });

  it("rejects an answer beyond tolerance", () => {
    const g = gradeFillAnswer("no tengo ni idea", answers, 1);
    expect(g).toMatchObject({ correct: false, score: 0 });
  });

  it("rejects an empty response outright, regardless of tolerance", () => {
    const g = gradeFillAnswer("   ", answers, 3);
    expect(g).toMatchObject({ correct: false, score: 0, matchedAnswer: null });
  });

  it("picks the best-matching accepted answer among several", () => {
    const g = gradeFillAnswer("querría una habitación", answers, 1);
    expect(g.matchedAnswer).toBe("querría una habitación");
  });

  it("works identically for Georgian (no accent pass needed, exact match still 1.0)", () => {
    const g = gradeFillAnswer("გამარჯობა", ["გამარჯობა"], 1);
    expect(g).toMatchObject({ correct: true, score: 1 });
  });

  it("accepts Russian е typed in place of the accepted ё spelling", () => {
    const g = gradeFillAnswer("еще", ["ещё"], 1);
    expect(g).toMatchObject({ correct: true, score: 0.85 });
  });
});
