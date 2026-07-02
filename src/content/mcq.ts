import { z } from "zod";
import type { ExerciseType } from "@prisma/client";

/**
 * Canonical shapes of Exercise.payloadJson, one per ExerciseType. Validated
 * here so the seed (content-authoring integrity) and the API (request +
 * stored-content integrity) share one definition — no drift.
 *
 * The DISCRIMINATOR is the Exercise.type DB column, not a field inside the
 * JSON payload — simpler than embedding a literal `type` in payloadJson (no
 * default-value/back-compat gymnastics for the ~270 exercises seeded before
 * `fill` existed).
 */
export const mcqPayloadSchema = z
  .object({
    stem: z.string().min(1), // prompt, in the SOURCE language (de)
    options: z.array(z.string().min(1)).min(2).max(6), // answers, in the TARGET language (es)
    correctIndex: z.number().int().nonnegative(),
  })
  .refine((p) => p.correctIndex < p.options.length, {
    message: "correctIndex out of range",
    path: ["correctIndex"],
  });

export type McqPayload = z.infer<typeof mcqPayloadSchema>;

/** Parse-or-throw helper for reading stored exercise payloads. */
export function parseMcqPayload(raw: unknown): McqPayload {
  return mcqPayloadSchema.parse(raw);
}

/**
 * `fill` — a typed free-text answer. `answers` is the accepted set (all in
 * the TARGET language); `tolerance` is the max edit distance still accepted
 * (see src/content/grading.ts). Never leaked to clients pre-answer.
 */
export const fillPayloadSchema = z.object({
  stem: z.string().min(1),
  answers: z.array(z.string().min(1)).min(1).max(6),
  tolerance: z.number().int().min(0).max(3).default(1),
});

export type FillPayload = z.infer<typeof fillPayloadSchema>;

export type ExercisePayload = McqPayload | FillPayload;

/** Parse payloadJson using the exercise's own `type` column as the discriminator. */
export function parseExercisePayload(type: ExerciseType, raw: unknown): ExercisePayload {
  return type === "fill" ? fillPayloadSchema.parse(raw) : mcqPayloadSchema.parse(raw);
}
