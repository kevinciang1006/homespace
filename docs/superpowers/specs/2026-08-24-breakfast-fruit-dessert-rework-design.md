# Breakfast/fruit/dessert rework — design

## Goal

Replace the confusing independent "desert" + "evening fruit" day-card lines
with two coherent pairings — a breakfast dish+fruit pair, and a dessert
item+fruit pair — where the dessert item comes from a small (max 3 types)
weekly batch instead of a fresh pick every day. Add dedicated randomize
buttons for each, seed images for the dish pools that lack them, and
restyle both pairings as small image-left cards.

## Non-goals

- No changes to dinner's main/support/kuah rules, difficulty/spicy/fried
  caps, or the day/week reroll for those slots.
- No settings-UI control for the dessert cap this round (it's a code
  constant per your call) — can move to a settings table later if wanted.
- No renaming/merging of the near-duplicate fruit dishes that result from
  re-slotting (e.g. "Jeruk" vs "Jeruk (sore)" both ending up in the fruit
  pool) — out of scope, not this batch's problem to solve.

## Data model

### Migration

```sql
-- The 6 desert-slot rows that are actually plain fruits (fruit_context='any')
-- move to the fruit slot, joining the shared fruit pool used for both
-- breakfast pairing and dessert pairing. They keep their existing images.
update dishes set slot = 'fruit' where slot = 'desert' and fruit_context = 'any';

-- Prevent duplicate batch entries if a week's batch is regenerated without
-- a full delete first (defense in depth around the delete-then-insert flow below).
alter table dessert_week_items add constraint dessert_week_items_week_dish_key unique (week_start, dish_id);
```

After this, the `desert` slot holds exactly 5 real desserts (Banana cake,
Barley water, Brownie, Kacang ijo, Yogurt — all already have images); the
`fruit` slot holds 10 (the original 4 "(sore)" dishes, which lack images,
plus the 6 re-slotted ones, which don't).

### Types (`lib/meals/types.ts`)

- `Dish` gains `fruit_context: string | null`.
- `MealPlan['dishes']` gains `fruit_context?: string | null`.
- New `DessertWeekItem = { id: string; week_start: string; dish_id: string; dish_name: string; kind: string }`.
- No new `Role` value — the breakfast-fruit row reuses the existing
  `role: 'breakfast'`; the dessert-fruit row keeps today's `role: 'optional'`.
  The two `slot: 'fruit'` rows a day now holds are told apart by `role`.

## Engine (`lib/meals/engine.ts`)

### Fruit pool filtering

```ts
// A dish with no context set is eligible everywhere (permissive default) —
// matches today's data, where every fruit-slot dish is fruit_context='any'.
export function fruitPoolFor(context: 'breakfast' | 'dessert', fruitDishes: Dish[]): Dish[] {
  return fruitDishes.filter(d =>
    d.active && !d.is_garnish && (d.fruit_context == null || d.fruit_context === 'any' || d.fruit_context === context))
}
```

### Breakfast pair

`composeDay`'s breakfast step gains a second push right after the existing
breakfast-dish pick, guarded by its own lock check.

`lockedByCell` is currently keyed `${date}|${slot}`, which is no longer
unique once a day can hold two `slot: 'fruit'` rows — the key becomes
`${date}|${slot}|${role}` specifically when `slot === 'fruit'` (every
other slot has exactly one `role` per day, so the key is unchanged there).
This touches `composeDay`'s `isLocked`/`lockedDish` helpers and
`generateWeek`'s `lockedByCell` construction.

The actual pick is a plain `pickForSlot(fruitPoolFor('breakfast', dishesBySlot.fruit), mkCtx('fruit', 'breakfast', 0), rng)`
— fruit dishes are already neutral on every dinner cross-slot rule (per
the existing comment on the old evening-fruit step), so this is zero new
hard-rule code, just a context-filtered pool and a `role: 'breakfast'` tag.

### Dessert pair (replaces the old free-per-day desert pick)

```ts
export const DESSERT_NO_REPEAT_DAYS = 2 // short window — repeats across the week are the point of batching

// Picks one dish from the week's small dessert batch for a single day.
// Deliberately NOT windowFor/noRepeatOk (those read DEFAULT_NO_REPEAT.desert=10,
// tuned for the old "fresh pick every day from ~11 dishes" model) — a bespoke
// short-window filter fits a 2-3-item batch meant to repeat every few days.
export function pickDessertForDay(batch: Dish[], ctx: PickContext, rng: Rng): Pick {
  if (batch.length === 0) {
    return { plan_date: ctx.date, slot: 'desert', dish_id: null, dish_name: null,
      locked: false, role: 'optional', skipped: true }
  }
  const usedRecently = (dish: Dish) =>
    [...ctx.priorPlans, ...ctx.runPicks]
      .filter(p => p.dish_id === dish.id && p.slot === 'desert')
      .some(u => Math.abs(daysBetween(u.plan_date, ctx.date)) < DESSERT_NO_REPEAT_DAYS)
  const fresh = batch.filter(d => !usedRecently(d))
  const pool = fresh.length > 0 ? fresh : batch // relax: repeat rather than leave the day empty
  return toPick(ctx, weightedPick(pool, ctx, rng)!)
}
```

`weightedPick` → `weightFor` → `freshnessFactor` still applies on top of
this pre-filter, so among the "not used in the last 2 days" candidates,
higher-rated ones win more often — this is what naturally spreads a
3-item batch across 7 days without a separate distribution algorithm: each
day's `composeDay` call already sees every prior day's picks via
`runPicks`, so calling `pickDessertForDay` once per day in date order (the
same way every other slot already works) *is* the distribution.

`composeDay` gains a `dessertBatch: Dish[]` input (the week's current
batch — see below for who computes it) and replaces the old
`pickForSlot(dishesBySlot.desert, ...)` call with
`pickDessertForDay(dessertBatch, mkCtx('desert', 'optional', 0), rng)`
when the desert cell isn't locked.

The dessert-fruit pick is the old evening-fruit code path, unchanged
except its pool is now `fruitPoolFor('dessert', dishesBySlot.fruit)`.

### `lib/meals/dessert.ts` (new, pure + unit-tested)

```ts
export const DESSERT_WEEK_CAP = 3

// Weighted (rating^2, no replacement) pick of up to `cap` dessert dishes for
// the week's batch. `mustInclude` (dish_ids from any locked desert-slot
// day-cells) are always kept, so regenerating the batch never orphans an
// existing lock's dish out of the pool it's supposed to belong to.
export function pickDessertBatch(pool: Dish[], mustInclude: string[], cap: number, rng: Rng): Dish[]
```

### `generateWeek` / reroll wiring

- `generateWeek` computes the batch via `pickDessertBatch(dishesBySlot.desert, lockedDessertDishIds, DESSERT_WEEK_CAP, rng)` *before* the per-day loop (same timing as `specialDays`/`breakfastSpecialDays`), then passes it as `dessertBatch` into every `composeDay` call.
- `app/api/meals/generate/route.ts` persists the chosen batch: upsert `dessert_weeks` (`week_start`), delete+insert `dessert_week_items` for that `week_start` (same delete-then-insert pattern the shopping-list generator already uses for its non-locked rows). Each inserted row is `{ week_start, dish_id, dish_name, kind: 'dessert' }` — `kind` always `'dessert'` for this feature; it exists in the schema for future extensibility, not something this batch needs to vary.
- **Day reroll** (`scope: 'day'`) and **main reroll** (both already call `composeDay` to recompose the whole day): fetch the week's *existing* `dessert_week_items` batch first and pass it through unchanged — a single-day recompose must never invent a 4th dessert type or bypass the cap.
- **New `scope: 'week-breakfasts'`**: for every non-locked day, re-run `preassignBreakfastSpecialDays` + `pickBreakfast` for the dish and `fruitPoolFor('breakfast', ...)` + `pickForSlot` for the fruit. Only touches `slot IN ('breakfast', 'fruit') AND role = 'breakfast'` rows.
- **New `scope: 'week-desserts'`**: computes a *new* batch (`pickDessertBatch`, still honoring locked-cell `mustInclude`), persists it (delete+insert `dessert_week_items`), then calls `pickDessertForDay` once per non-locked day in date order (building up its own `runPicks` as it goes, exactly like the main generation loop does) and replaces those `desert`-slot rows only. Dessert-fruit and everything else is untouched.
- **Single-cell dessert reroll**: alternatives/reroll for one day's dessert cell now draw from the week's *existing* batch (2-3 items), not the full `desert`-slot table.
- **Single-cell fruit reroll/alternatives**: the route's `{plan_date, slot}` lookup becomes `{plan_date, slot, role}` when `slot === 'fruit'` (required in that case, ignored otherwise) — both `PlanClient`'s two new fruit `SmallDishCard`s pass their own `role` when calling reroll/alternatives.

### `validateWeek`

- New: dessert-type-cap check — more than `DESSERT_WEEK_CAP` distinct
  dessert `dish_id`s used (non-skipped) across the week is a violation.
- The old single "evening fruit present every day" check splits into two,
  keyed by `role`: breakfast-fruit presence and dessert-fruit presence.

## UI (`components/meals/PlanClient.tsx`)

- New `SmallDishCard` component: fixed-width image-left thumbnail
  (`DishImage`, square-ish, small), label-right (dish name, tiny qty line),
  same lock/reroll/recipe-link affordances as `SupportChip` today, sized
  for a compact row rather than the video-aspect hero. Replaces
  `BreakfastStrip` and `FruitLine`.
- Day card, top to bottom: breakfast pair (2 `SmallDishCard`s: dish, fruit)
  → dinner hero + supports (unchanged) → dessert area (1-2
  `SmallDishCard`s: dessert item, dessert-fruit when present) → day tally
  (unchanged — it already sums `fruit_portions` across every visible row,
  so it picks up both new fruit rows automatically) → mark-cooked/edit
  (unchanged).
- Two new buttons, next to "Build shopping list"/"Generate Week": "🎲
  Randomize breakfast" (→ `scope: 'week-breakfasts'`) and "🎲 Randomize
  desserts" (→ `scope: 'week-desserts'`).

## `components/meals/DishesClient.tsx`

Small addition: a `fruit_context` select (blank / `breakfast` / `dessert`
/ `any`), shown only when editing a `slot === 'fruit'` dish, so future
fruit dishes can be tagged without a manual DB edit.

## Images

Search Pexels/Unsplash/Pixabay for direct, permanent CDN image URLs for
the 13 dishes currently missing one: the 9 breakfast dishes (Bubur ayam,
Lontong, Mie balap, Mie pangsit, Nasi lemak, Roti + selai kacang, Roti +
telur + keju, Telur ceplok/dadar, Telur rebus) and the 4 original
fruit-slot dishes (Jeruk (sore), Pepaya (sore), Pisang (sore), Semangka
(sore)). The 6 re-slotted dishes keep their existing images.

## Testing

- `lib/meals/dessert.test.ts` (new) — `pickDessertBatch`: respects `cap`,
  always includes `mustInclude` ids, falls back gracefully when the pool
  is smaller than `cap`.
- `lib/meals/engine.test.ts` — new cases for `fruitPoolFor` (context
  filtering, `null`/`'any'` treated as universally eligible),
  `pickDessertForDay` (short-window repeat-avoidance, relaxes to allow a
  repeat when the whole batch was used recently, empty-batch → skipped),
  and `composeDay`/`generateWeek` producing both fruit rows with correct
  `role`s and never exceeding the dessert cap across a generated week.
- `lib/meals/overview.test.ts` — no functional change expected (the fruit
  tally already sums all `slot === 'fruit' || slot === 'desert'` rows
  regardless of `role`), but add a case confirming a day with both a
  breakfast-fruit and a dessert-fruit row sums both into the tally.

## Files touched

**New:** `lib/meals/dessert.ts` (+ test).

**Modified:** `lib/meals/types.ts`, `lib/meals/engine.ts` (+ test),
`app/api/meals/generate/route.ts`, `app/api/meals/reroll/route.ts`,
`components/meals/PlanClient.tsx`, `components/meals/DishesClient.tsx`,
`lib/meals/overview.ts` (comment only, + one test case), `dishes` table
(migration), `dessert_week_items` (migration).
