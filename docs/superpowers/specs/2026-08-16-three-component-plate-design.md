# 3-Component Plate (MAIN + SAYURAN + SOUP) — Design

**Date:** 2026-08-16
**Scope:** Restructure meal generation from 5 slots to a fixed 3-component plate (main + sayuran +
conditional soup + optional desert). Retire `pelengkap` from generation and exclude `is_garnish` /
inactive dishes.

## DB (already done)

`dishes.is_garnish boolean`. Currently true for the 3 pelengkap garnishes: Teri krispi, Baby cumi pedas,
Sambel tempe teri. Generatable pools (active, non-garnish): kuah 16, sayuran 18, utama 42, desert 11.

## Plate model (`composeDay` rewrite, `lib/meals/engine.ts`)

Per day, compose exactly:
1. **MAIN** (utama) — protagonist; all existing rules (protein rotation, protein-clash, special quota,
   difficulty quota, saltiness, fried cap, spicy floor, rating weight, no-repeat).
2. **SAYURAN** (veg) — always picked (`role:'support'`).
3. **SOUP** (kuah):
   - if `main.provides_soup === true` → emit a `skipped:true` kuah row (no dish), `role:'support'`.
   - else → pick a kuah (`role:'support'`).
4. **DESERT** — optional, `role:'optional'`, always.

**Drop** the `pelengkap` pick and the `richness`/`extra` budget entirely. `pickPreferNonFried` becomes
unused (remove it). `plannedRemaining` for the spicy floor: main=1, sayuran=(providesSoup?0:1), soup=0,
desert=0.

Locked cells still honored: if utama locked, use it (derive `provides_soup` from it); if sayuran/kuah/
desert locked, skip that pick (row already present).

## Exclusions (hard, never relaxed)

Add `!dish.is_garnish` to `passesHardRules` (next to `dish.active`) **and** to the last-resort fallback
filter in `pickForSlot`. Effect: garnish + inactive dishes are never generated, never returned as reroll
alternatives (`candidates` → `passesHardRules`), and never chosen by single-slot reroll.

All existing per-day/per-week rules unchanged, now spanning main + sayuran + soup.

## Types + routes

- `lib/meals/types.ts`: `Dish` += `is_garnish: boolean`.
- `app/api/meals/dishes/route.ts` POST: default `is_garnish: body.is_garnish ?? false`.
- `app/api/meals/dishes/[id]/route.ts` PATCH `FIELDS`: += `'is_garnish'`.
- `generate` + `reroll` `select('*')` already carry the field. Reroll recompose uses `composeDay`, so it
  drops pelengkap automatically. Single-slot reroll validates `slot ∈ SLOTS` (pelengkap still valid for
  any lingering locked rows, but none are generated).

## UI (`components/meals/PlanClient.tsx`)

Support cards render generically from `role:'support'` rows, so after a regenerate a plate shows
**sayuran + soup** (or sayuran + the "🥣 broth from the main" note). Verify no pelengkap-specific code
exists; the existing 2-up 50/50 support layout already fits two cards. No functional change expected.

## Dishes editor (`components/meals/DishesClient.tsx`)

- Add an **is_garnish** toggle column (same toggle style as spicy/active).
- Garnish rows show a small muted label **"garnish — not auto-planned"** (e.g. under the name).
- Garnish dishes stay fully visible/editable — only excluded from generation.
- Update table header + `colSpan`.

## Validation (`validateWeek`, wired in generate route)

Extend `validateWeek` to additionally flag, for the generated week:
- any dish with `is_garnish === true`,
- any non-skipped `pelengkap` slot pick.
Report format e.g. `⚠️ 2026-08-17: garnish dish planned (Teri krispi)` / `⚠️ week: pelengkap slot
generated (…)`. Re-run after generating; expect a clean report (plus no salty/fried/difficulty/special
violations).

## Testing (`lib/meals/engine.test.ts`)

- `passesHardRules`/`candidates` exclude `is_garnish` and `active:false`.
- `composeDay`: produces exactly main + sayuran + soup(or skipped) + desert; **no pelengkap row**;
  soup present iff `!provides_soup`.
- `generateWeek`: no pelengkap picks anywhere; no garnish dishes; existing invariants hold (one main +
  desert/day, 2 specials non-adjacent, ≤2 hard non-adjacent, ≤1 salty/day).
- `validateWeek`: flags a garnish dish and a pelengkap pick.

## Non-goals (YAGNI)

- No DB migration; no deletion of pelengkap dishes or the column (kept for manual slot moves).
- `richness` field stays on `Dish` (now unused in composition).
- No auto-cleanup of pre-existing locked pelengkap rows (they persist until the user moves/clears them).
