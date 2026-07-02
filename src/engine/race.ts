import type { Prisma, PrismaClient, RaceResult } from "@prisma/client";
import { getCar, type CarProjection } from "./car.js";

/**
 * Phase 4 — race minigame (time trial).
 *
 * D5 HARD RULE: proficiency sets the performance CEILING; race skill only
 * operates within it. Concretely:
 *   ceiling  = speed^0.7 × handling^0.3          (from the D5 car projection)
 *   realized = ceiling × (0.5 + 0.5 × skill)     (skill ∈ [0,1] from gameplay)
 *   finishMs = BASE_TRACK_MS / realized
 * With perfect skill you reach exactly the ceiling — never past it. A zero-
 * skill Hypercar still beats a perfect City Hatch: language mastery dominates.
 *
 * Racing is pure engagement: it writes ONLY to the append-only RaceResult log
 * and awards no points, no xp, no CEFR movement (D3/D5 stay airtight).
 */

export const BASE_TRACK_MS = 20_000;
export const MAX_SHIFTS = 10;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export interface RaceOutcome {
  skillScore: number; // 0..1
  finishMs: number;
  ceilingMs: number; // best possible time for THIS car (skill = 1)
}

/** PURE race computation from the car's projected stats + gameplay inputs. */
export function computeRace(
  car: Pick<CarProjection, "speed" | "handling">,
  shiftAccuracies: number[],
): RaceOutcome {
  if (shiftAccuracies.length < 1 || shiftAccuracies.length > MAX_SHIFTS) {
    throw new Error(`shiftAccuracies must have 1..${MAX_SHIFTS} entries`);
  }
  const skillScore =
    shiftAccuracies.reduce((sum, a) => sum + clamp01(Number.isFinite(a) ? a : 0), 0) /
    shiftAccuracies.length;

  const ceiling = Math.pow(car.speed, 0.7) * Math.pow(car.handling, 0.3);
  const realized = ceiling * (0.5 + 0.5 * skillScore);

  return {
    skillScore: Math.round(skillScore * 1000) / 1000,
    finishMs: Math.round(BASE_TRACK_MS / realized),
    ceilingMs: Math.round(BASE_TRACK_MS / ceiling),
  };
}

type Db = PrismaClient | Prisma.TransactionClient;

export interface RaceRun {
  outcome: RaceOutcome;
  car: CarProjection;
  bestMs: number; // personal best incl. this run
  isNewBest: boolean;
  result: RaceResult;
}

/** Run a race server-authoritatively: project the car (D5 ceiling), compute,
 *  append one immutable RaceResult row. No other state is touched. */
export async function runRace(
  db: Db,
  userId: string,
  pairId: string,
  shiftAccuracies: number[],
): Promise<RaceRun> {
  const car = await getCar(db, userId, pairId);
  const outcome = computeRace(car, shiftAccuracies);

  const prevBest = await db.raceResult.findFirst({
    where: { userId, pairId },
    orderBy: { finishMs: "asc" },
    select: { finishMs: true },
  });

  const result = await db.raceResult.create({
    data: {
      userId,
      pairId,
      tier: car.tier,
      speed: car.speed,
      handling: car.handling,
      skillScore: outcome.skillScore,
      finishMs: outcome.finishMs,
    },
  });

  const isNewBest = !prevBest || outcome.finishMs < prevBest.finishMs;
  return {
    outcome,
    car,
    bestMs: isNewBest ? outcome.finishMs : prevBest!.finishMs,
    isNewBest,
    result,
  };
}

/** Read-only race history: personal best + recent runs. */
export async function getRaces(db: Db, userId: string, pairId: string) {
  const [best, recent] = await Promise.all([
    db.raceResult.findFirst({ where: { userId, pairId }, orderBy: { finishMs: "asc" } }),
    db.raceResult.findMany({ where: { userId, pairId }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  return { best, recent };
}
