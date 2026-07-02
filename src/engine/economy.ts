import type { CosmeticsCatalog, Prisma, PrismaClient, Purchase } from "@prisma/client";
import { cefrIndex } from "../config.js";

/**
 * Phase 3 — economy & agency.
 *
 * Design (guardrails first):
 *   D3 — points can NEVER buy a higher model. A cosmetic's `tier` is the
 *        minimum ALREADY-UNLOCKED tier required to buy it; purchasing writes
 *        nothing that any promotion logic reads. Tier movement stays entirely
 *        inside evaluateTier (mastery only).
 *   D5 — cosmetics are visual only; car speed/handling are untouched.
 *   Rule 4 — Purchase is an immutable ledger (like Attempt). Balance and
 *        ownership are pure projections:
 *          balance = pointsEarned(xp) − Σ buys + Σ sells
 *          owned   = per-cosmetic net(buys − sells) > 0
 *        so the whole economy replays from (attempts → xp) + purchases.
 *
 * Agency (§3.3 v2): the learner chooses to SPEND (buy), SAVE (do nothing), or
 * TRADE IN (sell back at 50%, the "secondary market" MVP).
 */

export const SELL_BACK_RATIO = 0.5;

export interface EconomyItem {
  id: string;
  name: string;
  kind: CosmeticsCatalog["kind"];
  tier: number;
  costPoints: number;
  sellPoints: number;
  owned: boolean;
  unlocked: boolean; // current car tier >= item tier
  affordable: boolean;
}

export interface EconomyState {
  pointsEarned: number;
  pointsSpent: number;
  pointsRefunded: number;
  balance: number;
  owned: string[]; // cosmetic ids with net ownership > 0
  items: EconomyItem[];
}

export function sellPriceOf(costPoints: number): number {
  return Math.floor(costPoints * SELL_BACK_RATIO);
}

type LedgerRow = Pick<Purchase, "cosmeticId" | "action" | "points">;

/** PURE projection of the economy from earned xp + the purchase ledger. */
export function computeEconomy(
  xp: number,
  ledger: LedgerRow[],
  catalog: CosmeticsCatalog[],
  currentTier: number,
): EconomyState {
  let spent = 0;
  let refunded = 0;
  const net = new Map<string, number>();
  for (const row of ledger) {
    if (row.action === "buy") {
      spent += row.points;
      net.set(row.cosmeticId, (net.get(row.cosmeticId) ?? 0) + 1);
    } else {
      refunded += row.points;
      net.set(row.cosmeticId, (net.get(row.cosmeticId) ?? 0) - 1);
    }
  }
  const balance = xp - spent + refunded;
  const owned = [...net.entries()].filter(([, n]) => n > 0).map(([id]) => id);

  const items: EconomyItem[] = catalog
    .slice()
    .sort((a, b) => a.tier - b.tier || a.costPoints - b.costPoints)
    .map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      tier: c.tier,
      costPoints: c.costPoints,
      sellPoints: sellPriceOf(c.costPoints),
      owned: (net.get(c.id) ?? 0) > 0,
      unlocked: currentTier >= c.tier,
      affordable: balance >= c.costPoints,
    }));

  return { pointsEarned: xp, pointsSpent: spent, pointsRefunded: refunded, balance, owned, items };
}

type Db = PrismaClient | Prisma.TransactionClient;

async function loadInputs(db: Db, userId: string, pairId: string) {
  const enrollment = await db.enrollment.findUnique({
    where: { userId_pairId: { userId, pairId } },
    select: { currentCefr: true },
  });
  if (!enrollment) throw new Error(`No enrollment for user ${userId} / pair ${pairId}`);
  const proficiency = await db.proficiencyState.findUnique({
    where: { userId_pairId: { userId, pairId } },
    select: { xp: true },
  });
  const ledger = await db.purchase.findMany({
    where: { userId, pairId },
    select: { cosmeticId: true, action: true, points: true },
  });
  const catalog = await db.cosmeticsCatalog.findMany();
  return { currentTier: cefrIndex(enrollment.currentCefr), xp: proficiency?.xp ?? 0, ledger, catalog };
}

/** Read-only economy projection. */
export async function getEconomy(db: Db, userId: string, pairId: string): Promise<EconomyState> {
  const { currentTier, xp, ledger, catalog } = await loadInputs(db, userId, pairId);
  return computeEconomy(xp, ledger, catalog, currentTier);
}

export class EconomyError extends Error {
  constructor(
    public code: "unknown_cosmetic" | "tier_locked" | "insufficient_points" | "already_owned" | "not_owned",
    message: string,
  ) {
    super(message);
  }
}

/**
 * Buy or sell a cosmetic. Appends ONE ledger row (never mutates), re-checked
 * inside the caller's transaction. Returns the updated projection.
 */
export async function tradeCosmetic(
  db: Db,
  userId: string,
  pairId: string,
  cosmeticId: string,
  action: "buy" | "sell",
): Promise<EconomyState> {
  const { currentTier, xp, ledger, catalog } = await loadInputs(db, userId, pairId);
  const item = catalog.find((c) => c.id === cosmeticId);
  if (!item) throw new EconomyError("unknown_cosmetic", `No cosmetic '${cosmeticId}'`);

  const economy = computeEconomy(xp, ledger, catalog, currentTier);
  const isOwned = economy.owned.includes(cosmeticId);

  if (action === "buy") {
    // D3: availability is gated to ALREADY-unlocked tiers; buying changes no tier.
    if (currentTier < item.tier) {
      throw new EconomyError("tier_locked", `'${item.name}' requires tier ${item.tier}; current tier is ${currentTier}`);
    }
    if (isOwned) throw new EconomyError("already_owned", `'${item.name}' is already owned`);
    if (economy.balance < item.costPoints) {
      throw new EconomyError("insufficient_points", `Need ${item.costPoints} points; balance is ${economy.balance}`);
    }
    await db.purchase.create({
      data: { userId, pairId, cosmeticId, action: "buy", points: item.costPoints },
    });
  } else {
    if (!isOwned) throw new EconomyError("not_owned", `'${item.name}' is not owned`);
    await db.purchase.create({
      data: { userId, pairId, cosmeticId, action: "sell", points: sellPriceOf(item.costPoints) },
    });
  }

  return getEconomy(db, userId, pairId);
}
