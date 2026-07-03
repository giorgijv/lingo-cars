---
name: add-language-pair
description: Use when asked to add a new source→target language pair (e.g. "add en→ru", "add the reverse direction", "add a French target") to Lingo Cars. Covers both content systems (the real backend content/ pipeline and the standalone docs/index.html demo), the exact parity bar to hit, and the verification steps to run before calling it done.
---

# Adding a language pair

Two independent content systems exist. A "pair" request usually touches both.

## 0. Figure out which case you're in

Content is banked **per target language**, not per pair, with a stem in
every source language actually paired with that target (`PAIRS` in
`src/content/bank.ts` — the single source of truth for which pairs exist,
shared by the seed and by content-coverage validation; see
`requiredSourcesFor(target)`). So:

- **New source for an existing target** (e.g. target `ru` already has a
  `de→ru` pair, now add `en→ru`): pure wiring, no content authoring, IF the
  bank already carries a stem for that source (it usually does — content is
  authored once per target with every currently-planned source). Skip
  straight to step 3.
- **Brand-new target language, or a genuinely new source→target direction**
  (e.g. adding the *reverse* direction — es/ka/ru speakers learning German
  or English — or adding a brand-new language like French): requires real
  content authoring (step 1) plus the demo banks (step 2) plus wiring
  (step 3), because the required stem language(s) don't exist in the bank
  yet.

Any language can be both a source and a target (e.g. `de` is the source for
`de→es` and the target for `es→de`) — nothing in the schema assumes a fixed
"source languages" vs "target languages" split; `SOURCE_LANGS`/`TARGET_LANGS`
in `src/content/bank.ts` are both just the full list of language codes.

## 1. Backend content (`content/{target}.json`)

- Schema/validator: `src/content/bank.ts` (`bankSchema`, `PAIRS`,
  `requiredSourcesFor`). Add every new `{src, tgt}` pair to `PAIRS` first —
  everything else derives from it.
- Loader/check script: `scripts/check-content.ts` (`npm run content:check`)
  iterates `TARGET_LANGS` automatically — no changes needed there.
- Mirror the shape and depth of `content/ka.json` (12 skills / 28 lessons /
  91 exercises, A1–C2): `greetings, numbers, colors, alphabet, food, travel,
  b1-structures, cases, verbs, b2-nuance, c1-idiom, c2-mastery`. Keep the
  same 12 skill *keys* for every new target for pipeline/test consistency,
  but adapt `alphabet`/`cases`/`verbs` to what's actually distinctive about
  that target's grammar — e.g. for German: umlauts/ß/capitalized nouns,
  the 4-case system (Nominativ/Akkusativ/Dativ/Genitiv), separable/modal
  verbs; for English: silent letters/spelling quirks, the pronoun-case
  system (subject/object/possessive — English nouns don't decline, so
  reframe `cases` around pronouns), irregular verbs/phrasal verbs. The goal
  is equivalent *depth*, not identical grammar terminology.
- `stemsSchema` is a **flexible per-language-code record**
  (`z.record(langCodeSchema, z.string())`), not a fixed `{de, en}` shape —
  a stem just needs an entry for every language actually in
  `requiredSourcesFor(bank.target)`. `bankSchema`'s `superRefine` checks
  this coverage at parse time and fails loudly (naming the exact skill/
  lesson/exercise and which language is missing) if a stem is short a
  required language — don't skip writing any of them. Per-source `options`
  variants (meaning-questions) are the same kind of record.
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

## 2. Demo (`docs/index.html`) — only when a target's demo banks don't exist yet

This is a single-file vanilla-JS demo, fully independent of the backend.

- `LANGS`: add `{name, flag}` for the new language code (if new).
- `PAIRS`: append `"src-tgt"` for each pair you're enabling.
- `TTS_LANG` / `SR_LANG`: add the BCP-47 locale (e.g. `ru: "ru-RU"`,
  `de: "de-DE"`, `en: "en-US"`) — used for the M2/M3 listen/speak types.
- `BANKS.{target}` (placement pool) and `STUDY_BANKS.{target}` (study pool):
  **match the existing banks' exact counts and distribution**, don't just
  add "some" content. As of this writing that's `STUDY_BANKS` = exactly 200
  items per target, `c` (difficulty tier 1–6) distribution `60/50/40/24/16/10`,
  all `mcq` with a `why` in every required source language; `BANKS` ≈
  46–49 items, `c` distribution roughly `14–17/13–15/9/4/2/2`, mostly `mcq`
  plus ~5 `fill`/3 `listen`/3 `speak`. Verify actual current counts before
  matching them — re-derive with the node/eval snippet in step 4 rather
  than trusting this file if it's gone stale.
- Every item's `s` object needs a stem for every source language that will
  use this target's bank (e.g. a `de`/`en`-target bank serving reverse pairs
  needs `s: {es, ka, ru}`, not `s: {de, en}`). `keyOf()` and `stemOf()` in
  the demo script are generic (`Object.values(q.s)[0]` / dynamic lookup by
  the pair's source code) — don't reintroduce a hardcoded `.de`/`.en`
  fallback anywhere; that exact bug shipped once (silent dedup-key
  collisions for non-de/en-sourced banks) and was only caught by review.
- Meaning-translation items (stem asks "what does X mean?") need
  `o: {lang1: [...], lang2: [...], ...}` (per-source options, one array per
  required source language) — vocab/phrase items (stem asks "how do you say
  X?") use a plain `o: [...]` array of target-language words/sentences.
  Don't mix these up (a plain array of source-language distractor text
  under a target-language stem is a real bug — it happened once and was
  caught by review, not by any automated check).
- For bulk content (100+ items), don't hand-type JS object literals in the
  editor — write a small Node generator script that builds the array from
  data tuples and emits the exact object-literal text, then splice it into
  the file. At 3+ source languages per item, also build a **shared concept
  table** (`{es, ka, ru, de, en, ...}` per word/phrase) once and generate
  every target's items from it via a template function — far cheaper than
  authoring each target's vocabulary from scratch, and keeps translations
  consistent across banks.
- If adding a *new pair-picker UI element* (dropdown, grouping, etc.), keep
  the underlying `<select id="pairSel">` as the single source of truth —
  `.value` and the `change` event must keep working exactly as before for
  every other call site (e.g. `syncAfterLogin` sets `$("pairSel").value`
  directly). Layer any fancier UI on top and re-sync its own display
  whenever `sel.value` changes, including from those other call sites.

## 3. Wiring (`prisma/seed.ts`)

- `PAIRS` now lives in `src/content/bank.ts` (imported by the seed, not
  redeclared) — add new pairs there, not in `prisma/seed.ts`.
- Add the language row (if new) to the languages upsert list.
- Add `{target}: loadBank("{target}")` to the `banks` object (if a new
  target bank was authored in step 1).
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
const pair = await db.languagePair.findUnique({ where: { sourceCode_targetCode: { sourceCode: "es", targetCode: "de" } } });
const skillCount = await db.skill.count({ where: { pairId: pair.id } });
```

For the demo, run a real headless-browser pass (Playwright,
`executablePath: "/opt/pw-browsers/chromium"`, launched from the repo root
so `playwright-core` resolves) — select the new pair (via whatever the
current pair-picker UI is), start placement, click through a few answer
options, and assert the question text actually shows the new source
language's script/words and the target language's answer options, with
zero `pageerror`/console-error events. Structural checks alone (valid JSON,
no duplicate keys, in-range indices) don't catch a wrong-language stem or a
broken meaning-question — the browser check does.

Also sanity-check demo content directly with node + eval before/after
editing (duplicate `keyOf()` collisions, out-of-range `a` indices,
mismatched per-source option-array lengths, `listen` transcript ≠
`options[a]`, missing stems for any required source language) — these are
the exact classes of bug that slipped through once each in earlier rounds
of this content.
