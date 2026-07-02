import { PrismaClient, type Cefr, type ExerciseType } from "@prisma/client";
import { CEFR_DIFFICULTY } from "../src/config.js";
import { fillPayloadSchema, mcqPayloadSchema } from "../src/content/mcq.js";
import { isFillExercise, loadBank, optionsFor, type SourceLang, type TargetLang } from "../src/content/bank.js";

/**
 * Seed: languages, all four pairs, the car catalog, the cosmetics catalog,
 * and course content loaded from the content pipeline (content/{target}.json,
 * validated by src/content/bank.ts — invalid content never reaches the DB).
 *
 * Runs as the DB OWNER (DIRECT_URL) because app_role is read-only on content.
 * Deterministic IDs (`skill-{src}-{tgt}-{key}`, …) + upserts keep it
 * idempotent and never delete Exercises (append-only Attempt cascade).
 */
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

const PAIRS: { src: SourceLang; tgt: TargetLang }[] = [
  { src: "de", tgt: "es" },
  { src: "en", tgt: "es" },
  { src: "de", tgt: "ka" },
  { src: "en", tgt: "ka" },
];

/** Car ladder anchors (§3.2 of the spec) — brand-agnostic shipped names (D4). */
const CAR_LADDER: { tier: number; className: string; baseSpeed: number; baseHandling: number; unlockCefr: Cefr }[] = [
  { tier: 0, className: "City Hatch", baseSpeed: 1.0, baseHandling: 1.0, unlockCefr: "A1" },
  { tier: 1, className: "Hot Hatch", baseSpeed: 1.4, baseHandling: 1.3, unlockCefr: "A2" },
  { tier: 2, className: "Sports Sedan", baseSpeed: 2.0, baseHandling: 1.7, unlockCefr: "B1" },
  { tier: 3, className: "Sports Coupe", baseSpeed: 2.8, baseHandling: 2.4, unlockCefr: "B2" },
  { tier: 4, className: "Supercar", baseSpeed: 3.8, baseHandling: 3.2, unlockCefr: "C1" },
  { tier: 5, className: "Hypercar", baseSpeed: 5.0, baseHandling: 4.0, unlockCefr: "C2" },
];

/** Cosmetics (Phase 3) — purely visual; `tier` gates purchase to already-
 *  unlocked models (D3: buying never advances a tier; D5: stats untouched). */
const COSMETICS: { id: string; tier: number; name: string; costPoints: number; kind: "wheels" | "spoiler" | "paint" | "decal" }[] = [
  { id: "paint-crimson", tier: 0, name: "Crimson paint", costPoints: 40, kind: "paint" },
  { id: "paint-ocean", tier: 0, name: "Ocean paint", costPoints: 40, kind: "paint" },
  { id: "decal-stripes", tier: 0, name: "Twin stripes decal", costPoints: 60, kind: "decal" },
  { id: "wheels-sport", tier: 0, name: "Sport wheels", costPoints: 80, kind: "wheels" },
  { id: "paint-sunburst", tier: 1, name: "Sunburst paint", costPoints: 90, kind: "paint" },
  { id: "wheels-gold", tier: 1, name: "Gold wheels", costPoints: 120, kind: "wheels" },
  { id: "decal-flames", tier: 2, name: "Flame decal", costPoints: 150, kind: "decal" },
  { id: "spoiler-carbon", tier: 2, name: "Carbon spoiler", costPoints: 180, kind: "spoiler" },
  { id: "paint-midnight", tier: 3, name: "Midnight paint", costPoints: 220, kind: "paint" },
  { id: "paint-chrome", tier: 4, name: "Chrome paint", costPoints: 300, kind: "paint" },
];

/** Spread exercise difficulty slightly around the skill's CEFR anchor for placement variety. */
function itemDifficulty(cefr: Cefr, idx: number): number {
  const base = CEFR_DIFFICULTY[cefr];
  return Number((base - 0.2 + idx * 0.1).toFixed(2));
}

export async function main() {
  // Languages (ka = Kartuli; `ge` is the country code and is never used)
  for (const [code, name] of [
    ["de", "German"],
    ["en", "English"],
    ["es", "Spanish"],
    ["ka", "Georgian"],
  ] as const) {
    await prisma.language.upsert({ where: { code }, update: { name }, create: { code, name } });
  }

  // Car catalog (Phase 1) — static anchors, read-only at runtime.
  for (const car of CAR_LADDER) {
    await prisma.carCatalog.upsert({ where: { tier: car.tier }, update: car, create: car });
  }

  // Cosmetics catalog (Phase 3) — read-only at runtime.
  for (const c of COSMETICS) {
    await prisma.cosmeticsCatalog.upsert({ where: { id: c.id }, update: c, create: c });
  }

  const banks = {
    es: loadBank("es"),
    ka: loadBank("ka"),
  };

  let pairCount = 0;
  let skillCount = 0;
  let lessonCount = 0;
  let exerciseCount = 0;

  for (const { src, tgt } of PAIRS) {
    const pairId = `pair-${src}-${tgt}`;
    await prisma.languagePair.upsert({
      where: { sourceCode_targetCode: { sourceCode: src, targetCode: tgt } },
      update: {},
      create: { id: pairId, sourceCode: src, targetCode: tgt },
    });
    pairCount++;

    // Re-seeding after content reordering: shift existing orderIdx out of the
    // way so the unique (pairId, cefr, orderIdx) never collides mid-transition.
    await prisma.skill.updateMany({ where: { pairId }, data: { orderIdx: { increment: 1000 } } });

    const bank = banks[tgt];
    for (let s = 0; s < bank.skills.length; s++) {
      const skill = bank.skills[s]!;
      const skillId = `skill-${src}-${tgt}-${skill.key}`;
      await prisma.skill.upsert({
        where: { id: skillId },
        update: { name: skill.name[src], cefr: skill.cefr, orderIdx: s, pairId },
        create: { id: skillId, pairId, cefr: skill.cefr, name: skill.name[src], orderIdx: s },
      });
      skillCount++;

      for (let l = 0; l < skill.lessons.length; l++) {
        const lessonId = `lesson-${src}-${tgt}-${skill.key}-${l}`;
        await prisma.lesson.upsert({
          where: { id: lessonId },
          update: { skillId, orderIdx: l },
          create: { id: lessonId, skillId, orderIdx: l },
        });
        lessonCount++;

        const exercises = skill.lessons[l]!.exercises;
        for (let e = 0; e < exercises.length; e++) {
          const ex = exercises[e]!;
          const type: ExerciseType = isFillExercise(ex) ? "fill" : "mcq";
          const payload = isFillExercise(ex)
            ? fillPayloadSchema.parse({ stem: ex.stem[src], answers: ex.answers, tolerance: ex.tolerance })
            : mcqPayloadSchema.parse({ stem: ex.stem[src], options: optionsFor(ex, src), correctIndex: ex.correctIndex });
          // integrity gate (both branches validated above)
          const exerciseId = `ex-${src}-${tgt}-${skill.key}-${l}-${e}`;
          await prisma.exercise.upsert({
            where: { id: exerciseId },
            update: { lessonId, type, payloadJson: payload, difficulty: itemDifficulty(skill.cefr, e) },
            create: {
              id: exerciseId,
              lessonId,
              type,
              payloadJson: payload,
              difficulty: itemDifficulty(skill.cefr, e),
            },
          });
          exerciseCount++;
        }
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `Seeded: 4 languages, ${pairCount} pairs, 6 car tiers, ${skillCount} skills, ${lessonCount} lessons, ${exerciseCount} exercises`,
  );
}

// Only run when invoked directly (tsx prisma/seed.ts).
if (process.argv[1]?.replace(/\\/g, "/").endsWith("seed.ts")) {
  main()
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
