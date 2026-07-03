---
name: add-language-pair
description: Use when asked to add a new source→target language pair (e.g. "add en→ru", "add a French target") to Lingo Cars. Covers both content systems (the real backend content/ pipeline and the standalone docs/index.html demo), the exact parity bar to hit, and the verification steps to run before calling it done.
---

# Adding a language pair

Two independent content systems exist. A "pair" request usually touches both.

## 0. Figure out which case you're in

Content is banked **per target language**, not per pair, with per-source
(`de`/`en`) stems inside each item. So:

- **New source for an existing target** (e.g. target `ru` already has a
  `de→ru` pair, now add `en→ru`): pure wiring, no content authoring. Every
  item already has both `de` and `en` stems (the schema requires both). Skip
  straight to step 3.
- **Brand-new target language** (e.g. add French): requires real content
  authoring (step 1) plus the demo banks (step 2) plus wiring (step 3).

## 1. Backend content (`content/{target}.json`)

- Schema/validator: `src/content/bank.ts` (`bankSchema`, `SOURCE_LANGS`,
  `TARGET_LANGS`). Add the new target code to `TARGET_LANGS`.
- Loader/check script: `scripts/check-content.ts` (`npm run content:check`)
  iterates `TARGET_LANGS` automatically — no changes needed there.
- Mirror the shape and depth of `content/ka.json` (the deepest existing
  bank — 12 skills / 28 lessons / 91 exercises, A1–C2): `greetings, numbers,
  colors, alphabet, food, travel, b1-structures, cases, verbs, b2-nuance,
  c1-idiom, c2-mastery`. The `alphabet`/`cases`/`verbs` skills exist
  specifically to give each new script/case-heavy language the same
  curriculum depth as Georgian — always include them for a new language with
  a non-Latin script or a real case system.
- Every exercise needs `stem: {de, en}` (both required by
  `stemsSchema` even if you're only wiring one source pair right now — write
  both so the other source can be added later for free, per case above).
- Four exercise shapes, mutually exclusive by which key they carry:
  `options`/`correctIndex` (mcq), `answers` (fill), `transcript` +
  `options`/`correctIndex` (listen — transcript must equal
  `options[correctIndex]` verbatim), `text` (speak). `.strict()` schemas
  reject stray cross-type keys.
- No `why` field in this schema — that only exists in the demo's
  `STUDY_BANKS` (see step 2). Don't add it here or `bankSchema.parse` fails.
- Grading edge case: check `src/content/grading.ts` (`stripAccents`) for
  whether the new language needs a normalization fold, the way Russian ё→е
  was added there — anywhere native typists commonly substitute one
  character for another that isn't a combining diacritic NFD would strip.

## 2. Demo (`docs/index.html`) — only for a brand-new target

This is a single-file vanilla-JS demo, fully independent of the backend.

- `LANGS`: add `{name, flag}` for the new language code.
- `PAIRS`: append `"src-tgt"` for each pair you're enabling (e.g. `"de-ru"`).
- `TTS_LANG` / `SR_LANG`: add the BCP-47 locale (e.g. `ru: "ru-RU"`) — used
  for the M2/M3 listen/speak exercise types.
- `BANKS.{target}` (placement pool) and `STUDY_BANKS.{target}` (study pool):
  **match the existing banks' exact counts and distribution**, don't just
  add "some" content. As of this writing that's `STUDY_BANKS` = exactly 200
  items per target, `c` (difficulty tier 1–6) distribution `60/50/40/24/16/10`,
  all `mcq` with a bilingual `why`; `BANKS` ≈ 46–49 items, `c` distribution
  roughly `14/15/9/4/2/2`, mostly `mcq` plus ~5 `fill`/3 `listen`/3 `speak`.
  Verify actual current counts before matching them — re-derive with the
  node/eval snippet in step 4 rather than trusting this file if it's gone
  stale.
- Meaning-translation items (stem asks "what does X mean?") need
  `o: {de: [...], en: [...]}` (bilingual options) — vocab/phrase items
  (stem asks "how do you say X?") use a plain `o: [...]` array of
  target-language words/sentences. Don't mix these up (a plain array of
  German/English distractor text under an English stem is a real bug —
  it happened once and was caught by review, not by any automated check).
- For bulk content (100+ items), don't hand-type JS object literals in the
  editor — write a small Node generator script that builds the array from
  data tuples and emits the exact object-literal text, then splice it into
  the file. Far less error-prone at this volume, and lets you assert the
  count/distribution programmatically before touching the HTML.

## 3. Wiring (`prisma/seed.ts`)

- Add the language row (if new) to the languages upsert list.
- Add each new `{ src, tgt }` pair to the `PAIRS` array.
- Add `{target}: loadBank("{target}")` to the `banks` object (if new target).
- Update the two stale-comment-prone spots: the header comment ("all N
  pairs") and the final `console.log` ("Seeded: N languages, …").

## 4. Verify — don't skip any of these

```bash
npm run typecheck
npm run content:check          # prints skills/lessons/exercises/perCefr per target
npm test                       # if DB tests fail, check `pg_lsclusters` first —
                                # Postgres going down in this sandbox is an
                                # environment quirk, not a regression; restart
                                # with `sudo pg_ctlcluster 16 main start` (or
                                # without sudo) and re-run before assuming
                                # your change broke something
npx prisma migrate deploy && npx tsx prisma/seed.ts   # reseed
```

Then actually query the new pair against the live DB (copy a throwaway
`.ts` file into the repo root — `tsx` needs repo-root-relative module
resolution for `@prisma/client` — write an async `main()`, no top-level
await, then delete the file):

```ts
const pair = await db.languagePair.findUnique({ where: { sourceCode_targetCode: { sourceCode: "en", targetCode: "ru" } } });
const skillCount = await db.skill.count({ where: { pairId: pair.id } });
```

For the demo, run a real headless-browser pass (Playwright,
`executablePath: "/opt/pw-browsers/chromium"`, launched from the repo root
so `playwright-core` resolves) — select the new pair from `#pairSel`, click
`#startBtn`, click through a few `button.opt` options, and assert the
question text actually shows the new language's script/words with zero
`pageerror`/console-error events. Structural checks alone (valid JSON, no
duplicate keys, in-range indices) don't catch a wrong-language stem or a
broken meaning-question — the browser check does.

Also sanity-check demo content directly with node + eval before/after
editing (duplicate `keyOf()` collisions, out-of-range `a` indices,
mismatched `de`/`en` option-array lengths, `listen` transcript ≠
`options[a]`) — these are the exact classes of bug that slipped through
once each in earlier rounds of this content.
