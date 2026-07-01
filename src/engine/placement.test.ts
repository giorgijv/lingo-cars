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

// A pool spanning all CEFR difficulties (1..6), several items each.
const pool: PlacementItem[] = [];
for (let d = 1; d <= 6; d++) {
  for (let i = 0; i < 6; i++) pool.push({ id: `d${d}-${i}`, difficulty: d + i * 0.05 });
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
    const item: PlacementItem = { id: "x", difficulty: s0.ability };
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
