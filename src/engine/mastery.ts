import type { Cefr, Prisma, PrismaClient } from "@prisma/client";
import { CEFR_ORDER, cefrIndex, PROMOTION } from "../config.js";
import {
  recomputeProficiency,
  tierMasteryFrom,
  type PerSkillMastery,
} from "./proficiency.js";

/**
 * Rolling mastery / re-tiering — the SOLE driver of CEFR tier changes.
 *
 * Guardrails baked in:
 *   - D3: tier moves ONLY on the mastery metric over proficiency_state. There
 *     is no points/economy input here; nothing can buy a higher tier.
 *   - §9.3: A1..B1 auto-promote; C1->C2 is NOT auto-promoted (needs the
 *     checkpoint that doesn't exist until C-level content — Phase 0 holds).
 *   - D6: silent, non-punitive demotion as a placement safety net, gated so a
 *     learner who simply hasn't practiced is never demoted.
 *   - Hysteresis (promoteAt 0.85 vs demoteBelow 0.60) prevents flapping.
 *
 * evaluateTier is PURE (no IO) — it's the unit under test. applyTierDecision
 * performs the single DB side effect (moving Enrollment.currentCefr).
 */

export type TierAction = "promote" | "demote" | "hold";

export interface TierDecision {
  currentCefr: Cefr;
  nextCefr: Cefr; // == currentCefr when action is "hold"
  action: TierAction;
  tierMastery: number; // 0..1 coverage-weighted mastery of the current tier
  coverage: number; // fraction of tier skills with sufficient evidence (reps >= minReps)
  reason: string;
}

export interface EvaluateTierArgs {
  currentCefr: Cefr;
  perSkill: PerSkillMastery;
  tierSkillIds: string[];
  cfg?: typeof PROMOTION;
}

export function evaluateTier({
  currentCefr,
  perSkill,
  tierSkillIds,
  cfg = PROMOTION,
}: EvaluateTierArgs): TierDecision {
  const idx = cefrIndex(currentCefr);
  const tierMastery = tierMasteryFrom(perSkill, tierSkillIds);

  // Coverage = fraction of tier skills backed by enough reviews to trust.
  const withEvidence = tierSkillIds.filter((id) => (perSkill[id]?.reps ?? 0) >= cfg.minReps).length;
  const coverage = tierSkillIds.length > 0 ? withEvidence / tierSkillIds.length : 0;

  const hold = (reason: string): TierDecision => ({
    currentCefr,
    nextCefr: currentCefr,
    action: "hold",
    tierMastery,
    coverage,
    reason,
  });

  const hasEnoughEvidence = coverage >= cfg.minCoverage;

  // ── Promotion ──
  if (tierMastery >= cfg.promoteAt && hasEnoughEvidence) {
    if (currentCefr === "C1") return hold("C-level checkpoint required before C2");
    if (idx >= CEFR_ORDER.length - 1) return hold("Already at the top tier");
    return {
      currentCefr,
      nextCefr: CEFR_ORDER[idx + 1]!,
      action: "promote",
      tierMastery,
      coverage,
      reason: "Mastery threshold reached — tier up",
    };
  }

  // ── Demotion (D6 safety net) ──
  // Only when there IS evidence (enough practiced) yet mastery is still low —
  // never demote a learner who simply hasn't started the tier.
  if (idx > 0 && hasEnoughEvidence && tierMastery < cfg.demoteBelow) {
    return {
      currentCefr,
      nextCefr: CEFR_ORDER[idx - 1]!,
      action: "demote",
      tierMastery,
      coverage,
      reason: "Recalibrating to your level",
    };
  }

  if (!hasEnoughEvidence) return hold("Building coverage of this tier");
  return hold("Building mastery of this tier");
}

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Evaluate and, if warranted, apply a single tier change. Reads the current
 * ProficiencyState (perSkillMasteryJson) + the tier's skills, calls the pure
 * evaluateTier, and on promote/demote moves Enrollment.currentCefr and
 * re-rolls ProficiencyState so tierMastery/inTierProgress reflect the new tier.
 */
export async function applyTierDecision(
  db: Db,
  userId: string,
  pairId: string,
  now: Date = new Date(),
): Promise<TierDecision> {
  const enrollment = await db.enrollment.findUnique({
    where: { userId_pairId: { userId, pairId } },
    select: { currentCefr: true },
  });
  if (!enrollment) throw new Error(`No enrollment for user ${userId} / pair ${pairId}`);

  const proficiency = await db.proficiencyState.findUnique({
    where: { userId_pairId: { userId, pairId } },
    select: { perSkillMasteryJson: true },
  });
  const perSkill = (proficiency?.perSkillMasteryJson ?? {}) as unknown as PerSkillMastery;

  const tierSkills = await db.skill.findMany({
    where: { pairId, cefr: enrollment.currentCefr },
    select: { id: true },
  });

  const decision = evaluateTier({
    currentCefr: enrollment.currentCefr,
    perSkill,
    tierSkillIds: tierSkills.map((s) => s.id),
  });

  if (decision.action !== "hold") {
    await db.enrollment.update({
      where: { userId_pairId: { userId, pairId } },
      data: { currentCefr: decision.nextCefr },
    });
    // Refresh tierMastery/inTierProgress against the NEW tier's skills.
    await recomputeProficiency(db, userId, pairId, now);
  }

  return decision;
}
