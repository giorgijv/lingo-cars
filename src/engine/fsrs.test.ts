import { describe, it, expect } from "vitest";
import { Rating } from "ts-fsrs";
import { gradeFor, gradeForScore, nextCardFields, retrievabilityOf, type CardFields } from "./fsrs.js";

const t0 = new Date("2026-01-01T00:00:00.000Z");

describe("gradeFor", () => {
  it("maps incorrect -> Again regardless of latency", () => {
    expect(gradeFor(false, 100)).toBe(Rating.Again);
    expect(gradeFor(false, 99999)).toBe(Rating.Again);
  });
  it("maps fast correct -> Easy, slow correct -> Good", () => {
    expect(gradeFor(true, 1000)).toBe(Rating.Easy);
    expect(gradeFor(true, 5000)).toBe(Rating.Good);
  });
});

describe("gradeForScore (productive/typed exercises)", () => {
  it("maps the gradeFillAnswer score buckets to the matching FSRS grade", () => {
    expect(gradeForScore(1)).toBe(Rating.Easy);
    expect(gradeForScore(0.85)).toBe(Rating.Easy);
    expect(gradeForScore(0.6)).toBe(Rating.Good);
    expect(gradeForScore(0)).toBe(Rating.Again);
  });
  it("is a strict threshold, not a smooth curve", () => {
    expect(gradeForScore(0.84)).toBe(Rating.Good);
    expect(gradeForScore(0.59)).toBe(Rating.Again);
  });
});

describe("nextCardFields (first review of a new card)", () => {
  it("increments reps and sets a future due date", () => {
    const next = nextCardFields(null, Rating.Good, t0);
    expect(next.reps).toBe(1);
    expect(next.due.getTime()).toBeGreaterThan(t0.getTime());
    expect(next.stability).toBeGreaterThan(0);
    expect(next.lastReview?.getTime()).toBe(t0.getTime());
  });

  it("schedules a correct (Easy) answer further out than an incorrect (Again) one", () => {
    const easy = nextCardFields(null, Rating.Easy, t0);
    const again = nextCardFields(null, Rating.Again, t0);
    expect(easy.due.getTime()).toBeGreaterThan(again.due.getTime());
  });
});

describe("determinism (fuzz disabled -> replayable, Rule 4)", () => {
  it("produces identical scheduling for identical inputs", () => {
    const a = nextCardFields(null, Rating.Good, t0);
    const b = nextCardFields(null, Rating.Good, t0);
    expect(a.due.getTime()).toBe(b.due.getTime());
    expect(a.stability).toBe(b.stability);
    expect(a.difficulty).toBe(b.difficulty);
  });
});

describe("retrievability", () => {
  it("is ~1 immediately after a review and decays over time", () => {
    const reviewed = nextCardFields(null, Rating.Good, t0);
    const rNow = retrievabilityOf(reviewed, reviewed.lastReview ?? t0);
    expect(rNow).toBeGreaterThan(0.99);

    const later = new Date(reviewed.due.getTime() + 30 * 24 * 3600 * 1000);
    const rLater = retrievabilityOf(reviewed, later);
    expect(rLater).toBeLessThan(rNow);
    expect(rLater).toBeGreaterThanOrEqual(0);
  });
});

describe("sequential reviews grow stability", () => {
  it("a second Good review pushes due further and raises stability", () => {
    const first = nextCardFields(null, Rating.Good, t0);
    const second = nextCardFields(first as CardFields, Rating.Good, first.due);
    expect(second.stability).toBeGreaterThan(first.stability);
    expect(second.reps).toBe(2);
  });
});
