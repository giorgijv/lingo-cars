# Plan: Multi-modal placement (writing, listening, speaking)

> Status: **PLAN — not yet implemented.** Approved direction: make the
> placement test measure more than receptive recognition by adding items where
> the taker must **write text**, **hear and understand audio**, and
> **pronounce/read text aloud**.

## 1. Why (and what it fixes)

Today's placement is 15–24 adaptive **MCQs** — purely receptive. That is
reliable in a 10-minute budget (the D6 rationale) but has a known ceiling:
recognizing `sin embargo` among four options is much easier than producing it.
Consequences we want to fix:

- Placement systematically **over-places strong readers** who can't produce.
- The §9.3 **C-level checkpoint** (required before C1→C2) has nothing to run
  on — receptive mastery alone is a weak proxy exactly where it matters.
- FSRS only ever schedules recognition practice.

Guardrails unchanged: placement stays a **starting bet** (D6 — re-tiering
corrects it), and none of this touches tier gating (D3) or car projection (D5).

## 2. New exercise types

`ExerciseType` already reserves these: `mcq | fill | listen | match | speak`.
Payloads become a **zod discriminated union** in `src/content/mcq.ts` →
`src/content/payloads.ts`; the content pipeline (`content/*.json` +
`bank.ts`) validates each variant the same way it validates MCQs today.

### 2a. `fill` — write text (productive, auto-gradable, no new infra)

```jsonc
{ "type": "fill",
  "stem": { "de": "Übersetze: 'Ich hätte gern ein Zimmer.'", "en": "Translate: 'I would like a room.'" },
  "answers": ["quisiera una habitación", "querría una habitación"],  // accepted set
  "tolerance": 1 }                                                    // max edit distance per answer
```

Grading (server-side, deterministic):
1. Normalize: trim, collapse whitespace, lowercase, Unicode NFC; strip
   terminal punctuation. **Language-specific:** Spanish — accent-insensitive
   *second pass* (accent errors downgrade Easy→Good rather than fail);
   Georgian — no case folding needed (Mkhedruli has no upper case), but
   normalize the deprecated Asomtavruli/Nuskhuri ranges if pasted.
2. Accept if Damerau-Levenshtein distance to any accepted answer ≤ `tolerance`.
3. `Attempt` gains `responseJson` (the typed text) and `score` (0/partial/1) —
   see §4.

### 2b. `listen` — hear and understand (receptive listening)

```jsonc
{ "type": "listen",
  "audioKey": "ka/a2/sadguri-sad-aris.mp3",      // object-storage key
  "stem": { "de": "Was wurde gesagt?", "en": "What was said?" },
  "options": ["…", "…", "…", "…"], "correctIndex": 1,
  "transcript": "სადგური სად არის?" }             // for review screens, never shown pre-answer
```

Audio pipeline (extends the Phase 2 content pipeline):
- **Build step** `content:audio`: for every `listen` item, synthesize TTS once
  at content-build time, upload to object storage (Supabase storage per §7),
  record the `audioKey`. `content:check` fails if a `listen` item's audio is
  missing — same "invalid content can't ship" guarantee.
- **Voices:** Spanish — abundant (any major TTS). **Georgian — the moat
  constraint:** Google Cloud TTS and Azure both ship `ka-GE` voices; quality
  must be validated by a native speaker before trusting it for assessment
  items. Fallback: human-recorded clips for the (small) placement item bank
  first, TTS for lesson volume later.
- Client plays audio (limit: 2 plays per item during placement); answering is
  the existing MCQ flow, so grading is unchanged.
- Demo site: browser `speechSynthesis` is fine for `es`, unreliable for `ka` —
  the demo ships listening for Spanish only until real audio assets exist.

### 2c. `speak` — pronounce / read aloud (productive speech)

```jsonc
{ "type": "speak",
  "stem": { "de": "Lies laut vor:", "en": "Read aloud:" },
  "text": "ორი წელია ქართულს ვსწავლობ",
  "minScore": 0.6 }
```

- Client records via `MediaRecorder` (webm/opus), uploads to the API.
- **ASR runs in a separate Python service** behind the API — exactly the §7
  rule ("heavy Georgian NLP/ASR goes in a separate Python service, not the
  primary backend"). Whisper supports both `es` and `ka`; Georgian accuracy
  is moderate and needs empirical validation (moat work again).
- Score = `1 − normalized WER(transcript, target)` with per-language token
  normalization; `score ≥ minScore` counts as correct. Phoneme-level scoring
  (forced alignment) is a later refinement, not MVP.
- **Privacy:** explicit mic-consent screen; audio deleted after scoring by
  default (retain only transcript + score in `responseJson`); retention
  opt-in for model improvement kept separate.

## 3. Placement integration — staged adaptive test

Keep one adaptive session (~15–20 items, still ≤ 10 min), staged by modality:

| Stage | Items | Modality | Role |
|---|---|---|---|
| 1 | 1–8 | `mcq` (current ramp) | fast receptive ability estimate θ |
| 2 | 9–12 | `fill` at current θ | productive check — the main over-placement corrector |
| 3 | 13–15 | `listen` at current θ | listening comprehension |
| 4 | +1 (optional) | `speak` | **non-gating**: scored async, feeds re-tiering (D6), never blocks the result |

- Ability model: keep a single θ initially; productive items carry a higher
  information weight (~1.3×) in the update. A per-modality θ vector (read /
  write / listen / speak sub-scores on the result screen) is the follow-up.
- Failure isolation: if the mic or audio is unavailable, stages 3–4 are
  skipped and confidence is reported lower — never a blocked test.
- The same `fill` + `speak` machinery later powers the §9.3 **C-level
  checkpoint** (`assessments` table arrives then, not before).

## 4. Schema changes (small, additive)

```prisma
model Attempt {
  // existing fields unchanged (append-only stays enforced)
  responseJson Json?   // typed text / transcript / chosen option — the raw response
  score        Float?  // graded 0..1 for productive items (null for plain mcq)
}
```
FSRS mapping generalizes `gradeFor`: `score ≥ 0.85 → Easy`, `≥ 0.6 → Good`,
else `Again` (latency keeps breaking ties for MCQ). Replay determinism is
preserved because grading inputs are stored on the immutable attempt.

## 5. Delivery milestones

| M | Scope | Size | New infra |
|---|---|---|---|
| **M1** | `fill` type end-to-end (payloads, grading, content, placement stage 2, demo text input) | S–M | none |
| **M2** | `listen` type + `content:audio` build step + storage/CDN | M | TTS account, object storage |
| **M3** | `speak` type + ASR microservice (Python/Whisper) + consent flow | L | GPU/CPU inference host |
| **M4** | staged placement + per-modality sub-scores + C-checkpoint groundwork | M | — |

M1 is buildable immediately with zero new dependencies and already delivers
the biggest measurement win (productive writing).

## 6. Risks / open questions

1. **Georgian TTS & ASR quality** — the single biggest unknown; needs native
   review before any `ka` audio/speech item counts toward placement. (This IS
   the moat: solving it is the Phase 2 §9b.5 sourcing decision.)
2. Typo tolerance tuning for `fill` (per-CEFR tolerance? accent policy) —
   start strict-but-forgiving, tune from real attempt data.
3. CI: audio/ASR must be mocked; unit tests grade from fixtures.
4. Cost: TTS is one-time per item (cheap); ASR is per-attempt (meter it).
5. Cheating surface: placement `fill` answers are typable into a translator —
   acceptable for a starting bet (D6 self-corrects), revisit for checkpoints.
