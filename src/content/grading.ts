/**
 * Grading for productive (typed) exercises — see plans/placement-modalities.md
 * §2a. Deterministic, pure, and language-agnostic (Spanish accents; Georgian
 * Mkhedruli has no case/accents, so the accent-insensitive pass is a no-op
 * for it — same code path, no per-language branching needed).
 *
 * Score buckets (drive both "is it correct" and FSRS grade quality):
 *   1.00  exact match after normalization
 *   0.85  matches only once accents are stripped (typo forgiven, still
 *         counts, but grades as Good rather than Easy)
 *   0.60  within the accepted edit-distance tolerance (Good)
 *   0.00  no accepted answer is close enough (Again)
 *
 * NOTE: uses plain Levenshtein distance (insert/delete/substitute), not full
 * Damerau-Levenshtein (adjacent-transposition swaps count as 2 edits, not 1).
 * A reasonable simplification at the tolerance sizes used here (0–3).
 */

export function normalizeAnswer(s: string): string {
  return s
    .normalize("NFC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[¿¡]+|[.,!?¡¿;:]+$/g, "");
}

/** Strip combining diacritics (á→a, ñ→n, …). No-op for scripts without them. */
export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Levenshtein edit distance (insert/delete/substitute), O(n*m), fine at short answer lengths. */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

export interface FillGradeResult {
  correct: boolean;
  score: number; // 0, 0.6, 0.85, or 1
  matchedAnswer: string | null;
}

/** Grade a typed response against the accepted answer set. Pure, deterministic. */
export function gradeFillAnswer(response: string, answers: string[], tolerance: number): FillGradeResult {
  const norm = normalizeAnswer(response);
  if (norm.length === 0) return { correct: false, score: 0, matchedAnswer: null };

  for (const answer of answers) {
    if (norm === normalizeAnswer(answer)) return { correct: true, score: 1, matchedAnswer: answer };
  }

  const normNoAccents = stripAccents(norm);
  for (const answer of answers) {
    if (normNoAccents === stripAccents(normalizeAnswer(answer))) {
      return { correct: true, score: 0.85, matchedAnswer: answer };
    }
  }

  let best = Infinity;
  let bestAnswer: string | null = null;
  for (const answer of answers) {
    const d = levenshtein(norm, normalizeAnswer(answer));
    if (d < best) {
      best = d;
      bestAnswer = answer;
    }
  }
  if (best <= tolerance) return { correct: true, score: 0.6, matchedAnswer: bestAnswer };

  return { correct: false, score: 0, matchedAnswer: null };
}
