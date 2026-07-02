import { PrismaClient } from "@prisma/client";
import { FSRS_PARAMS_VERSION } from "../config.js";
import {
  applyAnswer,
  isComplete,
  result,
  serveNext,
  startPlacement,
  type PlacementItem,
  type PlacementResult,
  type PlacementState,
} from "../engine/placement.js";

/**
 * DB-facing placement orchestration. The pure engine (engine/placement.ts)
 * threads PlacementState; this layer supplies the item pool and, at the end,
 * persists results transactionally:
 *   - placement Attempts appended to the immutable log (sessionType=placement,
 *     excluded from FSRS scheduling & mastery)
 *   - Enrollment.currentCefr + placementResultJson + placementCompletedAt
 *   - a seeded ProficiencyState carrying the low initial inTierProgress
 */

/** The placement item pool for a pair: every exercise with its difficulty + type. */
export async function loadPool(db: PrismaClient, pairId: string): Promise<PlacementItem[]> {
  const exercises = await db.exercise.findMany({
    where: { lesson: { skill: { pairId } } },
    select: { id: true, difficulty: true, type: true },
  });
  return exercises.map((e) => ({ id: e.id, difficulty: e.difficulty, type: e.type }));
}

export interface StartResult {
  state: PlacementState;
  item: PlacementItem | null;
}

export async function startPlacementSession(db: PrismaClient, pairId: string): Promise<StartResult> {
  const pool = await loadPool(db, pairId);
  return serveNext(startPlacement(), pool);
}

export interface AnswerResult {
  state: PlacementState;
  item: PlacementItem | null; // next item, or null when done
  done: boolean;
}

/**
 * Apply one placement answer. `exerciseId` must be the outstanding served item.
 * Returns the next item, or done=true when the test is complete.
 */
export async function answerPlacement(
  db: PrismaClient,
  pairId: string,
  state: PlacementState,
  exerciseId: string,
  correct: boolean,
  latencyMs: number,
  extra?: { score?: number | null; selectedIndex?: number; response?: string },
): Promise<AnswerResult> {
  const pool = await loadPool(db, pairId);
  const item = pool.find((p) => p.id === exerciseId);
  if (!item) throw new Error(`Exercise ${exerciseId} not in placement pool for pair ${pairId}`);

  const next = applyAnswer(state, item, correct, latencyMs, extra);
  if (isComplete(next)) return { state: next, item: null, done: true };

  const served = serveNext(next, pool);
  return { state: served.state, item: served.item, done: served.item === null };
}

/**
 * Finalize: persist placement attempts + enrollment estimate + seeded
 * proficiency, all in one transaction. Idempotent-safe to call once per test.
 */
export async function finalizePlacement(
  db: PrismaClient,
  userId: string,
  pairId: string,
  state: PlacementState,
): Promise<PlacementResult> {
  const res = result(state);
  const now = new Date();

  await db.$transaction(async (tx) => {
    // Append placement attempts to the immutable log (excluded from FSRS).
    if (state.responses.length > 0) {
      await tx.attempt.createMany({
        data: state.responses.map((r) => ({
          userId,
          exerciseId: r.exerciseId,
          correct: r.correct,
          latencyMs: r.latencyMs,
          sessionType: "placement" as const,
          createdAt: now,
          score: r.score ?? null,
          responseJson:
            r.response !== undefined
              ? { response: r.response }
              : r.selectedIndex !== undefined
                ? { selectedIndex: r.selectedIndex }
                : undefined,
        })),
      });
    }

    await tx.enrollment.update({
      where: { userId_pairId: { userId, pairId } },
      data: {
        currentCefr: res.cefr,
        placementResultJson: res as unknown as object,
        placementCompletedAt: now,
      },
    });

    // Seed ProficiencyState with the low initial in-tier progress. Study/review
    // attempts will later recompute this from real mastery.
    await tx.proficiencyState.upsert({
      where: { userId_pairId: { userId, pairId } },
      create: {
        userId,
        pairId,
        perSkillMasteryJson: {},
        tierMastery: 0,
        inTierProgress: res.inTierProgress,
        xp: 0,
        streakDays: 0,
        fsrsParamsVersion: FSRS_PARAMS_VERSION,
      },
      update: {
        inTierProgress: res.inTierProgress,
      },
    });
  });

  return res;
}
