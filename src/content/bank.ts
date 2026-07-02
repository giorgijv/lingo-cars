import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/**
 * Content pipeline (Phase 2): course content lives as validated DATA in
 * content/{target}.json — not in code. One bank per TARGET language carries
 * stems per SOURCE language (de/en), so a single bank serves every pair with
 * that target. The seed and the check script both load through this module,
 * so invalid content can never reach the database.
 */

export const SOURCE_LANGS = ["de", "en"] as const;
export const TARGET_LANGS = ["es", "ka"] as const;
export type SourceLang = (typeof SOURCE_LANGS)[number];
export type TargetLang = (typeof TARGET_LANGS)[number];

const stemsSchema = z.object({ de: z.string().min(1), en: z.string().min(1) });

const optionsArraySchema = z.array(z.string().min(1)).min(2).max(6);
const optionsSchema = z.union([
  optionsArraySchema,
  z.object({ de: optionsArraySchema, en: optionsArraySchema }),
]);

// .strict() on all three exercise schemas matters: without it, an object with
// stray keys from another branch (e.g. a broken `listen` item that also has
// `options`+`correctIndex`) would silently validate as a *different* type
// instead of failing — zod object schemas ignore unrecognized keys by default.
const mcqExerciseSchema = z
  .object({
    stem: stemsSchema,
    options: optionsSchema,
    correctIndex: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((ex, ctx) => {
    const lengths = Array.isArray(ex.options)
      ? [ex.options.length]
      : [ex.options.de.length, ex.options.en.length];
    if (!Array.isArray(ex.options) && ex.options.de.length !== ex.options.en.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "per-source option sets must have equal length" });
    }
    if (lengths.some((n) => ex.correctIndex >= n)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "correctIndex out of range", path: ["correctIndex"] });
    }
  });

/** `fill` — a typed free-text answer (plans/placement-modalities.md §2a). The
 *  accepted answer set is target-language text, identical regardless of which
 *  source language the learner is translating from (unlike mcq options,
 *  which occasionally need per-source sets for meaning-questions). Content
 *  authors mark these with `answers` (mcq items use `options` instead) — no
 *  separate `type` field needed, the two shapes are structurally exclusive. */
const fillExerciseSchema = z
  .object({
    stem: stemsSchema,
    answers: z.array(z.string().min(1)).min(1).max(6),
    tolerance: z.number().int().min(0).max(3).default(1),
  })
  .strict();

/** `listen` — hear target-language audio, pick which option matches
 *  (plans/placement-modalities.md §2b). `transcript` is the exact text
 *  synthesized aloud client-side (no pre-generated audio pipeline in this
 *  build — see the M2 note at the top of the plan) and must equal
 *  `options[correctIndex]` verbatim. Options are always a plain array (no
 *  per-source variant — these are candidate spoken sentences, not
 *  source-language meaning explanations, so nothing to translate). */
const listenExerciseSchema = z
  .object({
    stem: stemsSchema,
    transcript: z.string().min(1),
    options: optionsArraySchema,
    correctIndex: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((ex, ctx) => {
    if (ex.correctIndex >= ex.options.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "correctIndex out of range", path: ["correctIndex"] });
      return;
    }
    if (ex.options[ex.correctIndex] !== ex.transcript) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "transcript must equal options[correctIndex] verbatim (it's what gets spoken)",
        path: ["transcript"],
      });
    }
  });

/** `speak` — read a target-language sentence aloud (plans/placement-
 *  modalities.md §2c). `text` is the prompt (shown openly — it's not a
 *  hidden answer). Grading reuses fill's edit-distance grader against the
 *  recognized speech text, so this schema is deliberately identical in
 *  shape to fill's minus the multi-answer array (a speak item has exactly
 *  one target sentence, not several accepted phrasings). */
const speakExerciseSchema = z
  .object({
    stem: stemsSchema,
    text: z.string().min(1),
    tolerance: z.number().int().min(0).max(5).default(2),
  })
  .strict();

// Mutually exclusive by required key (`answers` / `transcript` / `text` /
// plain mcq), so a union unambiguously routes each item to the right branch.
const exerciseSchema = z.union([fillExerciseSchema, listenExerciseSchema, speakExerciseSchema, mcqExerciseSchema]);

const skillSchema = z.object({
  key: z.string().regex(/^[a-z0-9-]+$/, "kebab-case key"),
  cefr: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]),
  name: stemsSchema,
  lessons: z.array(z.object({ exercises: z.array(exerciseSchema).min(1) })).min(1),
});

export const bankSchema = z
  .object({
    target: z.enum(TARGET_LANGS),
    skills: z.array(skillSchema).min(1),
  })
  .superRefine((bank, ctx) => {
    const keys = bank.skills.map((s) => s.key);
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    if (dupes.length > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate skill keys: ${[...new Set(dupes)].join(", ")}` });
    }
  });

export type ContentBank = z.infer<typeof bankSchema>;
export type ContentSkill = ContentBank["skills"][number];
export type ContentExercise = ContentSkill["lessons"][number]["exercises"][number];
export type ContentFillExercise = z.infer<typeof fillExerciseSchema>;
export type ContentListenExercise = z.infer<typeof listenExerciseSchema>;
export type ContentSpeakExercise = z.infer<typeof speakExerciseSchema>;
export type ContentMcqExercise = z.infer<typeof mcqExerciseSchema>;

/** Type guard: content-bank exercises are mcq unless they carry `answers`. */
export function isFillExercise(ex: ContentExercise): ex is ContentFillExercise {
  return "answers" in ex;
}

/** Type guard: `listen` items carry `transcript` (fill/mcq/speak never do). */
export function isListenExercise(ex: ContentExercise): ex is ContentListenExercise {
  return "transcript" in ex;
}

/** Type guard: `speak` items carry `text` (fill/mcq/listen never do). */
export function isSpeakExercise(ex: ContentExercise): ex is ContentSpeakExercise {
  return "text" in ex;
}

const CONTENT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "content");

/** Load + validate one target bank. Throws (with zod detail) on invalid content. */
export function loadBank(target: TargetLang): ContentBank {
  const raw = JSON.parse(readFileSync(join(CONTENT_DIR, `${target}.json`), "utf8"));
  const bank = bankSchema.parse(raw);
  if (bank.target !== target) throw new Error(`content/${target}.json declares target '${bank.target}'`);
  return bank;
}

/** Resolve an mcq exercise's options for a given source language. */
export function optionsFor(ex: ContentMcqExercise, src: SourceLang): string[] {
  return Array.isArray(ex.options) ? ex.options : ex.options[src];
}

/** Summary stats used by the check script and tests. */
export function bankStats(bank: ContentBank) {
  const perCefr: Record<string, number> = {};
  let exercises = 0;
  let lessons = 0;
  let mcqCount = 0;
  let fillCount = 0;
  let listenCount = 0;
  let speakCount = 0;
  for (const s of bank.skills) {
    for (const l of s.lessons) {
      lessons++;
      exercises += l.exercises.length;
      perCefr[s.cefr] = (perCefr[s.cefr] ?? 0) + l.exercises.length;
      for (const ex of l.exercises) {
        if (isFillExercise(ex)) fillCount++;
        else if (isListenExercise(ex)) listenCount++;
        else if (isSpeakExercise(ex)) speakCount++;
        else mcqCount++;
      }
    }
  }
  return {
    skills: bank.skills.length,
    lessons,
    exercises,
    perCefr,
    perType: { mcq: mcqCount, fill: fillCount, listen: listenCount, speak: speakCount },
  };
}
