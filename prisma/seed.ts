import { PrismaClient, type Cefr } from "@prisma/client";
import { CEFR_DIFFICULTY } from "../src/config.js";
import { mcqPayloadSchema, type McqPayload } from "../src/content/mcq.js";

/**
 * Seed: languages (de, en, es, ka), all four language pairs, the car catalog,
 * and A1/A2 content for BOTH target languages (Spanish + Georgian), served to
 * each pair from one target-language bank with per-source stems:
 *
 *   de→es, en→es  <- ES_SKILLS (stems in de/en, options in Spanish)
 *   de→ka, en→ka  <- KA_SKILLS (stems in de/en, options in Georgian/Mkhedruli)
 *
 * Runs as the DB OWNER (DIRECT_URL) because app_role is read-only on content.
 * Deterministic IDs (`skill-{src}-{tgt}-{key}`, …) + upserts keep it
 * idempotent and never delete Exercises (append-only Attempt cascade).
 */
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

type Stems = { de: string; en: string };
type SeedExercise = { stem: Stems; options: string[]; correctIndex: number };
type SeedLesson = { exercises: SeedExercise[] };
type SeedSkill = { key: string; cefr: Cefr; name: Stems; lessons: SeedLesson[] };

const PAIRS: { src: "de" | "en"; tgt: "es" | "ka" }[] = [
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

/* ─────────────────────────── Spanish target bank ─────────────────────────── */

const ES_SKILLS: SeedSkill[] = [
  {
    key: "greetings",
    cefr: "A1",
    name: { de: "Begrüßungen", en: "Greetings" },
    lessons: [
      {
        exercises: [
          { stem: { de: "Wie sagt man 'Hallo' auf Spanisch?", en: "How do you say 'hello' in Spanish?" }, options: ["Hola", "Adiós", "Gracias", "Perdón"], correctIndex: 0 },
          { stem: { de: "Wie sagt man 'Danke' auf Spanisch?", en: "How do you say 'thank you' in Spanish?" }, options: ["Por favor", "Gracias", "Hola", "Sí"], correctIndex: 1 },
          { stem: { de: "Wie sagt man 'Tschüss' auf Spanisch?", en: "How do you say 'bye' in Spanish?" }, options: ["Buenos días", "Hola", "Adiós", "Bien"], correctIndex: 2 },
          { stem: { de: "Wie sagt man 'Bitte' auf Spanisch?", en: "How do you say 'please' in Spanish?" }, options: ["Gracias", "Por favor", "Adiós", "No"], correctIndex: 1 },
        ],
      },
      {
        exercises: [
          { stem: { de: "Wie sagt man 'Guten Morgen' auf Spanisch?", en: "How do you say 'good morning' in Spanish?" }, options: ["Buenas noches", "Buenos días", "Hola", "Adiós"], correctIndex: 1 },
          { stem: { de: "Wie sagt man 'Ja' auf Spanisch?", en: "How do you say 'yes' in Spanish?" }, options: ["No", "Sí", "Tal vez", "Nunca"], correctIndex: 1 },
          { stem: { de: "Wie sagt man 'Nein' auf Spanisch?", en: "How do you say 'no' in Spanish?" }, options: ["Sí", "Vale", "No", "Bien"], correctIndex: 2 },
          { stem: { de: "Wie sagt man 'Entschuldigung' auf Spanisch?", en: "How do you say 'excuse me' in Spanish?" }, options: ["Perdón", "Gracias", "Hola", "Adiós"], correctIndex: 0 },
        ],
      },
    ],
  },
  {
    key: "numbers",
    cefr: "A1",
    name: { de: "Zahlen", en: "Numbers" },
    lessons: [
      {
        exercises: [
          { stem: { de: "Wie sagt man 'eins' auf Spanisch?", en: "How do you say 'one' in Spanish?" }, options: ["dos", "uno", "tres", "cero"], correctIndex: 1 },
          { stem: { de: "Wie sagt man 'zwei' auf Spanisch?", en: "How do you say 'two' in Spanish?" }, options: ["dos", "diez", "ocho", "seis"], correctIndex: 0 },
          { stem: { de: "Wie sagt man 'drei' auf Spanisch?", en: "How do you say 'three' in Spanish?" }, options: ["cinco", "cuatro", "tres", "nueve"], correctIndex: 2 },
          { stem: { de: "Wie sagt man 'zehn' auf Spanisch?", en: "How do you say 'ten' in Spanish?" }, options: ["diez", "doce", "dos", "once"], correctIndex: 0 },
        ],
      },
      {
        exercises: [
          { stem: { de: "Wie sagt man 'fünf' auf Spanisch?", en: "How do you say 'five' in Spanish?" }, options: ["seis", "cuatro", "cinco", "siete"], correctIndex: 2 },
          { stem: { de: "Wie sagt man 'acht' auf Spanisch?", en: "How do you say 'eight' in Spanish?" }, options: ["ocho", "acho", "nueve", "seis"], correctIndex: 0 },
          { stem: { de: "Wie sagt man 'null' auf Spanisch?", en: "How do you say 'zero' in Spanish?" }, options: ["uno", "cero", "nada", "diez"], correctIndex: 1 },
          { stem: { de: "Wie sagt man 'sieben' auf Spanisch?", en: "How do you say 'seven' in Spanish?" }, options: ["seis", "ocho", "siete", "nueve"], correctIndex: 2 },
        ],
      },
    ],
  },
  {
    key: "colors",
    cefr: "A1",
    name: { de: "Farben", en: "Colors" },
    lessons: [
      {
        exercises: [
          { stem: { de: "Wie sagt man 'rot' auf Spanisch?", en: "How do you say 'red' in Spanish?" }, options: ["azul", "rojo", "verde", "negro"], correctIndex: 1 },
          { stem: { de: "Wie sagt man 'blau' auf Spanisch?", en: "How do you say 'blue' in Spanish?" }, options: ["azul", "amarillo", "blanco", "rojo"], correctIndex: 0 },
          { stem: { de: "Wie sagt man 'grün' auf Spanisch?", en: "How do you say 'green' in Spanish?" }, options: ["gris", "verde", "rosa", "marrón"], correctIndex: 1 },
          { stem: { de: "Wie sagt man 'schwarz' auf Spanisch?", en: "How do you say 'black' in Spanish?" }, options: ["blanco", "negro", "azul", "verde"], correctIndex: 1 },
        ],
      },
    ],
  },
  {
    key: "food",
    cefr: "A2",
    name: { de: "Essen", en: "Food" },
    lessons: [
      {
        exercises: [
          { stem: { de: "Wie sagt man 'das Brot' auf Spanisch?", en: "How do you say 'bread' in Spanish?" }, options: ["el pan", "la leche", "el agua", "el queso"], correctIndex: 0 },
          { stem: { de: "Wie sagt man 'der Apfel' auf Spanisch?", en: "How do you say 'apple' in Spanish?" }, options: ["la naranja", "la manzana", "el plátano", "la pera"], correctIndex: 1 },
          { stem: { de: "Wie sagt man 'das Wasser' auf Spanisch?", en: "How do you say 'water' in Spanish?" }, options: ["el vino", "la cerveza", "el agua", "el zumo"], correctIndex: 2 },
          { stem: { de: "Wie sagt man 'der Käse' auf Spanisch?", en: "How do you say 'cheese' in Spanish?" }, options: ["el queso", "el jamón", "el huevo", "la sal"], correctIndex: 0 },
        ],
      },
      {
        exercises: [
          { stem: { de: "Was bedeutet 'Ich möchte einen Kaffee' auf Spanisch?", en: "How do you say 'I would like a coffee' in Spanish?" }, options: ["Quiero un té", "Quiero un café", "Tengo un café", "Bebo agua"], correctIndex: 1 },
          { stem: { de: "Wie sagt man 'das Frühstück' auf Spanisch?", en: "How do you say 'breakfast' in Spanish?" }, options: ["la cena", "el almuerzo", "el desayuno", "la merienda"], correctIndex: 2 },
          { stem: { de: "Wie sagt man 'lecker' auf Spanisch?", en: "How do you say 'tasty' in Spanish?" }, options: ["rico", "caro", "frío", "malo"], correctIndex: 0 },
          { stem: { de: "Wie sagt man 'die Rechnung' (im Restaurant) auf Spanisch?", en: "How do you say 'the bill' (restaurant) in Spanish?" }, options: ["la mesa", "la cuenta", "el menú", "la propina"], correctIndex: 1 },
        ],
      },
    ],
  },
  {
    key: "travel",
    cefr: "A2",
    name: { de: "Reisen", en: "Travel" },
    lessons: [
      {
        exercises: [
          { stem: { de: "Wie sagt man 'der Bahnhof' auf Spanisch?", en: "How do you say 'train station' in Spanish?" }, options: ["el aeropuerto", "la estación", "la parada", "el puerto"], correctIndex: 1 },
          { stem: { de: "Was bedeutet 'Wo ist das Hotel?' auf Spanisch?", en: "How do you say 'Where is the hotel?' in Spanish?" }, options: ["¿Cómo está el hotel?", "¿Dónde está el hotel?", "¿Qué es el hotel?", "¿Cuándo es el hotel?"], correctIndex: 1 },
          { stem: { de: "Wie sagt man 'die Fahrkarte' auf Spanisch?", en: "How do you say 'ticket' in Spanish?" }, options: ["el billete", "la maleta", "el asiento", "la llave"], correctIndex: 0 },
          { stem: { de: "Wie sagt man 'links' auf Spanisch?", en: "How do you say 'left' in Spanish?" }, options: ["derecha", "recto", "izquierda", "cerca"], correctIndex: 2 },
        ],
      },
      {
        exercises: [
          { stem: { de: "Was bedeutet 'Ich hätte gern ein Zimmer' auf Spanisch?", en: "How do you say 'I would like a room' in Spanish?" }, options: ["Busco una casa", "Quisiera una habitación", "Tengo una llave", "Voy a la playa"], correctIndex: 1 },
          { stem: { de: "Wie sagt man 'das Gepäck' auf Spanisch?", en: "How do you say 'luggage' in Spanish?" }, options: ["el equipaje", "el viaje", "el mapa", "el vuelo"], correctIndex: 0 },
          { stem: { de: "Wie sagt man 'geradeaus' auf Spanisch?", en: "How do you say 'straight ahead' in Spanish?" }, options: ["a la izquierda", "todo recto", "a la derecha", "detrás"], correctIndex: 1 },
          { stem: { de: "Wie sagt man 'der Flug' auf Spanisch?", en: "How do you say 'flight' in Spanish?" }, options: ["el tren", "el coche", "el vuelo", "el barco"], correctIndex: 2 },
        ],
      },
    ],
  },
];

/* ─────────────────────────── Georgian target bank ───────────────────────────
   Mkhedruli script; ISO 639-1 code `ka` (never `ge`, which is the country). */

const KA_SKILLS: SeedSkill[] = [
  {
    key: "greetings",
    cefr: "A1",
    name: { de: "Begrüßungen", en: "Greetings" },
    lessons: [
      {
        exercises: [
          { stem: { de: "Wie sagt man 'Hallo' auf Georgisch?", en: "How do you say 'hello' in Georgian?" }, options: ["გამარჯობა", "ნახვამდის", "მადლობა", "კი"], correctIndex: 0 },
          { stem: { de: "Wie sagt man 'Danke' auf Georgisch?", en: "How do you say 'thank you' in Georgian?" }, options: ["გთხოვთ", "მადლობა", "არა", "კარგი"], correctIndex: 1 },
          { stem: { de: "Wie sagt man 'Tschüss' auf Georgisch?", en: "How do you say 'bye' in Georgian?" }, options: ["დილა მშვიდობისა", "გამარჯობა", "ნახვამდის", "კარგად"], correctIndex: 2 },
          { stem: { de: "Wie sagt man 'Bitte' auf Georgisch?", en: "How do you say 'please' in Georgian?" }, options: ["მადლობა", "გთხოვთ", "ნახვამდის", "არა"], correctIndex: 1 },
        ],
      },
      {
        exercises: [
          { stem: { de: "Wie sagt man 'Guten Morgen' auf Georgisch?", en: "How do you say 'good morning' in Georgian?" }, options: ["საღამო მშვიდობისა", "დილა მშვიდობისა", "ღამე მშვიდობისა", "გამარჯობა"], correctIndex: 1 },
          { stem: { de: "Wie sagt man 'ja' auf Georgisch?", en: "How do you say 'yes' in Georgian?" }, options: ["არა", "კი", "იქნებ", "არასდროს"], correctIndex: 1 },
          { stem: { de: "Wie sagt man 'nein' auf Georgisch?", en: "How do you say 'no' in Georgian?" }, options: ["კი", "კარგი", "არა", "ეხლა"], correctIndex: 2 },
          { stem: { de: "Wie sagt man 'Entschuldigung' auf Georgisch?", en: "How do you say 'excuse me' in Georgian?" }, options: ["უკაცრავად", "მადლობა", "გამარჯობა", "ნახვამდის"], correctIndex: 0 },
        ],
      },
    ],
  },
  {
    key: "numbers",
    cefr: "A1",
    name: { de: "Zahlen", en: "Numbers" },
    lessons: [
      {
        exercises: [
          { stem: { de: "Wie sagt man 'eins' auf Georgisch?", en: "How do you say 'one' in Georgian?" }, options: ["ორი", "ერთი", "სამი", "ნული"], correctIndex: 1 },
          { stem: { de: "Wie sagt man 'zwei' auf Georgisch?", en: "How do you say 'two' in Georgian?" }, options: ["ორი", "ათი", "რვა", "ექვსი"], correctIndex: 0 },
          { stem: { de: "Wie sagt man 'drei' auf Georgisch?", en: "How do you say 'three' in Georgian?" }, options: ["ხუთი", "ოთხი", "სამი", "ცხრა"], correctIndex: 2 },
          { stem: { de: "Wie sagt man 'zehn' auf Georgisch?", en: "How do you say 'ten' in Georgian?" }, options: ["ათი", "თორმეტი", "ორი", "თერთმეტი"], correctIndex: 0 },
        ],
      },
      {
        exercises: [
          { stem: { de: "Wie sagt man 'fünf' auf Georgisch?", en: "How do you say 'five' in Georgian?" }, options: ["ექვსი", "ოთხი", "ხუთი", "შვიდი"], correctIndex: 2 },
          { stem: { de: "Wie sagt man 'acht' auf Georgisch?", en: "How do you say 'eight' in Georgian?" }, options: ["რვა", "ცხრა", "ექვსი", "ოთხი"], correctIndex: 0 },
          { stem: { de: "Wie sagt man 'null' auf Georgisch?", en: "How do you say 'zero' in Georgian?" }, options: ["ერთი", "ნული", "ათი", "ორი"], correctIndex: 1 },
          { stem: { de: "Wie sagt man 'sieben' auf Georgisch?", en: "How do you say 'seven' in Georgian?" }, options: ["ექვსი", "რვა", "შვიდი", "ცხრა"], correctIndex: 2 },
        ],
      },
    ],
  },
  {
    key: "colors",
    cefr: "A1",
    name: { de: "Farben", en: "Colors" },
    lessons: [
      {
        exercises: [
          { stem: { de: "Wie sagt man 'rot' auf Georgisch?", en: "How do you say 'red' in Georgian?" }, options: ["ლურჯი", "წითელი", "მწვანე", "შავი"], correctIndex: 1 },
          { stem: { de: "Wie sagt man 'blau' auf Georgisch?", en: "How do you say 'blue' in Georgian?" }, options: ["ლურჯი", "ყვითელი", "თეთრი", "წითელი"], correctIndex: 0 },
          { stem: { de: "Wie sagt man 'grün' auf Georgisch?", en: "How do you say 'green' in Georgian?" }, options: ["ნაცრისფერი", "მწვანე", "ვარდისფერი", "ყავისფერი"], correctIndex: 1 },
          { stem: { de: "Wie sagt man 'schwarz' auf Georgisch?", en: "How do you say 'black' in Georgian?" }, options: ["თეთრი", "შავი", "ლურჯი", "მწვანე"], correctIndex: 1 },
        ],
      },
    ],
  },
  {
    key: "food",
    cefr: "A2",
    name: { de: "Essen", en: "Food" },
    lessons: [
      {
        exercises: [
          { stem: { de: "Wie sagt man 'das Brot' auf Georgisch?", en: "How do you say 'bread' in Georgian?" }, options: ["პური", "რძე", "წყალი", "ყველი"], correctIndex: 0 },
          { stem: { de: "Wie sagt man 'der Apfel' auf Georgisch?", en: "How do you say 'apple' in Georgian?" }, options: ["ფორთოხალი", "ვაშლი", "ბანანი", "მსხალი"], correctIndex: 1 },
          { stem: { de: "Wie sagt man 'das Wasser' auf Georgisch?", en: "How do you say 'water' in Georgian?" }, options: ["ღვინო", "ლუდი", "წყალი", "წვენი"], correctIndex: 2 },
          { stem: { de: "Wie sagt man 'der Käse' auf Georgisch?", en: "How do you say 'cheese' in Georgian?" }, options: ["ყველი", "ლორი", "კვერცხი", "მარილი"], correctIndex: 0 },
        ],
      },
      {
        exercises: [
          { stem: { de: "Was bedeutet 'Ich möchte einen Kaffee' auf Georgisch?", en: "How do you say 'I would like a coffee' in Georgian?" }, options: ["ჩაი მინდა", "ყავა მინდა", "ყავა მაქვს", "წყალს ვსვამ"], correctIndex: 1 },
          { stem: { de: "Wie sagt man 'das Frühstück' auf Georgisch?", en: "How do you say 'breakfast' in Georgian?" }, options: ["ვახშამი", "სადილი", "საუზმე", "წახემსება"], correctIndex: 2 },
          { stem: { de: "Wie sagt man 'lecker' auf Georgisch?", en: "How do you say 'tasty' in Georgian?" }, options: ["გემრიელი", "ძვირი", "ცივი", "ცუდი"], correctIndex: 0 },
          { stem: { de: "Wie sagt man 'die Rechnung' (im Restaurant) auf Georgisch?", en: "How do you say 'the bill' (restaurant) in Georgian?" }, options: ["მაგიდა", "ანგარიში", "მენიუ", "თანხა"], correctIndex: 1 },
        ],
      },
    ],
  },
  {
    key: "travel",
    cefr: "A2",
    name: { de: "Reisen", en: "Travel" },
    lessons: [
      {
        exercises: [
          { stem: { de: "Wie sagt man 'der Bahnhof' auf Georgisch?", en: "How do you say 'train station' in Georgian?" }, options: ["აეროპორტი", "სადგური", "გაჩერება", "ნავსადგური"], correctIndex: 1 },
          { stem: { de: "Was bedeutet 'Wo ist das Hotel?' auf Georgisch?", en: "How do you say 'Where is the hotel?' in Georgian?" }, options: ["როგორ არის სასტუმრო?", "სად არის სასტუმრო?", "რა არის სასტუმრო?", "როდის არის სასტუმრო?"], correctIndex: 1 },
          { stem: { de: "Wie sagt man 'die Fahrkarte' auf Georgisch?", en: "How do you say 'ticket' in Georgian?" }, options: ["ბილეთი", "ჩემოდანი", "ადგილი", "გასაღები"], correctIndex: 0 },
          { stem: { de: "Wie sagt man 'links' auf Georgisch?", en: "How do you say 'left' in Georgian?" }, options: ["მარჯვნივ", "პირდაპირ", "მარცხნივ", "ახლოს"], correctIndex: 2 },
        ],
      },
      {
        exercises: [
          { stem: { de: "Was bedeutet 'Ich hätte gern ein Zimmer' auf Georgisch?", en: "How do you say 'I would like a room' in Georgian?" }, options: ["სახლს ვეძებ", "ოთახი მინდა", "გასაღები მაქვს", "პლაჟზე მივდივარ"], correctIndex: 1 },
          { stem: { de: "Wie sagt man 'das Gepäck' auf Georgisch?", en: "How do you say 'luggage' in Georgian?" }, options: ["ბარგი", "მოგზაურობა", "რუკა", "ფრენა"], correctIndex: 0 },
          { stem: { de: "Wie sagt man 'geradeaus' auf Georgisch?", en: "How do you say 'straight ahead' in Georgian?" }, options: ["მარცხნივ", "პირდაპირ", "მარჯვნივ", "უკან"], correctIndex: 1 },
          { stem: { de: "Wie sagt man 'der Flug' auf Georgisch?", en: "How do you say 'flight' in Georgian?" }, options: ["მატარებელი", "მანქანა", "ფრენა", "გემი"], correctIndex: 2 },
        ],
      },
    ],
  },
];

const TARGET_BANKS: Record<"es" | "ka", SeedSkill[]> = { es: ES_SKILLS, ka: KA_SKILLS };

/** Spread exercise difficulty slightly around the skill's CEFR anchor for placement variety. */
function itemDifficulty(cefr: Cefr, idx: number): number {
  const base = CEFR_DIFFICULTY[cefr];
  return Number((base - 0.2 + idx * 0.1).toFixed(2));
}

async function main() {
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

    const bank = TARGET_BANKS[tgt];
    for (let s = 0; s < bank.length; s++) {
      const skill = bank[s]!;
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
          const payload: McqPayload = mcqPayloadSchema.parse({
            stem: ex.stem[src],
            options: ex.options,
            correctIndex: ex.correctIndex,
          }); // integrity gate
          const exerciseId = `ex-${src}-${tgt}-${skill.key}-${l}-${e}`;
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
  }

  // eslint-disable-next-line no-console
  console.log(
    `Seeded: 4 languages, ${pairCount} pairs, 6 car tiers, ${skillCount} skills, ${lessonCount} lessons, ${exerciseCount} exercises`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
