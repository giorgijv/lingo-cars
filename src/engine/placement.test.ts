import { describe, it, expect } from "vitest";
import {
  applyAnswer,
  isComplete,
  result,
  serveNext,
  startPlacement,
  type PlacementItem,
  type PlacementState,
} from "./placement.js";
import { PLACEMENT } from "../config.js";

// A pool spanning all CEFR difficulties (1..6), several items each. 8 per
// level so a weak taker can fill minItems without exhausting the easy bands
// (mirrors the real seed, which has 16+ A-level items per pair).
const pool: PlacementItem[] = [];
for (let d = 1; d <= 6; d++) {
  for (let i = 0; i < 8; i++) pool.push({ id: `d${d}-${i}`, difficulty: d + i * 0.05, type: "mcq" });
}

/** Simulate a full test where the taker's true ability decides correctness. */
function simulate(trueAbility: number): PlacementState {
  let state = startPlacement();
  for (let step = 0; step < PLACEMENT.maxItems; step++) {
    if (isComplete(state)) break;
    const served = serveNext(state, pool);
    if (!served.item) break;
    const correct = served.item.difficulty <= trueAbility; // deterministic taker
    state = applyAnswer(served.state, served.item, correct, 2000);
  }
  return state;
}

describe("placement staircase", () => {
  it("starts at the configured difficulty", () => {
    expect(startPlacement().ability).toBe(PLACEMENT.startDifficulty);
  });

  it("raises ability on correct, lowers on incorrect", () => {
    const s0 = startPlacement();
    const item: PlacementItem = { id: "x", difficulty: s0.ability, type: "mcq" };
    expect(applyAnswer(s0, item, true, 1000).ability).toBeGreaterThan(s0.ability);
    expect(applyAnswer(s0, item, false, 1000).ability).toBeLessThan(s0.ability);
  });

  it("never serves the same item twice", () => {
    const state = simulate(3);
    const ids = state.responses.map((r) => r.exerciseId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("respects the item budget", () => {
    const state = simulate(6); // all correct -> runs long
    expect(state.responses.length).toBeLessThanOrEqual(PLACEMENT.maxItems);
    expect(state.responses.length).toBeGreaterThanOrEqual(PLACEMENT.minItems);
  });
});

describe("placement difficulty ramp", () => {
  it("starts easy and increases in difficulty while answers stay correct", () => {
    const state = simulate(6); // taker who answers everything correctly
    const difficulties = state.responses.map((r) => r.difficulty);
    expect(difficulties[0]!).toBeLessThanOrEqual(1.5); // begins near A1
    expect(difficulties[difficulties.length - 1]!).toBeGreaterThanOrEqual(4.5); // ends near C-level
    // Monotone ramp (small pool-granularity dips allowed).
    for (let i = 1; i < difficulties.length; i++) {
      expect(difficulties[i]!).toBeGreaterThanOrEqual(difficulties[i - 1]! - 0.3);
    }
  });

  it("stays low for a weak taker — difficulty tracks demonstrated ability", () => {
    const state = simulate(1.1);
    const difficulties = state.responses.map((r) => r.difficulty);
    expect(Math.max(...difficulties)).toBeLessThanOrEqual(3);
  });
});

describe("serveNext — soft staging prefers fill items after the mcq stage (M1)", () => {
  const pastStageResponses = Array.from({ length: PLACEMENT.mcqStageItems }, (_, i) => ({
    exerciseId: `seen-${i}`,
    difficulty: 3,
    correct: true,
    latencyMs: 1000,
  }));

  it("before the stage threshold, a near-tie goes to mcq (id order, no fill preference yet)", () => {
    // ids prefixed so plain id ordering favors mcq on a tie, isolating the
    // pre/post-stage difference to the bonus alone in the next test.
    const pool: PlacementItem[] = [
      { id: "0-mcq-3", difficulty: 3, type: "mcq" },
      { id: "9-fill-3", difficulty: 3, type: "fill" },
    ];
    const state: PlacementState = { ability: 3.2, askedExerciseIds: [], responses: [] };
    const { item } = serveNext(state, pool);
    expect(item).toEqual({ id: "0-mcq-3", difficulty: 3, type: "mcq" });
  });

  it("past the stage threshold, the same near-tie now goes to fill (the bonus)", () => {
    const pool: PlacementItem[] = [
      { id: "0-mcq-3", difficulty: 3, type: "mcq" },
      { id: "9-fill-3", difficulty: 3, type: "fill" },
    ];
    const state: PlacementState = { ability: 3.2, askedExerciseIds: [], responses: pastStageResponses };
    const { item } = serveNext(state, pool);
    expect(item).toEqual({ id: "9-fill-3", difficulty: 3, type: "fill" });
  });

  it("the fill bonus does not override a meaningfully closer mcq item", () => {
    const pool: PlacementItem[] = [
      { id: "mcq-close", difficulty: 4, type: "mcq" }, // distance 0
      { id: "fill-far", difficulty: 2, type: "fill" }, // distance 2, bonus still leaves 1.6
    ];
    const state: PlacementState = { ability: 4, askedExerciseIds: [], responses: pastStageResponses };
    const { item } = serveNext(state, pool);
    expect(item).toEqual({ id: "mcq-close", difficulty: 4, type: "mcq" });
  });

  it("the bonus applies to listen items too (any non-mcq type), not just fill", () => {
    const pool: PlacementItem[] = [
      { id: "0-mcq-3", difficulty: 3, type: "mcq" },
      { id: "9-listen-3", difficulty: 3, type: "listen" },
    ];
    const state: PlacementState = { ability: 3.2, askedExerciseIds: [], responses: pastStageResponses };
    const { item } = serveNext(state, pool);
    expect(item).toEqual({ id: "9-listen-3", difficulty: 3, type: "listen" });
  });
});

describe("placement result mapping", () => {
  it("places a strong taker higher than a weak taker", () => {
    const strong = result(simulate(5.5));
    const weak = result(simulate(1.2));
    expect(strong.ability).toBeGreaterThan(weak.ability);
    // CEFR ladder index of strong >= weak
    const order = ["A1", "A2", "B1", "B2", "C1", "C2"];
    expect(order.indexOf(strong.cefr)).toBeGreaterThan(order.indexOf(weak.cefr));
  });

  it("outputs a low initial in-tier progress (a bet, not a verdict)", () => {
    const r = result(simulate(3));
    expect(r.inTierProgress).toBe(PLACEMENT.seedInTierProgress);
    expect(r.inTierProgress).toBeLessThan(0.25);
  });

  it("reports confidence in [0,1] that is higher with more items", () => {
    const r = result(simulate(3));
    expect(r.confidence).toBeGreaterThanOrEqual(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
    expect(r.itemsUsed).toBeGreaterThanOrEqual(PLACEMENT.minItems);
  });
});
