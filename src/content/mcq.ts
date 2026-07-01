import { z } from "zod";

/**
 * Canonical shape of Exercise.payloadJson for the mcq type. Validated here so
 * both the seed (content-authoring integrity) and the API (Step 9, request +
 * stored-content integrity) share one definition — no drift.
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
