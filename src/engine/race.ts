import type { Prisma, PrismaClient, RaceResult } from "@prisma/client";
import { getCar, type CarProjection } from "./car.js";

/**
 * Phase 4 — race minigame (real-time driven sprint vs. AI rivals).
 *
 * D5 HARD RULE: proficiency sets the performance CEILING; race skill only
 * operates within it. The client (docs/index.html) runs a real-time
 * longitudinal physics sim where the car's top speed and acceleration are
 * derived from its CURRENT projected speed/handling, hard-capped at
 * `vMax = 40 × ceiling` (ceiling = speed^0.9 × handling^0.3) — the exact same
 * formula used here. The SERVER re-derives that same ceiling from the car's
 * CURRENT projection (never trusts the client) and rejects any submitted
 * finish time that is faster than physically possible for this car, so a
 * tampered client can never log a result better than its proficiency allows.
 *
 * Racing is pure engagement: it writes ONLY to the append-only RaceResult log
 * and awards no points, no xp, no CEFR movement (D3/D5 stay airtight). A
 * race's outcome is (finishing position, finish time) among the field of
 * `rivalCount + 1` cars — not a shift-accuracy skill score.
 */

// Mirrors the client-side constants in docs/index.html (TRACK_LEN, HND_MAX) —
// the server independently re-derives the same physics envelope for
// validation, so these must stay in sync with the client's race engine.
export const RACE_TRACK_LEN = 900; // world units from the line to the finish (shortest track = sprint)
export const RACE_HND_MAX = 4.4;
export const MAX_RIVALS = 8;
export const DEFAULT_TRACK_ID = "sprint-1";

// The client's launch boost / slipstream slingshot are ACCELERATION-only
// multipliers (never raise vMax — see docs/index.html raceStep()), so a
// skilled run can beat the naive no-boost ceiling by a modest margin. Rather
// than re-implementing the whole client boost/draft state machine
// server-side (fragile, and would have to be kept in lockstep with every
// future game-feel tweak), the server accepts any time down to this fraction
// of the analytic no-boost ceiling — generous enough to never reject a
// legitimate run, tight enough to catch an obviously-tampered submission.
const RACE_MIN_TIME_FACTOR = 0.8;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * PURE analytic best-possible time for a car with the given (speed,
 * handling): the exact closed-form solution of the client's constant-
 * acceleration-to-vMax-then-constant-speed model, run at full throttle from
 * a standing start with no boosts. Identical formula to raceEnvelope() /
 * ceilingTimeMs() in docs/index.html.
 */
export function raceCeilingMs(speed: number, handling: number): number {
  const ceiling = Math.pow(speed, 0.9) * Math.pow(handling, 0.3); // speed exponent 0.9: class strongly drives top speed
  const vMax = 40 * ceiling; // ← D5 hard cap, identical to the client
  const tReach = 3.0 - 1.6 * clamp01((handling - 1) / (RACE_HND_MAX - 1));
  const accel = vMax / Math.max(1.0, tReach);
  const tAccel = vMax / accel;
  const distAccel = 0.5 * vMax * tAccel;
  const seconds =
    distAccel >= RACE_TRACK_LEN
      ? Math.sqrt((2 * RACE_TRACK_LEN) / accel)
      : tAccel + (RACE_TRACK_LEN - distAccel) / vMax;
  return Math.round(seconds * 1000);
}

export type RaceValidationCode =
  | "invalid_finish_time"
  | "invalid_position"
  | "invalid_rival_count"
  | "faster_than_ceiling";

export class RaceValidationError extends Error {
  constructor(
    public code: RaceValidationCode,
    message: string,
  ) {
    super(message);
  }
}

/** What the client submits after a completed race (a DNF is never submitted —
 *  it has no real finish time, and stays a local-only outcome). */
export interface RaceSubmission {
  finishMs: number;
  position: number; // 1-based finishing position
  rivalCount: number; // AI rivals in the field (field size = rivalCount + 1)
  trackId?: string;
}

export interface RaceOutcome {
  finishMs: number; // the ACCEPTED finish time (server never inflates it)
  ceilingMs: number; // this car's server-computed best-possible time
  position: number;
  rivalCount: number;
  trackId: string;
}

/** PURE validation + outcome from the car's projected stats + a race
 *  submission. Throws RaceValidationError on anything malformed or
 *  physically impossible for this car — never trusts the client's numbers. */
export function evaluateRaceSubmission(
  car: Pick<CarProjection, "speed" | "handling">,
  submission: RaceSubmission,
): RaceOutcome {
  if (!Number.isFinite(submission.finishMs) || submission.finishMs <= 0) {
    throw new RaceValidationError("invalid_finish_time", "finishMs must be a positive finite number");
  }
  if (!Number.isInteger(submission.rivalCount) || submission.rivalCount < 0 || submission.rivalCount > MAX_RIVALS) {
    throw new RaceValidationError("invalid_rival_count", `rivalCount must be an integer in 0..${MAX_RIVALS}`);
  }
  if (!Number.isInteger(submission.position) || submission.position < 1 || submission.position > submission.rivalCount + 1) {
    throw new RaceValidationError("invalid_position", "position must be a 1-based rank within the race field");
  }

  const ceilingMs = raceCeilingMs(car.speed, car.handling);
  const minAcceptedMs = Math.floor(ceilingMs * RACE_MIN_TIME_FACTOR);
  if (submission.finishMs < minAcceptedMs) {
    throw new RaceValidationError(
      "faster_than_ceiling",
      `finishMs ${submission.finishMs} is faster than physically possible (min ${minAcceptedMs}) for this car's D5 ceiling`,
    );
  }

  return {
    finishMs: submission.finishMs,
    ceilingMs,
    position: submission.position,
    rivalCount: submission.rivalCount,
    trackId: submission.trackId ?? DEFAULT_TRACK_ID,
  };
}

type Db = PrismaClient | Prisma.TransactionClient;

export interface RaceRun {
  outcome: RaceOutcome;
  car: CarProjection;
  bestMs: number; // personal best finish time incl. this run
  bestPosition: number; // best (lowest) finishing position incl. this run
  isNewBest: boolean;
  result: RaceResult;
}

/** Run a race server-authoritatively: project the car (D5 ceiling), validate
 *  the submission against it, append one immutable RaceResult row. No other
 *  state is touched. */
export async function runRace(
  db: Db,
  userId: string,
  pairId: string,
  submission: RaceSubmission,
): Promise<RaceRun> {
  const car = await getCar(db, userId, pairId);
  const outcome = evaluateRaceSubmission(car, submission);

  const prevBest = await db.raceResult.findFirst({
    where: { userId, pairId },
    orderBy: [{ finishMs: "asc" }],
    select: { finishMs: true, position: true },
  });
  const prevBestPosition = await db.raceResult.findFirst({
    where: { userId, pairId },
    orderBy: [{ position: "asc" }],
    select: { position: true },
  });

  const result = await db.raceResult.create({
    data: {
      userId,
      pairId,
      tier: car.tier,
      speed: car.speed,
      handling: car.handling,
      finishMs: outcome.finishMs,
      position: outcome.position,
      rivalCount: outcome.rivalCount,
      trackId: outcome.trackId,
    },
  });

  const isNewBest = !prevBest || outcome.finishMs < prevBest.finishMs;
  return {
    outcome,
    car,
    bestMs: isNewBest ? outcome.finishMs : prevBest!.finishMs,
    bestPosition: prevBestPosition ? Math.min(prevBestPosition.position, outcome.position) : outcome.position,
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
