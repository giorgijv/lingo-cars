import { describe, expect, it } from "vitest";
import type { CosmeticsCatalog } from "@prisma/client";
import { computeEconomy, sellPriceOf } from "./economy.js";

const catalog: CosmeticsCatalog[] = [
  { id: "paint-crimson", tier: 0, name: "Crimson paint", costPoints: 40, kind: "paint" },
  { id: "wheels-gold", tier: 1, name: "Gold wheels", costPoints: 120, kind: "wheels" },
  { id: "paint-chrome", tier: 4, name: "Chrome paint", costPoints: 300, kind: "paint" },
];

describe("computeEconomy (pure projection)", () => {
  it("balance = xp with an empty ledger; nothing owned", () => {
    const e = computeEconomy(100, [], catalog, 0);
    expect(e.balance).toBe(100);
    expect(e.owned).toEqual([]);
  });

  it("buys subtract, sells refund, ownership is net of buys and sells", () => {
    const ledger = [
      { cosmeticId: "paint-crimson", action: "buy" as const, points: 40 },
      { cosmeticId: "wheels-gold", action: "buy" as const, points: 120 },
      { cosmeticId: "paint-crimson", action: "sell" as const, points: sellPriceOf(40) },
    ];
    const e = computeEconomy(200, ledger, catalog, 1);
    expect(e.balance).toBe(200 - 40 - 120 + 20);
    expect(e.owned).toEqual(["wheels-gold"]);
    expect(e.items.find((i) => i.id === "paint-crimson")!.owned).toBe(false);
  });

  it("marks tier-locked items as not unlocked (D3: gating, never progression)", () => {
    const e = computeEconomy(1000, [], catalog, 1);
    const chrome = e.items.find((i) => i.id === "paint-chrome")!;
    expect(chrome.unlocked).toBe(false);
    expect(chrome.affordable).toBe(true); // rich but locked — money can't open the tier
  });

  it("sell-back is 50% floored", () => {
    expect(sellPriceOf(40)).toBe(20);
    expect(sellPriceOf(45)).toBe(22);
  });
});
