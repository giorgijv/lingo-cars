import { describe, expect, it } from "vitest";
import { BASE_TRACK_MS, computeRace, MAX_SHIFTS } from "./race.js";

// §3.2 anchors
const cityHatch = { speed: 1.0, handling: 1.0 };
const sportsCoupe = { speed: 2.8, handling: 2.4 };
const hypercar = { speed: 5.0, handling: 4.0 };

describe("computeRace — the D5 ceiling", () => {
  it("perfect skill hits exactly the car's ceiling, never past it", () => {
    const r = computeRace(sportsCoupe, [1, 1, 1, 1, 1]);
    expect(r.finishMs).toBe(r.ceilingMs);
  });

  it("zero skill realizes exactly half the ceiling", () => {
    const r = computeRace(cityHatch, [0, 0, 0]);
    expect(r.finishMs).toBe(Math.round(BASE_TRACK_MS / (1 * 0.5)));
  });

  it("a ZERO-skill Hypercar still beats a PERFECT City Hatch — mastery dominates", () => {
    const lazyHyper = computeRace(hypercar, [0, 0, 0, 0, 0]);
    const perfectHatch = computeRace(cityHatch, [1, 1, 1, 1, 1]);
    expect(lazyHyper.finishMs).toBeLessThan(perfectHatch.finishMs);
  });

  it("within one car, better skill is strictly faster (skill operates inside the ceiling)", () => {
    let prev = Infinity;
    for (const s of [0, 0.25, 0.5, 0.75, 1]) {
      const r = computeRace(sportsCoupe, [s]);
      expect(r.finishMs).toBeLessThan(prev);
      prev = r.finishMs;
    }
  });

  it("higher-tier cars have strictly lower (faster) ceilings", () => {
    const cars = [cityHatch, sportsCoupe, hypercar];
    let prev = Infinity;
    for (const car of cars) {
      const c = computeRace(car, [1]).ceilingMs;
      expect(c).toBeLessThan(prev);
      prev = c;
    }
  });

  it("clamps out-of-range and non-finite accuracies", () => {
    const clean = computeRace(cityHatch, [1, 1]);
    const dirty = computeRace(cityHatch, [7, Number.NaN]);
    expect(dirty.skillScore).toBeLessThanOrEqual(1);
    expect(dirty.finishMs).toBeGreaterThanOrEqual(clean.finishMs);
  });

  it("rejects empty or oversized shift arrays", () => {
    expect(() => computeRace(cityHatch, [])).toThrow();
    expect(() => computeRace(cityHatch, Array(MAX_SHIFTS + 1).fill(1))).toThrow();
  });
});
