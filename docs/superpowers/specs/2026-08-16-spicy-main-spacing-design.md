# No Consecutive Spicy Mains — Design

**Date:** 2026-08-16
**Scope:** Add a spacing rule so two spicy **utama (main)** dishes never fall on adjacent days, mirroring
the existing special/hard adjacency rules; relaxable late; validated + reported.

## Rule (`spicyMainSpacingOk`, `lib/meals/engine.ts`)

Hard rule normally, gated by a new `relax.spicyMainSpacing` flag:
- Applies only when `ctx.slot === 'utama'` **and** `dish.spicy === true`. All other dishes pass (a spicy
  sayuran/soup next to a spicy main is fine).
- Rejects the candidate if the **previous or next calendar day** already holds a spicy utama, checking
  both `ctx.runPicks` (this week) and `ctx.priorPlans` (previous week's last day → Sunday/Monday boundary),
  exactly like `difficultyOk`'s hard-day spacing.
- Added to `passesHardRules`.

`PickContext.relax` gains `spicyMainSpacing: boolean`; add to `ENFORCED` (`false` = enforced).

## Relaxation ladder (drop-first order)

Insert `spicyMainSpacing` late — just before the no-repeat relaxation:
```
hardSpacing → hardDay → spicy-floor → fried → proteinClash → spicyMainSpacing → noRepeatFactor 0.5
```
So spicy-main adjacency is relaxed only when no other candidate satisfies every rule, and **before** the
no-repeat window shortens or protein rotation breaks (protein rotation / no-repeat only give way at the
final last-resort fallback). The last-resort fallback (already drops everything but no-repeat + saltiness)
implicitly allows it too.

## Soft weight (light touch)

`weightFor` multiplies a spicy **main** candidate by `×0.5` when the day before or after already has a
spicy main (`spicySpreadFactor`), nudging spicy mains apart. Pure weight; never gates the pool.

## Validation (`validateWeek`)

Flag adjacent spicy mains: for any two dates 1 day apart that each have a spicy `utama`, push
`⚠️ {d1}-{d2}: two spicy mains adjacent — pool constraint`. Appears only when the rule was relaxed
(otherwise the hard rule prevents adjacency). All existing checks (salty, fried, difficulty, special,
protein-clash, garnish, pelengkap) unchanged.

## Routes

No behavior change. `composeDay`'s `mkCtx` and `generateWeek` build relax from `ENFORCED` (auto-covered).
The reroll route's inline relax literal + the engine test `ctx()` helper + any explicit relax literals in
tests/ladder/last-resort gain the new field.

## Testing (`lib/meals/engine.test.ts`)

- `spicyMainSpacingOk`: spicy utama blocked when prev-day utama spicy; blocked across the week boundary via
  priorPlans; a spicy utama with a spicy sayuran neighbor is fine; non-utama / non-spicy always pass;
  relaxable via `relax.spicyMainSpacing`.
- ladder: a spicy main adjacent to a spicy main becomes eligible only once `spicyMainSpacing` is relaxed,
  and only after fried/proteinClash but before no-repeat.
- `generateWeek`: no two adjacent days both have a spicy utama (with a pool that allows it).
- `validateWeek`: flags two adjacent spicy mains.

## Non-goals

- Only the utama slot's `spicy` matters (per requirement).
- No DB/UI change.
