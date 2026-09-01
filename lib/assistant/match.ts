// Fuzzy, case-insensitive name matching for every "find X by name" lookup
// the assistant's tools do (dish, ingredient, stock item, shopping item).
//
// Why this exists: a voice transcript is never the exact stored name. She
// says "delete the waterless chicken soup dish" — the DB row is just
// "Waterless Chicken Soup". A straight `name.ilike.%${query}%` requires the
// COLUMN to contain the whole query as a substring, which fails the moment
// the query has extra words wrapped around the real name (articles, "dish",
// a trailing noun). This module fixes that by checking containment in
// EITHER direction, and falls back to word-overlap scoring (with small
// per-word typo tolerance) for anything short of that. Pure functions only —
// no DB access here, so this is unit-testable on its own (see match.test.ts).

export type MatchResult<T> =
  | { kind: 'one'; row: T }
  | { kind: 'many'; rows: T[] }
  | { kind: 'none'; suggestions: T[] }

// Generic nouns/articles that show up WRAPPED AROUND a spoken name but
// aren't part of it — stripping them is what lets "the waterless chicken
// soup dish" reduce to "waterless chicken soup" and match outright.
const FILLER_WORDS = new Set([
  'the', 'a', 'an', 'my', 'some', 'that', 'this', 'of',
  'dish', 'recipe', 'item', 'ingredient', 'menu',
  'itu', 'ini', 'nya', 'yang', 'dari', 'resep',
])

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ')
}

function significantWords(s: string): string[] {
  return normalize(s).split(' ').filter(w => w && !FILLER_WORDS.has(w))
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Is `needle` present in `haystack` as a whole word/phrase, not just any
// substring? `\b` boundaries keep "ayam" from matching inside "bayam" —
// two unrelated Indonesian words that happen to share four letters.
function containsAsPhrase(haystack: string, needle: string): boolean {
  if (!needle) return false
  return new RegExp(`\\b${escapeRegex(needle)}\\b`, 'i').test(haystack)
}

// Plain Levenshtein edit distance — used only to tolerate a single
// mis-transcribed letter or two in an otherwise-recognizable word (ASR
// substitutes/drops letters far more often than it reorders whole words).
function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1])
      prev = tmp
    }
  }
  return dp[b.length]
}

// Two words "count" as the same token if identical, or close enough that a
// short ASR slip (one dropped/substituted letter) is the likely explanation
// — gated by length so short words don't false-positive against each other.
function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true
  if (a.length < 4 || b.length < 4) return false
  const maxDist = Math.min(a.length, b.length) >= 6 ? 2 : 1
  return levenshtein(a, b) <= maxDist
}

function overlapScore(queryWords: string[], nameWords: string[]): number {
  if (queryWords.length === 0 || nameWords.length === 0) return 0
  const overlap = nameWords.filter(nw => queryWords.some(qw => wordsMatch(qw, nw))).length
  return (2 * overlap) / (queryWords.length + nameWords.length)
}

const MATCH_THRESHOLD = 0.34 // below this, treat as "not found" rather than a real candidate
const SUGGEST_THRESHOLD = 0.15 // below MATCH_THRESHOLD but above this: still worth a "did you mean"
const TIE_MARGIN = 0.15 // candidates within this of the top score are all "in the running" (ambiguous)

/**
 * Matches `query` against `candidates` by name (via `getName`). Returns:
 * - `one` when there's a single confident match — exact/substring wins
 *   outright, otherwise the clear top scorer.
 * - `many` when several candidates are plausible and too close to guess
 *   between (e.g. "ayam" against a dozen chicken dishes) — callers should
 *   ask which one instead of picking.
 * - `none` when nothing clears the bar, with up to 3 near-miss
 *   `suggestions` for a "did you mean" hint.
 */
export function matchByName<T>(query: string, candidates: T[], getName: (row: T) => string): MatchResult<T> {
  const q = normalize(query)
  if (!q || candidates.length === 0) return { kind: 'none', suggestions: [] }

  // Exact match (case-insensitive) always wins outright, ambiguity and all.
  const exact = candidates.filter(c => normalize(getName(c)) === q)
  if (exact.length === 1) return { kind: 'one', row: exact[0] }
  if (exact.length > 1) return { kind: 'many', rows: exact }

  // Literal containment, either direction — handles both "extra words
  // around the real name" (query contains name) and "a short spoken name
  // inside what's stored" (name contains query). Word-boundary matched,
  // NOT raw substring: Indonesian compounds mean a raw substring check
  // would let "ayam" (chicken) match inside "bayam" (spinach) — wrong dish,
  // silently. \b keeps "ayam" from matching unless it's its own word.
  const contains = candidates.filter(c => {
    const n = normalize(getName(c))
    return containsAsPhrase(q, n) || containsAsPhrase(n, q)
  })
  if (contains.length === 1) return { kind: 'one', row: contains[0] }
  if (contains.length > 1) return { kind: 'many', rows: contains }

  // Fallback: word-overlap scoring for near-misses (typos, reordered or
  // partial phrases) that don't satisfy plain containment either way.
  const queryWords = significantWords(query)
  const scored = candidates
    .map(row => ({ row, score: overlapScore(queryWords, significantWords(getName(row))) }))
    .sort((a, b) => b.score - a.score)

  const top = scored[0]
  if (!top || top.score < SUGGEST_THRESHOLD) return { kind: 'none', suggestions: [] }
  if (top.score < MATCH_THRESHOLD) {
    return { kind: 'none', suggestions: scored.filter(s => s.score >= SUGGEST_THRESHOLD).slice(0, 3).map(s => s.row) }
  }
  const inTheRunning = scored.filter(s => s.score >= MATCH_THRESHOLD && s.score >= top.score - TIE_MARGIN)
  if (inTheRunning.length === 1) return { kind: 'one', row: inTheRunning[0].row }
  return { kind: 'many', rows: inTheRunning.slice(0, 6).map(s => s.row) }
}
