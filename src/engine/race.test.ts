import { describe, expect, it } from "vitest";
import { evaluateRaceSubmission, MAX_RIVALS, raceCeilingMs, RaceValidationError } from "./race.js";

// §3.2 anchors
const cityHatch = { speed: 1.0, handling: 1.0 };
const sportsCoupe = { speed: 2.8, handling: 2.4 };
const hypercar = { speed: 5.0, handling: 4.0 };

describe("raceCeilingMs — the D5 ceiling", () => {
  it("higher-tier cars have strictly lower (faster) ceilings", () => {
    const cars = [cityHatch, sportsCoupe, hypercar];
    let prev = Infinity;
    for (const car of cars) {
      const c = raceCeilingMs(car.speed, car.handling);
      expect(c).toBeLessThan(prev);
      prev = c;
    }
  });

  it("is a pure, deterministic function of speed/handling", () => {
    expect(raceCeilingMs(sportsCoupe.speed, sportsCoupe.handling)).toBe(
      raceCeilingMs(sportsCoupe.speed, sportsCoupe.handling),
    );
  });
});

describe("evaluateRaceSubmission — server-authoritative validation", () => {
  it("accepts a submission exactly at the ceiling", () => {
    const ceilingMs = raceCeilingMs(sportsCoupe.speed, sportsCoupe.handling);
    const out = evaluateRaceSubmission(sportsCoupe, { finishMs: ceilingMs, position: 1, rivalCount: 3 });
    expect(out.finishMs).toBe(ceilingMs);
    expect(out.ceilingMs).toBe(ceilingMs);
    expect(out.trackId).toBe("sprint-1");
  });

  it("accepts a submission modestly faster than the ceiling (client-side launch/draft boosts)", () => {
    const ceilingMs = raceCeilingMs(cityHatch.speed, cityHatch.handling);
    const boosted = Math.floor(ceilingMs * 0.9); // within the generous tolerance
    const out = evaluateRaceSubmission(cityHatch, { finishMs: boosted, position: 1, rivalCount: 3 });
    expect(out.finishMs).toBe(boosted);
  });

  it("rejects a finish time that is physically impossible for this car (D5: never trust the client)", () => {
    const ceilingMs = raceCeilingMs(cityHatch.speed, cityHatch.handling);
    const impossible = Math.floor(ceilingMs * 0.3); // a Hatch claiming near-Hypercar pace
    expect(() => evaluateRaceSubmission(cityHatch, { finishMs: impossible, position: 1, rivalCount: 3 })).toThrow(
      RaceValidationError,
    );
  });

  it("a slower car's ceiling can never be undercut by a faster car's real time (sanity cross-check)", () => {
    const hatchCeiling = raceCeilingMs(cityHatch.speed, cityHatch.handling);
    const hyperCeiling = raceCeilingMs(hypercar.speed, hypercar.handling);
    expect(hyperCeiling).toBeLessThan(hatchCeiling);
    // A Hatch submitting the Hypercar's ceiling time is still rejected as impossible for a Hatch.
    expect(() => evaluateRaceSubmission(cityHatch, { finishMs: hyperCeiling, position: 1, rivalCount: 3 })).toThrow(
      RaceValidationError,
    );
  });

  it("rejects non-finite or non-positive finish times", () => {
    expect(() => evaluateRaceSubmission(cityHatch, { finishMs: 0, position: 1, rivalCount: 3 })).toThrow(
      RaceValidationError,
    );
    expect(() => evaluateRaceSubmission(cityHatch, { finishMs: Number.NaN, position: 1, rivalCount: 3 })).toThrow(
      RaceValidationError,
    );
    expect(() => evaluateRaceSubmission(cityHatch, { finishMs: -500, position: 1, rivalCount: 3 })).toThrow(
      RaceValidationError,
    );
  });

  it("rejects an out-of-range rivalCount", () => {
    const ceilingMs = raceCeilingMs(cityHatch.speed, cityHatch.handling);
    expect(() =>
      evaluateRaceSubmission(cityHatch, { finishMs: ceilingMs, position: 1, rivalCount: -1 }),
    ).toThrow(RaceValidationError);
    expect(() =>
      evaluateRaceSubmission(cityHatch, { finishMs: ceilingMs, position: 1, rivalCount: MAX_RIVALS + 1 }),
    ).toThrow(RaceValidationError);
  });

  it("rejects a position outside 1..(rivalCount+1)", () => {
    const ceilingMs = raceCeilingMs(cityHatch.speed, cityHatch.handling);
    expect(() => evaluateRaceSubmission(cityHatch, { finishMs: ceilingMs, position: 0, rivalCount: 3 })).toThrow(
      RaceValidationError,
    );
    expect(() => evaluateRaceSubmission(cityHatch, { finishMs: ceilingMs, position: 5, rivalCount: 3 })).toThrow(
      RaceValidationError,
    );
  });

  it("defaults trackId to sprint-1 but preserves an explicit one", () => {
    const ceilingMs = raceCeilingMs(cityHatch.speed, cityHatch.handling);
    const withDefault = evaluateRaceSubmission(cityHatch, { finishMs: ceilingMs, position: 2, rivalCount: 3 });
    expect(withDefault.trackId).toBe("sprint-1");
    const withCustom = evaluateRaceSubmission(cityHatch, {
      finishMs: ceilingMs,
      position: 2,
      rivalCount: 3,
      trackId: "hillclimb-1",
    });
    expect(withCustom.trackId).toBe("hillclimb-1");
  });
});
