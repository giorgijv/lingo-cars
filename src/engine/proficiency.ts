import type { Cefr, Prisma, PrismaClient } from "@prisma/client";
import { FSRS_PARAMS_VERSION, PROMOTION } from "../config.js";
import { gradeFor, nextCardFields, retrievabilityOf, type CardFields } from "./fsrs.js";

/**
 * Proficiency rollup — a pure projection of the immutable Attempt log AND the
 * immutable RaceResult log (Rule 4).
 *
 * Two entry points:
 *   - recomputeProficiency:  incremental fast path. Rolls up the CURRENT
 *     per-card ReviewState (already maintained by applyAttempt) into
 *     ProficiencyState. Called after each attempt AND after each race.
 *   - recomputeFromScratch:  authoritative path. Wipes derived ReviewState and
 *     replays the whole Attempt log through the FSRS scheduler, then rolls up.
 *     Both produce identical results (determinism, Step 5).
 */

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Points a race finish is worth, by 1-based finishing position. Deliberately
 * a small, flat trickle — well under a single correct lesson answer (10) —
 * so racing stays a fun side loop, never a substitute for studying. Racing
 * still can NEVER move CEFR or unlock a higher car class (D3); this only
 * feeds the same points pool that funds cosmetics/tuning within the current
 * class, same as lesson xp does (D5: car speed/handling stay untouched).
 */
export function raceXpFor(position: number): number {
  return Math.max(1, 5 - position);
}

/** Per-skill mastery entry stored in ProficiencyState.perSkillMasteryJson. */
export interface SkillMastery {
  retrievability: number; // mean R(t) over this skill's SEEN cards, 0..1
  reps: number; // total reviews across the skill's cards
  lapses: number; // total lapses
  seen: number; // exercises attempted at least once
  total: number; // exercises in the skill
  coverage: number; // seen / total, 0..1
}

export type PerSkillMastery = Record<string, SkillMastery>;

/** Coverage-weighted tier mastery: mean over the tier's skills of coverage x R.
 *  Unseen skills contribute 0, so this reads as normalized progress THROUGH the
 *  tier (not just "how good are the bits I've touched"). */
export function tierMasteryFrom(perSkill: PerSkillMastery, tierSkillIds: string[]): number {
  if (tierSkillIds.length === 0) return 0;
  let sum = 0;
  for (const id of tierSkillIds) {
    const m = perSkill[id];
    if (m) sum += m.coverage * m.retrievability;
  }
  return sum / tierSkillIds.length;
}

/** Consecutive-day streak ending at the most recent active (UTC) day. */
export function streakFromDates(dates: Date[]): number {
  if (dates.length === 0) return 0;
  const dayKeys = [...new Set(dates.map((d) => Math.floor(d.getTime() / 86_400_000)))].sort((a, b) => b - a);
  let streak = 1;
  for (let i = 1; i < dayKeys.length; i++) {
    if (dayKeys[i]! === dayKeys[i - 1]! - 1) streak++;
    else break;
  }
  return streak;
}

/**
 * Roll up current ReviewState + Attempt aggregates into ProficiencyState.
 * Does NOT modify ReviewState. `now` is injectable for deterministic tests.
 */
export async function recomputeProficiency(
  db: Db,
  userId: string,
  pairId: string,
  now: Date = new Date(),
): Promise<void> {
  const enrollment = await db.enrollment.findUnique({
    where: { userId_pairId: { userId, pairId } },
    select: { currentCefr: true },
  });
  if (!enrollment) throw new Error(`No enrollment for user ${userId} / pair ${pairId}`);

  // Skills (with their exercise ids) for this pair.
  const skills = await db.skill.findMany({
    where: { pairId },
    select: { id: true, cefr: true, lessons: { select: { exercises: { select: { id: true } } } } },
  });

  const skillExercises = new Map<string, string[]>();
  const exerciseToSkill = new Map<string, string>();
  const tierSkillIds: string[] = [];
  for (const s of skills) {
    const exIds = s.lessons.flatMap((l) => l.exercises.map((e) => e.id));
    skillExercises.set(s.id, exIds);
    for (const exId of exIds) exerciseToSkill.set(exId, s.id);
    if (s.cefr === enrollment.currentCefr) tierSkillIds.push(s.id);
  }

  // Current per-card FSRS state for this user's exercises in this pair.
  const reviewStates = await db.reviewState.findMany({
    where: { userId, exercise: { lesson: { skill: { pairId } } } },
    select: { exerciseId: true, stability: true, difficulty: true, due: true, lastReview: true, reps: true, lapses: true, state: true },
  });
  const rsByExercise = new Map(reviewStates.map((r) => [r.exerciseId, r]));

  // Build per-skill mastery.
  const perSkill: PerSkillMastery = {};
  for (const [skillId, exIds] of skillExercises) {
    let rSum = 0;
    let seen = 0;
    let reps = 0;
    let lapses = 0;
    for (const exId of exIds) {
      const rs = rsByExercise.get(exId);
      if (!rs) continue;
      seen++;
      reps += rs.reps;
      lapses += rs.lapses;
      rSum += retrievabilityOf(rs as CardFields, now);
    }
    const total = exIds.length;
    perSkill[skillId] = {
      retrievability: seen > 0 ? rSum / seen : 0,
      reps,
      lapses,
      seen,
      total,
      coverage: total > 0 ? seen / total : 0,
    };
  }

  const tierMastery = tierMasteryFrom(perSkill, tierSkillIds);
  const inTierProgress = Math.min(1, PROMOTION.promoteAt > 0 ? tierMastery / PROMOTION.promoteAt : tierMastery);

  // XP + streak from the immutable attempt log (study/review only).
  const attempts = await db.attempt.findMany({
    where: { userId, sessionType: { not: "placement" }, exercise: { lesson: { skill: { pairId } } } },
    select: { correct: true, createdAt: true },
  });
  let correct = 0;
  for (const a of attempts) if (a.correct) correct++;

  // A small race-xp trickle from the immutable RaceResult log — same pool as
  // lesson xp (funds cosmetics/tuning within the current class only), but at
  // a small fraction of the rate: study is still by far the main loop.
  const raceResults = await db.raceResult.findMany({
    where: { userId, pairId },
    select: { position: true },
  });
  const raceXp = raceResults.reduce((sum, r) => sum + raceXpFor(r.position), 0);

  const xp = correct * 10 + (attempts.length - correct) * 2 + raceXp;
  const streakDays = streakFromDates(attempts.map((a) => a.createdAt));
  const lastActive = attempts.reduce<Date | null>((max, a) => (!max || a.createdAt > max ? a.createdAt : max), null);

  await db.proficiencyState.upsert({
    where: { userId_pairId: { userId, pairId } },
    create: {
      userId,
      pairId,
      perSkillMasteryJson: perSkill as unknown as Prisma.InputJsonValue,
      tierMastery,
      inTierProgress,
      xp,
      streakDays,
      lastActive,
      fsrsParamsVersion: FSRS_PARAMS_VERSION,
    },
    update: {
      perSkillMasteryJson: perSkill as unknown as Prisma.InputJsonValue,
      tierMastery,
      inTierProgress,
      xp,
      streakDays,
      lastActive,
      fsrsParamsVersion: FSRS_PARAMS_VERSION,
    },
  });
}

/**
 * Authoritative rebuild: wipe derived ReviewState for this user/pair and replay
 * the entire Attempt log (createdAt order) through the FSRS scheduler, then roll
 * up ProficiencyState. This is the guarantee that derived state is never truth.
 */
export async function recomputeFromScratch(
  db: Db,
  userId: string,
  pairId: string,
  now: Date = new Date(),
): Promise<void> {
  await db.reviewState.deleteMany({
    where: { userId, exercise: { lesson: { skill: { pairId } } } },
  });

  const attempts = await db.attempt.findMany({
    where: { userId, sessionType: { not: "placement" }, exercise: { lesson: { skill: { pairId } } } },
    orderBy: { createdAt: "asc" },
    select: { exerciseId: true, correct: true, latencyMs: true, createdAt: true },
  });

  const cards = new Map<string, CardFields>();
  for (const a of attempts) {
    const grade = gradeFor(a.correct, a.latencyMs);
    const prev = cards.get(a.exerciseId) ?? null;
    cards.set(a.exerciseId, nextCardFields(prev, grade, a.createdAt));
  }

  if (cards.size > 0) {
    await db.reviewState.createMany({
      data: [...cards.entries()].map(([exerciseId, c]) => ({
        userId,
        exerciseId,
        stability: c.stability,
        difficulty: c.difficulty,
        due: c.due,
        lastReview: c.lastReview,
        reps: c.reps,
        lapses: c.lapses,
        state: c.state,
        fsrsParamsVersion: FSRS_PARAMS_VERSION,
      })),
    });
  }

  await recomputeProficiency(db, userId, pairId, now);
}

/** Convenience: read back the current ProficiencyState (or null). */
export function getProficiency(db: Db, userId: string, pairId: string) {
  return db.proficiencyState.findUnique({ where: { userId_pairId: { userId, pairId } } });
}
