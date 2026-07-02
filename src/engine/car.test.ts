import { describe, it, expect } from "vitest";
import type { CarCatalog } from "@prisma/client";
import { projectCar } from "./car.js";

// §3.2 ladder anchors (mirrors the seed).
const catalog: CarCatalog[] = [
  { tier: 0, className: "City Hatch", baseSpeed: 1.0, baseHandling: 1.0, unlockCefr: "A1" },
  { tier: 1, className: "Hot Hatch", baseSpeed: 1.4, baseHandling: 1.3, unlockCefr: "A2" },
  { tier: 2, className: "Sports Sedan", baseSpeed: 2.0, baseHandling: 1.7, unlockCefr: "B1" },
  { tier: 3, className: "Sports Coupe", baseSpeed: 2.8, baseHandling: 2.4, unlockCefr: "B2" },
  { tier: 4, className: "Supercar", baseSpeed: 3.8, baseHandling: 3.2, unlockCefr: "C1" },
  { tier: 5, className: "Hypercar", baseSpeed: 5.0, baseHandling: 4.0, unlockCefr: "C2" },
];

describe("projectCar — interpolation (§3.1)", () => {
  it("p=0 gives exactly the tier's base stats", () => {
    const car = projectCar("A1", 0, catalog);
    expect(car).toMatchObject({ tier: 0, className: "City Hatch", speed: 1.0, handling: 1.0 });
  });

  it("p=1 reaches exactly what the next class starts at", () => {
    const car = projectCar("A1", 1, catalog);
    expect(car.speed).toBe(1.4);
    expect(car.handling).toBe(1.3);
    expect(car.className).toBe("City Hatch"); // still the same MODEL — swap happens via CEFR only (D3)
  });

  it("interpolates linearly in between", () => {
    const car = projectCar("B1", 0.5, catalog);
    expect(car.speed).toBeCloseTo(2.4, 10); // 2.0 + 0.5*(2.8-2.0)
    expect(car.handling).toBeCloseTo(2.05, 10); // 1.7 + 0.5*(2.4-1.7)
    expect(car.nextClassName).toBe("Sports Coupe");
  });

  it("speed is monotonic in p within a tier", () => {
    let prev = -Infinity;
    for (const p of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      const s = projectCar("B2", p, catalog).speed;
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it("top tier (C2) has no successor: stats stay at base, no next class", () => {
    const car = projectCar("C2", 0.9, catalog);
    expect(car.speed).toBe(5.0);
    expect(car.handling).toBe(4.0);
    expect(car.nextClassName).toBeNull();
  });

  it("clamps out-of-range p", () => {
    expect(projectCar("A2", -0.5, catalog).speed).toBe(1.4);
    expect(projectCar("A2", 1.7, catalog).speed).toBe(2.0);
  });
});

describe("projectCar — micro-milestones (§3.1)", () => {
  it("unlocks nothing below 0.25", () => {
    const m = projectCar("A1", 0.1, catalog).milestones;
    expect(m.every((x) => !x.unlocked)).toBe(true);
  });

  it("unlocks wheels at 0.25, decal at 0.5, spoiler at 0.75", () => {
    const at = (p: number) =>
      projectCar("A1", p, catalog).milestones.filter((m) => m.unlocked).map((m) => m.kind);
    expect(at(0.25)).toEqual(["wheels"]);
    expect(at(0.5)).toEqual(["wheels", "decal"]);
    expect(at(0.75)).toEqual(["wheels", "decal", "spoiler"]);
  });
});

describe("projectCar — D5/D3 shape", () => {
  it("is a pure function: same inputs, same output, no mutation of catalog", () => {
    const snapshot = JSON.stringify(catalog);
    const a = projectCar("B1", 0.33, catalog);
    const b = projectCar("B1", 0.33, catalog);
    expect(a).toEqual(b);
    expect(JSON.stringify(catalog)).toBe(snapshot);
  });

  it("tier is derived from CEFR alone — no other input can change the model", () => {
    // Same CEFR, wildly different p: same model.
    expect(projectCar("B2", 0.01, catalog).className).toBe("Sports Coupe");
    expect(projectCar("B2", 0.99, catalog).className).toBe("Sports Coupe");
  });
});
