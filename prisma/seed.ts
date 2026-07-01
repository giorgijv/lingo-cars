import { PrismaClient, type Cefr } from "@prisma/client";
import { CEFR_DIFFICULTY } from "../src/config.js";
import { mcqPayloadSchema, type McqPayload } from "../src/content/mcq.js";

/**
 * Phase 0 seed: de/es languages, the de->es pair, and A1/A2 content
 * (skills -> lessons -> mcq exercises with CEFR-calibrated difficulty).
 *
 * Runs as the DB OWNER (DIRECT_URL) because app_role is read-only on content.
 * Uses deterministic IDs + upserts so re-running is idempotent and never needs
 * to delete Exercises (which would cascade into the append-only Attempt log).
 */
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

type SeedExercise = { stem: string; options: string[]; correctIndex: number };
type SeedLesson = { exercises: SeedExercise[] };
type SeedSkill = { key: string; cefr: Cefr; name: string; lessons: SeedLesson[] };

// stem = German (source), options = Spanish (target).
const SKILLS: SeedSkill[] = [
  {
    key: "greetings",
    cefr: "A1",
    name: "Begrüßungen",
    lessons: [
      {
        exercises: [
          { stem: "Wie sagt man 'Hallo' auf Spanisch?", options: ["Hola", "Adiós", "Gracias", "Perdón"], correctIndex: 0 },
          { stem: "Wie sagt man 'Danke' auf Spanisch?", options: ["Por favor", "Gracias", "Hola", "Sí"], correctIndex: 1 },
          { stem: "Wie sagt man 'Tschüss' auf Spanisch?", options: ["Buenos días", "Hola", "Adiós", "Bien"], correctIndex: 2 },
          { stem: "Wie sagt man 'Bitte' auf Spanisch?", options: ["Gracias", "Por favor", "Adiós", "No"], correctIndex: 1 },
        ],
      },
      {
        exercises: [
          { stem: "Wie sagt man 'Guten Morgen' auf Spanisch?", options: ["Buenas noches", "Buenos días", "Hola", "Adiós"], correctIndex: 1 },
          { stem: "Wie sagt man 'Ja' auf Spanisch?", options: ["No", "Sí", "Tal vez", "Nunca"], correctIndex: 1 },
          { stem: "Wie sagt man 'Nein' auf Spanisch?", options: ["Sí", "Vale", "No", "Bien"], correctIndex: 2 },
          { stem: "Wie sagt man 'Entschuldigung' auf Spanisch?", options: ["Perdón", "Gracias", "Hola", "Adiós"], correctIndex: 0 },
        ],
      },
    ],
  },
  {
    key: "numbers",
    cefr: "A1",
    name: "Zahlen",
    lessons: [
      {
        exercises: [
          { stem: "Wie sagt man 'eins' auf Spanisch?", options: ["dos", "uno", "tres", "cero"], correctIndex: 1 },
          { stem: "Wie sagt man 'zwei' auf Spanisch?", options: ["dos", "diez", "ocho", "seis"], correctIndex: 0 },
          { stem: "Wie sagt man 'drei' auf Spanisch?", options: ["cinco", "cuatro", "tres", "nueve"], correctIndex: 2 },
          { stem: "Wie sagt man 'zehn' auf Spanisch?", options: ["diez", "doce", "dos", "once"], correctIndex: 0 },
        ],
      },
      {
        exercises: [
          { stem: "Wie sagt man 'fünf' auf Spanisch?", options: ["seis", "cuatro", "cinco", "siete"], correctIndex: 2 },
          { stem: "Wie sagt man 'acht' auf Spanisch?", options: ["ocho", "acho", "nueve", "seis"], correctIndex: 0 },
          { stem: "Wie sagt man 'null' auf Spanisch?", options: ["uno", "cero", "nada", "diez"], correctIndex: 1 },
          { stem: "Wie sagt man 'sieben' auf Spanisch?", options: ["seis", "ocho", "siete", "nueve"], correctIndex: 2 },
        ],
      },
    ],
  },
  {
    key: "colors",
    cefr: "A1",
    name: "Farben",
    lessons: [
      {
        exercises: [
          { stem: "Wie sagt man 'rot' auf Spanisch?", options: ["azul", "rojo", "verde", "negro"], correctIndex: 1 },
          { stem: "Wie sagt man 'blau' auf Spanisch?", options: ["azul", "amarillo", "blanco", "rojo"], correctIndex: 0 },
          { stem: "Wie sagt man 'grün' auf Spanisch?", options: ["gris", "verde", "rosa", "marrón"], correctIndex: 1 },
          { stem: "Wie sagt man 'schwarz' auf Spanisch?", options: ["blanco", "negro", "azul", "verde"], correctIndex: 1 },
        ],
      },
    ],
  },
  {
    key: "food",
    cefr: "A2",
    name: "Essen",
    lessons: [
      {
        exercises: [
          { stem: "Wie sagt man 'das Brot' auf Spanisch?", options: ["el pan", "la leche", "el agua", "el queso"], correctIndex: 0 },
          { stem: "Wie sagt man 'der Apfel' auf Spanisch?", options: ["la naranja", "la manzana", "el plátano", "la pera"], correctIndex: 1 },
          { stem: "Wie sagt man 'das Wasser' auf Spanisch?", options: ["el vino", "la cerveza", "el agua", "el zumo"], correctIndex: 2 },
          { stem: "Wie sagt man 'der Käse' auf Spanisch?", options: ["el queso", "el jamón", "el huevo", "la sal"], correctIndex: 0 },
        ],
      },
      {
        exercises: [
          { stem: "Was bedeutet 'Ich möchte einen Kaffee' auf Spanisch?", options: ["Quiero un té", "Quiero un café", "Tengo un café", "Bebo agua"], correctIndex: 1 },
          { stem: "Wie sagt man 'das Frühstück' auf Spanisch?", options: ["la cena", "el almuerzo", "el desayuno", "la merienda"], correctIndex: 2 },
          { stem: "Wie sagt man 'lecker' auf Spanisch?", options: ["rico", "caro", "frío", "malo"], correctIndex: 0 },
          { stem: "Wie sagt man 'die Rechnung' (im Restaurant) auf Spanisch?", options: ["la mesa", "la cuenta", "el menú", "la propina"], correctIndex: 1 },
        ],
      },
    ],
  },
  {
    key: "travel",
    cefr: "A2",
    name: "Reisen",
    lessons: [
      {
        exercises: [
          { stem: "Wie sagt man 'der Bahnhof' auf Spanisch?", options: ["el aeropuerto", "la estación", "la parada", "el puerto"], correctIndex: 1 },
          { stem: "Was bedeutet 'Wo ist das Hotel?' auf Spanisch?", options: ["¿Cómo está el hotel?", "¿Dónde está el hotel?", "¿Qué es el hotel?", "¿Cuándo es el hotel?"], correctIndex: 1 },
          { stem: "Wie sagt man 'die Fahrkarte' auf Spanisch?", options: ["el billete", "la maleta", "el asiento", "la llave"], correctIndex: 0 },
          { stem: "Wie sagt man 'links' auf Spanisch?", options: ["derecha", "recto", "izquierda", "cerca"], correctIndex: 2 },
        ],
      },
      {
        exercises: [
          { stem: "Was bedeutet 'Ich hätte gern ein Zimmer' auf Spanisch?", options: ["Busco una casa", "Quisiera una habitación", "Tengo una llave", "Voy a la playa"], correctIndex: 1 },
          { stem: "Wie sagt man 'das Gepäck' auf Spanisch?", options: ["el equipaje", "el viaje", "el mapa", "el vuelo"], correctIndex: 0 },
          { stem: "Wie sagt man 'geradeaus' auf Spanisch?", options: ["a la izquierda", "todo recto", "a la derecha", "detrás"], correctIndex: 1 },
          { stem: "Wie sagt man 'der Flug' auf Spanisch?", options: ["el tren", "el coche", "el vuelo", "el barco"], correctIndex: 2 },
        ],
      },
    ],
  },
];

/** Spread exercise difficulty slightly around the skill's CEFR anchor for placement variety. */
function itemDifficulty(cefr: Cefr, idx: number): number {
  const base = CEFR_DIFFICULTY[cefr];
  return Number((base - 0.2 + idx * 0.1).toFixed(2));
}

/** Car ladder anchors (§3.2 of the spec) — brand-agnostic shipped names (D4). */
const CAR_LADDER: { tier: number; className: string; baseSpeed: number; baseHandling: number; unlockCefr: Cefr }[] = [
  { tier: 0, className: "City Hatch", baseSpeed: 1.0, baseHandling: 1.0, unlockCefr: "A1" },
  { tier: 1, className: "Hot Hatch", baseSpeed: 1.4, baseHandling: 1.3, unlockCefr: "A2" },
  { tier: 2, className: "Sports Sedan", baseSpeed: 2.0, baseHandling: 1.7, unlockCefr: "B1" },
  { tier: 3, className: "Sports Coupe", baseSpeed: 2.8, baseHandling: 2.4, unlockCefr: "B2" },
  { tier: 4, className: "Supercar", baseSpeed: 3.8, baseHandling: 3.2, unlockCefr: "C1" },
  { tier: 5, className: "Hypercar", baseSpeed: 5.0, baseHandling: 4.0, unlockCefr: "C2" },
];

async function main() {
  // Languages
  for (const [code, name] of [
    ["de", "German"],
    ["es", "Spanish"],
  ] as const) {
    await prisma.language.upsert({ where: { code }, update: { name }, create: { code, name } });
  }

  // Car catalog (Phase 1) — static anchors, read-only at runtime.
  for (const car of CAR_LADDER) {
    await prisma.carCatalog.upsert({ where: { tier: car.tier }, update: car, create: car });
  }

  // Pair de -> es (deterministic id)
  const pairId = "pair-de-es";
  await prisma.languagePair.upsert({
    where: { sourceCode_targetCode: { sourceCode: "de", targetCode: "es" } },
    update: {},
    create: { id: pairId, sourceCode: "de", targetCode: "es" },
  });

  let skillCount = 0;
  let lessonCount = 0;
  let exerciseCount = 0;

  for (let s = 0; s < SKILLS.length; s++) {
    const skill = SKILLS[s]!;
    const skillId = `skill-${skill.key}`;
    await prisma.skill.upsert({
      where: { id: skillId },
      update: { name: skill.name, cefr: skill.cefr, orderIdx: s, pairId },
      create: { id: skillId, pairId, cefr: skill.cefr, name: skill.name, orderIdx: s },
    });
    skillCount++;

    for (let l = 0; l < skill.lessons.length; l++) {
      const lessonId = `lesson-${skill.key}-${l}`;
      await prisma.lesson.upsert({
        where: { id: lessonId },
        update: { skillId, orderIdx: l },
        create: { id: lessonId, skillId, orderIdx: l },
      });
      lessonCount++;

      const exercises = skill.lessons[l]!.exercises;
      for (let e = 0; e < exercises.length; e++) {
        const ex = exercises[e]!;
        const payload: McqPayload = mcqPayloadSchema.parse(ex); // integrity gate
        const exerciseId = `ex-${skill.key}-${l}-${e}`;
        await prisma.exercise.upsert({
          where: { id: exerciseId },
          update: { lessonId, payloadJson: payload, difficulty: itemDifficulty(skill.cefr, e) },
          create: {
            id: exerciseId,
            lessonId,
            type: "mcq",
            payloadJson: payload,
            difficulty: itemDifficulty(skill.cefr, e),
          },
        });
        exerciseCount++;
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log(`Seeded: 2 languages, 1 pair, ${skillCount} skills, ${lessonCount} lessons, ${exerciseCount} exercises`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
