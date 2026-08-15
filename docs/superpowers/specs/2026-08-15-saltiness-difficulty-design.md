# Saltiness + Difficulty in Meal Generation — Design

**Date:** 2026-08-15
**Scope:** Add two dish attributes (`saltiness`, `difficulty`) to the Dishes editor and use them as
generation rules — a per-day saltiness cap + mild-main preference, and a per-week hard-dish quota
coordinated with the existing special-tier quota.

## DB (already added)

`dishes` has:
- `saltiness 'normal'|'salty'|'very_salty'` (default `normal`). Current spread: normal 83, salty 8, very_salty 4.
- `difficulty 'easy'|'medium'|'hard'` (default `medium`). Spread: easy 20, medium 52, hard 23 (13 hard are `special` tier).

## Types (`lib/meals/types.ts`)

- `Saltiness = 'normal'|'salty'|'very_salty'`, `Difficulty = 'easy'|'medium'|'hard'`.
- `Dish` gains `saltiness: Saltiness`, `difficulty: Difficulty`.
- Test fixtures default `saltiness:'normal'`, `difficulty:'medium'`.

## Engine (`lib/meals/engine.ts`)

### Hard-allowed days
`preassignHardDays(days: string[], specialDays: Set<string>, rng: Rng): Set<string>`:
- Seed the result with `specialDays` (so hard nights coincide with specials).
- If `< 2`, add more non-adjacent days (|dayIndex diff| ≥ 2) until size 2 (shuffled by `rng`).
- Return ≤2 non-adjacent days. Stored on `PickContext.hardDays`.

### New hard rules (added to `passesHardRules`)
- `saltinessOk(dish, ctx)`: if `dish.saltiness !== 'normal'` and the day already has a non-normal-saltiness
  dish (in `runPicks` for `ctx.date`, excluding skipped), reject. Relaxable via `ctx.relax.saltyCap`.
- `difficultyOk(dish, ctx)`: if `dish.difficulty === 'hard'`:
  - require `ctx.hardDays.has(ctx.date)` unless `ctx.relax.hardDay`;
  - require no existing hard dish on the day (≤1 hard/day) unless `ctx.relax.hardDay`;
  - adjacency is guaranteed by non-adjacent `hardDays`; an explicit `ctx.relax.hardSpacing` guards the
    (rare) reroll case where a hard dish sits on a day adjacent to another hard day.
  Non-hard dishes always pass.

### Mild-main soft weight
`weightFor(dish, ctx)` = `rating² × freshness × saltMainFactor(dish, ctx)` where
`saltMainFactor` = (only when `ctx.role === 'main'`) normal ×1.4, salty ×1.0, very_salty ×0.5; else ×1.
Pure weight: it biases the main toward mild saltiness (leaving room for a salty accent) but never gates
the candidate pool, so it is never a relaxation step.

### PickContext
Add `hardDays: Set<string>`; extend `relax` with `saltyCap: boolean`, `hardDay: boolean`,
`hardSpacing: boolean` (all default false-meaning-"enforced" i.e. `false` = rule ON, matching the
existing `spicy`/`fried` booleans where `true` = relaxed). Keep `spicy`, `fried`, `noRepeatFactor`.

### Relaxation ladder (drop-first order, cumulative)
Only pool-filter rules relax:
0. all enforced
1. `hardSpacing` relaxed
2. + `hardDay` relaxed (hard allowed off designated days / >1 per day)
3. + `saltyCap` relaxed (2nd salty accent allowed)
4. + `spicy` relaxed
5. + `fried` relaxed
6. + `noRepeatFactor = 0.5`
last resort: any active dish of the slot, keeping the halved no-repeat.
Never relax no-repeat below 2 days or protein rotation (except the existing last-resort fallback).

### composeDay
After `specialDays`, compute `hardDays = preassignHardDays(days, specialDays, rng)` once per week and
pass it into every `mkCtx`. (composeDay currently receives `specialDays`; add `hardDays` param, computed
in `generateWeek`.)

## Persistence / routes

- `app/api/meals/dishes/route.ts` POST: default `saltiness:'normal'`, `difficulty:'medium'`.
- `app/api/meals/dishes/[id]/route.ts` PATCH `FIELDS`: add `'saltiness'`, `'difficulty'`.
- `generate` + `reroll` select `dishes.*` already, so the engine sees the new fields with no query change.
- `reroll` `buildSingleContext` / recompose: derive `hardDays` = `specialDays` (week's special-main days)
  ∪ days already holding a `hard` dish (from week rows, excluding the target cell). Saltiness is enforced
  via the day's other picks already present in `runPicks`.

## Dishes editor (`components/meals/DishesClient.tsx`)

Two new columns (inline PATCH, same as Protein/Tier):
- **Saltiness**: `<select>` normal / salty / very salty.
- **Difficulty**: a clickable **3-pip meter** — 3 dots, filled to 1/2/3 for easy/medium/hard, colored
  (easy green, medium amber, hard red); clicking a pip sets that level. Falls back to accessible labels.
Update the table header + `colSpan`.

## Testing (`lib/meals/engine.test.ts`)

- `saltinessOk`: rejects a 2nd non-normal on a day; allows one; normal always ok.
- `difficultyOk`: hard rejected off hard-days; allowed on a hard-day with no prior hard; 2nd hard rejected.
- `preassignHardDays`: ≤2, non-adjacent, includes the special days; tops up when specials < 2.
- `weightFor`: normal main outweighs a very_salty main at equal rating/freshness; non-main unaffected.
- relaxation ladder: a hard dish off a hard-day becomes eligible only once `hardDay` is relaxed; ordering
  drops difficulty/saltiness before spicy/fried/no-repeat.
- `generateWeek`: ≤2 hard/week, non-adjacent, all on special-assigned days; ≤1 non-normal saltiness/day;
  existing invariants (one main + desert/day, 2 specials non-adjacent) still hold.

## Non-goals (YAGNI)

- No UI surfacing of saltiness/difficulty on the plan hero/chips (editor-only for now).
- No change to the shopping list or recipe pages.
- No migration (columns already exist).
