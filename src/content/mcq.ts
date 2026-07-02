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

/**
 * `listen` — hear target-language audio, pick which option matches. No
 * pre-generated audio file/CDN in this build (see plans/placement-
 * modalities.md M2 note): `transcript` is the exact text to synthesize via
 * the client's on-device speech synthesis, and MUST equal `options[correctIndex]`
 * (enforced by the content-bank schema). Grading is selectedIndex-based,
 * identical to mcq — no new FSRS grade path needed.
 */
export const listenPayloadSchema = z
  .object({
    stem: z.string().min(1),
    transcript: z.string().min(1),
    options: z.array(z.string().min(1)).min(2).max(6),
    correctIndex: z.number().int().nonnegative(),
  })
  .refine((p) => p.correctIndex < p.options.length, {
    message: "correctIndex out of range",
    path: ["correctIndex"],
  });

export type ListenPayload = z.infer<typeof listenPayloadSchema>;

/**
 * `speak` — read a target-language sentence aloud (plans/placement-
 * modalities.md §2c). No ASR microservice in this build (M3 note): the
 * client runs the browser's on-device/vendor-cloud SpeechRecognition and
 * submits the recognized text as `response`, graded by the SAME
 * gradeFillAnswer used for `fill` — "how close is this text to the target"
 * is the identical problem whether the text was typed or spoken. `text` is
 * shown to the learner openly (it's the prompt to read, not a hidden
 * answer) and can be replayed via the M2 speak() TTS helper as a model
 * pronunciation. `tolerance` defaults looser than fill's (ASR transcripts
 * are noisier than typed text — dropped/added filler words, punctuation).
 */
export const speakPayloadSchema = z.object({
  stem: z.string().min(1),
  text: z.string().min(1),
  tolerance: z.number().int().min(0).max(5).default(2),
});

export type SpeakPayload = z.infer<typeof speakPayloadSchema>;

export type ExercisePayload = McqPayload | FillPayload | ListenPayload | SpeakPayload;

/** Parse payloadJson using the exercise's own `type` column as the discriminator. */
export function parseExercisePayload(type: ExerciseType, raw: unknown): ExercisePayload {
  if (type === "fill") return fillPayloadSchema.parse(raw);
  if (type === "listen") return listenPayloadSchema.parse(raw);
  if (type === "speak") return speakPayloadSchema.parse(raw);
  return mcqPayloadSchema.parse(raw);
}
