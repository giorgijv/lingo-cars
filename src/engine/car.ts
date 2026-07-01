import type { Cefr, CarCatalog, Prisma, PrismaClient } from "@prisma/client";
import { cefrIndex } from "../config.js";

/**
 * Phase 1 — the car projection.
 *
 * HARD RULES (§10):
 *   D5  — Car state is a PURE READ-ONLY projection of proficiency. Nothing here
 *         writes anything; there is no car_state row to drift. The car is
 *         computed on every read from Enrollment.currentCefr (tier) and
 *         ProficiencyState.inTierProgress (p) against the static CarCatalog.
 *   D3  — Tier comes ONLY from currentCefr (which only evaluateTier moves, on
 *         mastery). No points/economy input exists in this module.
 *
 * Stat interpolation (§3.1): within tier t at progress p ∈ [0,1]:
 *   stat = base[t] + p × (base[t+1] − base[t])
 * so numbers climb toward what the next class starts at. The top tier has no
 * successor: stats stay at its base (the ladder is complete).
 *
 * Intra-tier micro-milestones (§3.1): fixed p-breakpoints unlock visual tuning
 * parts so long tiers never feel barren. Purely cosmetic, purely derived.
 */

export interface Milestone {
  p: number; // breakpoint in [0,1]
  kind: "wheels" | "decal" | "spoiler";
  name: string;
  unlocked: boolean;
}

/** Fixed breakpoints per §3.1 (0.25 / 0.5 / 0.75). */
export const MILESTONE_BREAKPOINTS: ReadonlyArray<Omit<Milestone, "unlocked">> = [
  { p: 0.25, kind: "wheels", name: "Sport wheels" },
  { p: 0.5, kind: "decal", name: "Racing stripe" },
  { p: 0.75, kind: "spoiler", name: "Aero kit" },
];

export interface CarProjection {
  tier: number;
  className: string;
  cefr: Cefr;
  p: number; // normalized in-tier progress
  speed: number;
  handling: number;
  nextClassName: string | null;
  milestones: Milestone[];
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * PURE projection: (cefr, inTierProgress, catalog) -> car. No IO, no writes.
 * `catalog` must contain all six tiers (0..5) ordered or unordered.
 */
export function projectCar(cefr: Cefr, inTierProgress: number, catalog: CarCatalog[]): CarProjection {
  const byTier = new Map(catalog.map((c) => [c.tier, c]));
  const tier = cefrIndex(cefr);
  const cur = byTier.get(tier);
  if (!cur) throw new Error(`CarCatalog missing tier ${tier}`);
  const next = byTier.get(tier + 1) ?? null;

  const p = clamp01(inTierProgress);
  const speed = next ? cur.baseSpeed + p * (next.baseSpeed - cur.baseSpeed) : cur.baseSpeed;
  const handling = next ? cur.baseHandling + p * (next.baseHandling - cur.baseHandling) : cur.baseHandling;

  return {
    tier,
    className: cur.className,
    cefr,
    p,
    speed: round2(speed),
    handling: round2(handling),
    nextClassName: next?.className ?? null,
    milestones: MILESTONE_BREAKPOINTS.map((m) => ({ ...m, unlocked: p >= m.p })),
  };
}

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Thin loader: reads the three inputs and calls the pure projection.
 * Deliberately performs NO writes (D5).
 */
export async function getCar(db: Db, userId: string, pairId: string): Promise<CarProjection> {
  const enrollment = await db.enrollment.findUnique({
    where: { userId_pairId: { userId, pairId } },
    select: { currentCefr: true },
  });
  if (!enrollment) throw new Error(`No enrollment for user ${userId} / pair ${pairId}`);

  const proficiency = await db.proficiencyState.findUnique({
    where: { userId_pairId: { userId, pairId } },
    select: { inTierProgress: true },
  });

  const catalog = await db.carCatalog.findMany();
  return projectCar(enrollment.currentCefr, proficiency?.inTierProgress ?? 0, catalog);
}
