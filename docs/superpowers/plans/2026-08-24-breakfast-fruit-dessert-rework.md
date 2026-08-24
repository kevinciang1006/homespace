# Breakfast/Fruit/Dessert Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the independent "desert" + "evening fruit" day-card lines with a breakfast dish+fruit pair and a dessert item+fruit pair, where the dessert item comes from a small weekly batch (max 3 types) instead of a fresh pick every day. Add dedicated randomize buttons, seed missing images, and restyle both pairings as small image-left cards.

**Architecture:** A week-level pre-pass (`pickDessertBatch`) chooses the week's 2-3 dessert dishes before the per-day compose loop runs; a per-day picker (`pickDessertForDay`) reuses the engine's existing weighted-pick machinery with a short repeat-avoidance window to spread the batch across days — no separate distribution algorithm needed. Two same-slot (`fruit`) rows per day are disambiguated by `role`, which also requires fixing every other `(date, slot)`-keyed lookup that assumed one row per slot (`meal_plans` locks, `cook_log`, single-cell reroll).

**Tech Stack:** Next.js App Router, Supabase, vitest (existing `lib/meals/engine.test.ts` conventions), Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-24-breakfast-fruit-dessert-rework-design.md`

## Global Constraints

- Dinner's main/support/kuah rules, difficulty/spicy/fried caps, and their
  reroll paths are unchanged.
- The dessert weekly cap is a code constant (`DESSERT_WEEK_CAP = 3`), not a
  settings-table option, per the approved design.
- Two `slot: 'fruit'` `meal_plans` rows now exist per day
  (`role: 'breakfast'` and `role: 'optional'`) — every place that used to
  assume one row per `(date, slot)` for the fruit slot must disambiguate by
  `role` too. This plan traces that through `meal_plans` locking,
  `cook_log`, and single-cell reroll/alternatives — don't skip those tasks.
- `lib/meals/*.test.ts` is covered by `vitest.config.ts`'s
  `lib/**/*.test.ts` glob and must keep passing throughout. Route/component
  files are verified manually (curl + DB reads + typecheck + a real
  Generate Week run), matching this repo's existing convention.

---

### Task 1: Migration — re-slot fruits, dessert batch constraint, cook_log role column

**Files:**
- Create: `migrations/2026-08-24-breakfast-fruit-dessert.sql`

**Interfaces:**
- Produces: `dishes` — 6 rows moved from `slot='desert'` to `slot='fruit'`. `dessert_week_items` — `unique(week_start, dish_id)`. `cook_log` — new `role text` column, unique constraint moved from `(cook_date, slot)` to `(cook_date, slot, role)`.

- [ ] **Step 1: Write and apply the migration**

```sql
-- The 6 desert-slot rows that are actually plain fruits move to the fruit
-- slot, joining the shared fruit pool used for both breakfast pairing and
-- dessert pairing. They keep their existing images.
update dishes set slot = 'fruit' where slot = 'desert' and fruit_context = 'any';

-- Prevent duplicate batch entries on a regenerate.
alter table dessert_week_items add constraint dessert_week_items_week_dish_key unique (week_start, dish_id);

-- cook_log currently uniques on (cook_date, slot), which breaks once a day
-- can hold two slot='fruit' rows (breakfast-fruit, dessert-fruit). Add role
-- and re-key the constraint to (cook_date, slot, role). Table is empty
-- today, so no backfill is needed.
alter table cook_log add column if not exists role text;
alter table cook_log drop constraint if exists cook_log_cook_date_slot_key;
alter table cook_log add constraint cook_log_cook_date_slot_role_key unique (cook_date, slot, role);
```

Apply via the Supabase MCP `apply_migration` tool, `project_id: eelcqdkkefhvoloiikka`, `name: breakfast_fruit_dessert`.

(If `cook_log`'s existing unique constraint has a different auto-generated
name than `cook_log_cook_date_slot_key`, find it first —
`select conname from pg_constraint where conrelid = 'cook_log'::regclass and contype = 'u';`
— and substitute the real name in the `drop constraint` line.)

- [ ] **Step 2: Verify**

```sql
select slot, count(*) from dishes where slot in ('desert','fruit') group by slot;
```
Expected: `desert` = 5, `fruit` = 10.

```sql
select conname from pg_constraint where conname in ('dessert_week_items_week_dish_key', 'cook_log_cook_date_slot_role_key');
```
Expected: both rows returned.

- [ ] **Step 3: Commit**

```bash
git add migrations/2026-08-24-breakfast-fruit-dessert.sql
git commit -m "feat(meals): re-slot fruit-mislabeled desserts, add dessert-batch + cook_log role constraints

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Types — `fruit_context`, `DessertWeekItem`

**Files:**
- Modify: `lib/meals/types.ts`

**Interfaces:**
- Produces: `Dish.fruit_context: string | null`; `MealPlan['dishes'].fruit_context?: string | null`; `DessertWeekItem` type.

- [ ] **Step 1: Extend `Dish`**

Change:
```ts
  qty_amount: number | null
  qty_unit: string | null
  qty_note: string | null
  veg_portions: number
  fruit_portions: number
}
```
to:
```ts
  qty_amount: number | null
  qty_unit: string | null
  qty_note: string | null
  veg_portions: number
  fruit_portions: number
  fruit_context: string | null
}
```

- [ ] **Step 2: Extend `MealPlan['dishes']`**

Change:
```ts
    needs_thaw?: boolean; needs_marinate?: boolean; prep_lead_days?: number | null; prep_note?: string | null
    bumbu_packet?: string | null
  } | null
```
to:
```ts
    needs_thaw?: boolean; needs_marinate?: boolean; prep_lead_days?: number | null; prep_note?: string | null
    bumbu_packet?: string | null; fruit_context?: string | null
  } | null
```

- [ ] **Step 3: Add `DessertWeekItem`**

Append after `MealShoppingItem`:
```ts
export type DessertWeekItem = {
  id: string
  week_start: string
  dish_id: string
  dish_name: string
  kind: string
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (all additions are new/optional fields; every existing `dishes.select('*')` call already returns `fruit_context` from the DB even though nothing consumed it before).

- [ ] **Step 5: Commit**

```bash
git add lib/meals/types.ts
git commit -m "feat(meals): add fruit_context and DessertWeekItem types

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Engine — `fruitPoolFor`, role-aware lock keys, breakfast-fruit pick

**Files:**
- Modify: `lib/meals/engine.ts`
- Modify: `lib/meals/engine.test.ts`

**Interfaces:**
- Produces: `fruitPoolFor(context: 'breakfast' | 'dessert', fruitDishes: Dish[]): Dish[]`. `composeDay` now pushes a second row for the breakfast pairing (`slot: 'fruit', role: 'breakfast'`), and its `lockedByCell`/`isLocked`/`lockedDish` helpers key the fruit slot by `${date}|${slot}|${role}` instead of `${date}|${slot}`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/meals/engine.test.ts`:

```ts
describe('fruitPoolFor', () => {
  it('includes a dish with fruit_context "any" for either context', () => {
    const any1 = dish({ id: 'a', slot: 'fruit', fruit_context: 'any' })
    expect(fruitPoolFor('breakfast', [any1]).map(d => d.id)).toEqual(['a'])
    expect(fruitPoolFor('dessert', [any1]).map(d => d.id)).toEqual(['a'])
  })
  it('includes a dish with no context set for either context', () => {
    const noCtx = dish({ id: 'n', slot: 'fruit', fruit_context: null })
    expect(fruitPoolFor('breakfast', [noCtx]).map(d => d.id)).toEqual(['n'])
    expect(fruitPoolFor('dessert', [noCtx]).map(d => d.id)).toEqual(['n'])
  })
  it('excludes a context-specific dish from the other context', () => {
    const bfOnly = dish({ id: 'b', slot: 'fruit', fruit_context: 'breakfast' })
    expect(fruitPoolFor('breakfast', [bfOnly]).map(d => d.id)).toEqual(['b'])
    expect(fruitPoolFor('dessert', [bfOnly])).toEqual([])
  })
  it('excludes garnish and inactive dishes', () => {
    const garnish = dish({ id: 'g', slot: 'fruit', fruit_context: 'any', is_garnish: true })
    const inactive = dish({ id: 'i', slot: 'fruit', fruit_context: 'any', active: false })
    expect(fruitPoolFor('breakfast', [garnish, inactive])).toEqual([])
  })
})
```

Also add `fruit_context: null` to the `dish()` test helper's defaults (near the top of the file):

Change:
```ts
    richness: 'medium', provides_soup: false,
    saltiness: 'normal', difficulty: 'medium', is_garnish: false, ...over,
  } as Dish
```
to:
```ts
    richness: 'medium', provides_soup: false,
    saltiness: 'normal', difficulty: 'medium', is_garnish: false, fruit_context: null, ...over,
  } as Dish
```

Then update the existing `composeDay (breakfast + evening fruit)` describe block — rename it to reflect the new pairing and assert the breakfast-fruit row's `role`:

Change:
```ts
  it('adds one breakfast and one evening fruit row alongside the dinner plate', () => {
    const created = run(withBreakfastAndFruit())
    expect(created.filter(x => x.slot === 'breakfast').length).toBe(1)
    expect(created.find(x => x.slot === 'breakfast')!.dish_id).toBeTruthy()
    expect(created.filter(x => x.slot === 'fruit').length).toBe(1)
    expect(created.find(x => x.slot === 'fruit')!.dish_id).toBeTruthy()
  })
```
to:
```ts
  it('adds a breakfast dish and a breakfast-fruit pairing alongside the dinner plate', () => {
    const created = run(withBreakfastAndFruit())
    expect(created.filter(x => x.slot === 'breakfast').length).toBe(1)
    expect(created.find(x => x.slot === 'breakfast')!.dish_id).toBeTruthy()
    const bfFruit = created.find(x => x.slot === 'fruit' && x.role === 'breakfast')
    expect(bfFruit?.dish_id).toBeTruthy()
  })
```

And update the lock test to use role-qualified keys:

Change:
```ts
  it('honors a locked breakfast and locked fruit cell (does not overwrite them)', () => {
    const p = withBreakfastAndFruit()
    const lockedByCell = new Map<string, MealPlan>([
      ['2026-08-10|breakfast', { plan_date: '2026-08-10', slot: 'breakfast', dish_id: 'bf-e1' } as MealPlan],
      ['2026-08-10|fruit', { plan_date: '2026-08-10', slot: 'fruit', dish_id: 'fr-1' } as MealPlan],
    ])
    const created = run(p, new Set(), lockedByCell)
    expect(created.some(x => x.slot === 'breakfast')).toBe(false)
    expect(created.some(x => x.slot === 'fruit')).toBe(false)
  })
```
to:
```ts
  it('honors a locked breakfast and locked breakfast-fruit cell (does not overwrite them)', () => {
    const p = withBreakfastAndFruit()
    const lockedByCell = new Map<string, MealPlan>([
      ['2026-08-10|breakfast|breakfast', { plan_date: '2026-08-10', slot: 'breakfast', role: 'breakfast', dish_id: 'bf-e1' } as MealPlan],
      ['2026-08-10|fruit|breakfast', { plan_date: '2026-08-10', slot: 'fruit', role: 'breakfast', dish_id: 'fr-1' } as MealPlan],
    ])
    const created = run(p, new Set(), lockedByCell)
    expect(created.some(x => x.slot === 'breakfast')).toBe(false)
    expect(created.some(x => x.slot === 'fruit' && x.role === 'breakfast')).toBe(false)
  })
```

(The existing `'an empty breakfast/fruit pool produces a null-dish row rather than throwing'` test needs its second assertion scoped to the breakfast-fruit row specifically — change
`expect(created.find(x => x.slot === 'fruit')!.dish_id).toBeNull()` to
`expect(created.find(x => x.slot === 'fruit' && x.role === 'breakfast')!.dish_id).toBeNull()`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/meals/engine.test.ts`
Expected: FAIL — `fruitPoolFor` doesn't exist yet, and the breakfast-fruit-role assertions don't match current output.

- [ ] **Step 3: Add `fruitPoolFor`**

Add near `pickBreakfast` (after the `breakfastCandidates` function):

```ts
// A dish with no context set is eligible everywhere (permissive default —
// matches today's data, where every fruit-slot dish is fruit_context='any').
export function fruitPoolFor(context: 'breakfast' | 'dessert', fruitDishes: Dish[]): Dish[] {
  return fruitDishes.filter(d =>
    d.active && !d.is_garnish && (d.fruit_context == null || d.fruit_context === 'any' || d.fruit_context === context))
}
```

- [ ] **Step 4: Make the lock keys role-aware and add the breakfast-fruit pick**

In `composeDay`, change:
```ts
  const push = (p: Pick) => { runPicks.push(p); created.push(p) }
  const isLocked = (slot: Slot) => lockedByCell.has(`${date}|${slot}`)
  const lockedDish = (slot: Slot): Dish | undefined => {
    const lc = lockedByCell.get(`${date}|${slot}`)
    return lc?.dish_id ? dishById.get(lc.dish_id) : undefined
  }

  // 0. BREAKFAST — independent of dinner's rules; own treat quota.
  if (!isLocked('breakfast')) {
    push(pickBreakfast(dishesBySlot.breakfast ?? [], mkCtx('breakfast', 'breakfast', 0), breakfastSpecialDays.has(date), rng))
  }
```
to:
```ts
  const push = (p: Pick) => { runPicks.push(p); created.push(p) }
  // Every slot has exactly one row per day EXCEPT 'fruit', which now holds two
  // (breakfast pairing, dessert pairing) disambiguated by role — so the fruit
  // slot's lock key includes role; every other slot's key is unchanged.
  const cellKey = (slot: Slot, role: Role) => slot === 'fruit' ? `${date}|${slot}|${role}` : `${date}|${slot}`
  const isLocked = (slot: Slot, role: Role = 'support') => lockedByCell.has(cellKey(slot, role))
  const lockedDish = (slot: Slot, role: Role = 'support'): Dish | undefined => {
    const lc = lockedByCell.get(cellKey(slot, role))
    return lc?.dish_id ? dishById.get(lc.dish_id) : undefined
  }

  // 0. BREAKFAST — independent of dinner's rules; own treat quota. Its fruit
  // pairing is a second, independent pick from the shared fruit pool.
  if (!isLocked('breakfast')) {
    push(pickBreakfast(dishesBySlot.breakfast ?? [], mkCtx('breakfast', 'breakfast', 0), breakfastSpecialDays.has(date), rng))
  }
  if (!isLocked('fruit', 'breakfast')) {
    push(pickForSlot(fruitPoolFor('breakfast', dishesBySlot.fruit ?? []), mkCtx('fruit', 'breakfast', 0), rng))
  }
```

`isLocked`/`lockedDish` are called elsewhere in `composeDay` (main, sayuran,
kuah, desert, fruit) with just one argument — since `role` defaults to
`'support'` and only matters for `slot === 'fruit'`, those call sites are
unaffected *except* the existing evening-fruit step, which must now pass
`'optional'` explicitly:

Change:
```ts
  // 5. FRUIT (evening) — neutral on every cross-slot axis (protein none, never
  // spicy/fried, saltiness normal, tier always everyday), so the generic
  // dinner picker already does the right thing here with zero new rule code.
  if (!isLocked('fruit')) {
    push(pickForSlot(dishesBySlot.fruit ?? [], mkCtx('fruit', 'optional', 0), rng))
  }
```
to:
```ts
  // 5. DESSERT-FRUIT pairing — same neutral-on-every-axis reasoning as
  // before, now context-filtered and paired with the dessert card in the UI.
  if (!isLocked('fruit', 'optional')) {
    push(pickForSlot(fruitPoolFor('dessert', dishesBySlot.fruit ?? []), mkCtx('fruit', 'optional', 0), rng))
  }
```

Finally, update `generateWeek`'s `lockedByCell` construction to use the
same role-aware key. Change:
```ts
  const lockedByCell = new Map(lockedCells.map(l => [`${l.plan_date}|${l.slot}`, l]))
```
to:
```ts
  const lockedByCell = new Map(lockedCells.map(l =>
    [l.slot === 'fruit' ? `${l.plan_date}|${l.slot}|${l.role}` : `${l.plan_date}|${l.slot}`, l]))
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/meals/engine.test.ts`
Expected: PASS (all cases, including the updated breakfast/fruit ones — the desert-step tests are untouched by this task and should still pass since `dishesBySlot.desert ?? []` isn't referenced yet by this step's diff).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 7: Commit**

```bash
git add lib/meals/engine.ts lib/meals/engine.test.ts
git commit -m "feat(meals): add breakfast-fruit pairing, role-aware fruit-slot locks

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `lib/meals/dessert.ts` — weekly batch selection

**Files:**
- Create: `lib/meals/dessert.ts`
- Test: `lib/meals/dessert.test.ts`

**Interfaces:**
- Consumes: `Dish`, `Rng` types.
- Produces: `DESSERT_WEEK_CAP`, `pickDessertBatch(pool: Dish[], mustInclude: string[], cap: number, rng: Rng): Dish[]`. Consumed by Task 6 (`generateWeek`) and the reroll route's `week-desserts` scope (Task 10).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import type { Dish } from './types'
import { pickDessertBatch } from './dessert'

function dish(over: Partial<Dish> & { id: string }): Dish {
  return {
    name: over.id, slot: 'desert', protein: 'none', tier: 'everyday', method: null,
    spicy: false, rating: 3, active: true, no_repeat_days: null,
    ingredients: null, recipe_steps: null, recipe_image_url: null,
    richness: 'medium', provides_soup: false, saltiness: 'normal', difficulty: 'medium',
    is_garnish: false, recipe_links: null, qty_amount: null, qty_unit: null, qty_note: null,
    veg_portions: 0, fruit_portions: 0, fruit_context: null, ...over,
  } as Dish
}
const seq = (vals: number[]) => { let i = 0; return () => vals[i++ % vals.length] }

describe('pickDessertBatch', () => {
  it('picks exactly `cap` dishes when the pool is larger', () => {
    const pool = [dish({ id: 'a' }), dish({ id: 'b' }), dish({ id: 'c' }), dish({ id: 'd' })]
    const batch = pickDessertBatch(pool, [], 3, seq([0.1, 0.5, 0.9]))
    expect(batch.length).toBe(3)
    expect(new Set(batch.map(d => d.id)).size).toBe(3) // no duplicates
  })
  it('returns the whole pool when it is smaller than the cap', () => {
    const pool = [dish({ id: 'a' }), dish({ id: 'b' })]
    const batch = pickDessertBatch(pool, [], 3, seq([0.5]))
    expect(batch.map(d => d.id).sort()).toEqual(['a', 'b'])
  })
  it('always keeps mustInclude ids, filling the rest of the cap from the pool', () => {
    const pool = [dish({ id: 'a' }), dish({ id: 'b' }), dish({ id: 'c' }), dish({ id: 'd' })]
    const batch = pickDessertBatch(pool, ['d'], 2, seq([0.1]))
    expect(batch.map(d => d.id)).toContain('d')
    expect(batch.length).toBe(2)
  })
  it('excludes inactive and garnish dishes', () => {
    const pool = [dish({ id: 'a', active: false }), dish({ id: 'b', is_garnish: true }), dish({ id: 'c' })]
    const batch = pickDessertBatch(pool, [], 3, seq([0.5]))
    expect(batch.map(d => d.id)).toEqual(['c'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/meals/dessert.test.ts`
Expected: FAIL — `Cannot find module './dessert'`.

- [ ] **Step 3: Write the implementation**

```ts
import type { Dish, Rng } from './types'

export const DESSERT_WEEK_CAP = 3

// Weighted (rating^2, no replacement) pick of up to `cap` dessert dishes for
// the week's batch. `mustInclude` (dish_ids from any locked desert-slot
// day-cells) are always kept first, so regenerating the batch never orphans
// a dish an existing lock depends on.
export function pickDessertBatch(pool: Dish[], mustInclude: string[], cap: number, rng: Rng): Dish[] {
  const eligible = pool.filter(d => d.active && !d.is_garnish)
  const byId = new Map(eligible.map(d => [d.id, d]))
  const batch: Dish[] = []
  for (const id of mustInclude) {
    const d = byId.get(id)
    if (d && !batch.includes(d)) batch.push(d)
  }
  const remainingPool = eligible.filter(d => !batch.includes(d))
  const weights = remainingPool.map(d => d.rating * d.rating)
  const picked = new Set<number>()
  while (batch.length < cap && picked.size < remainingPool.length) {
    const total = remainingPool.reduce((sum, d, i) => picked.has(i) ? sum : sum + weights[i], 0)
    if (total <= 0) break
    let r = rng() * total
    let chosenIdx = -1
    for (let i = 0; i < remainingPool.length; i++) {
      if (picked.has(i)) continue
      r -= weights[i]
      if (r < 0) { chosenIdx = i; break }
    }
    if (chosenIdx === -1) chosenIdx = remainingPool.findIndex((_, i) => !picked.has(i))
    picked.add(chosenIdx)
    batch.push(remainingPool[chosenIdx])
  }
  return batch
}
```

Note: `Rng` is currently only exported from `lib/meals/engine.ts`, not
`lib/meals/types.ts` — either move its declaration (`export type Rng = () => number`)
to `types.ts` and have `engine.ts` re-export it for backward compatibility,
or simply redeclare the same one-line type locally in `dessert.ts` and skip
the `types.ts` import for it. Prefer the local redeclaration — it's a
one-liner and avoids touching `engine.ts`'s public API:

```ts
import type { Dish } from './types'

type Rng = () => number

export const DESSERT_WEEK_CAP = 3
// ... (rest unchanged, using this local Rng)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/meals/dessert.test.ts`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add lib/meals/dessert.ts lib/meals/dessert.test.ts
git commit -m "feat(meals): add weekly dessert-batch selection

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Engine — `pickDessertForDay`, dessert step now batch-driven

**Files:**
- Modify: `lib/meals/engine.ts`
- Modify: `lib/meals/engine.test.ts`

**Interfaces:**
- Consumes: nothing new (uses existing `weightedPick`, `daysBetween`, `Pick`/`Dish`/`PickContext` types already in `engine.ts`).
- Produces: `pickDessertForDay(batch: Dish[], ctx: PickContext, rng: Rng): Pick`. `composeDay` gains a `dessertBatch: Dish[]` input.

- [ ] **Step 1: Write the failing tests**

Append to `lib/meals/engine.test.ts`:

```ts
describe('pickDessertForDay', () => {
  it('returns a skipped null pick when the batch is empty', () => {
    const c = ctx({ date: '2026-08-13', slot: 'desert', dishes: [] })
    const p = pickDessertForDay([], c, seq([0.5]))
    expect(p.dish_id).toBeNull()
    expect(p.skipped).toBe(true)
  })
  it('avoids a batch item used within the short repeat window', () => {
    const a = dish({ id: 'a', slot: 'desert' })
    const b = dish({ id: 'b', slot: 'desert' })
    const c = ctx({ date: '2026-08-13', slot: 'desert', dishes: [a, b],
      runPicks: [pick({ plan_date: '2026-08-12', slot: 'desert', dish_id: 'a' })] })
    const p = pickDessertForDay([a, b], c, seq([0.5]))
    expect(p.dish_id).toBe('b')
  })
  it('relaxes to allow a repeat when every batch item was used recently', () => {
    const a = dish({ id: 'a', slot: 'desert' })
    const c = ctx({ date: '2026-08-13', slot: 'desert', dishes: [a],
      runPicks: [pick({ plan_date: '2026-08-12', slot: 'desert', dish_id: 'a' })] })
    const p = pickDessertForDay([a], c, seq([0.5]))
    expect(p.dish_id).toBe('a')
  })
  it('checks priorPlans across the week boundary too', () => {
    const a = dish({ id: 'a', slot: 'desert' })
    const b = dish({ id: 'b', slot: 'desert' })
    const c = ctx({ date: '2026-08-13', slot: 'desert', dishes: [a, b],
      priorPlans: [plan({ plan_date: '2026-08-12', slot: 'desert', dish_id: 'a' })] })
    const p = pickDessertForDay([a, b], c, seq([0.5]))
    expect(p.dish_id).toBe('b')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/meals/engine.test.ts`
Expected: FAIL — `pickDessertForDay` is not a function.

- [ ] **Step 3: Add `pickDessertForDay` and wire it into `composeDay`**

Add after `pickBreakfast`:

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
  const usedRecently = (d: Dish) =>
    [...ctx.priorPlans, ...ctx.runPicks]
      .filter(p => p.dish_id === d.id && p.slot === 'desert')
      .some(u => Math.abs(daysBetween(u.plan_date, ctx.date)) < DESSERT_NO_REPEAT_DAYS)
  const fresh = batch.filter(d => !usedRecently(d))
  const pool = fresh.length > 0 ? fresh : batch // relax: repeat rather than leave the day empty
  return toPick(ctx, weightedPick(pool, ctx, rng)!)
}
```

In `composeDay`, replace the old desert step:
```ts
  // 4. DESERT — optional
  if (!isLocked('desert')) {
    push(pickForSlot(dishesBySlot.desert ?? [], mkCtx('desert', 'optional', 0), rng))
  }
```
with:
```ts
  // 4. DESSERT — one pick from the week's pre-chosen batch (see generateWeek).
  if (!isLocked('desert')) {
    push(pickDessertForDay(dessertBatch, mkCtx('desert', 'optional', 0), rng))
  }
```

`composeDay`'s input type gains `dessertBatch: Dish[]` (add it to the
destructured input signature alongside `breakfastSpecialDays`):
```ts
export function composeDay(input: {
  date: string
  dishesBySlot: Record<Slot, Dish[]>
  dishById: Map<string, Dish>
  priorPlans: MealPlan[]
  runPicks: Pick[]
  lockedByCell: Map<string, MealPlan>
  specialDays: Set<string>
  hardDays: Set<string>
  breakfastSpecialDays: Set<string>
  dessertBatch: Dish[]
  rng: Rng
}): Pick[] {
  const { date, dishesBySlot, dishById, priorPlans, runPicks, lockedByCell, specialDays, hardDays, breakfastSpecialDays, dessertBatch, rng } = input
```

- [ ] **Step 4: Fix now-broken call sites in `engine.test.ts`**

Every existing `composeDay({...})` call in the test file needs a
`dessertBatch` entry. Since the shared `pools()` helper already builds
`desert: mk('desert', 8)`, pass that same array through as the batch in
each call — add `dessertBatch: dishesBySlot.desert` (or `p.desert`,
matching whichever local variable name that test uses) to every
`composeDay({...})` call's argument object. There are 5 such call sites in
the file (the `composeDay (3-component plate)` describe block's 4 tests
via its shared `run` helper, plus the inline call in `'LOCKED
provides-soup main...'`, plus the `composeDay (breakfast + evening fruit)`
block's `run` helper and its inline `'picks a special breakfast...'`
call). Update each.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/meals/engine.test.ts`
Expected: PASS (all cases, including Task 3's).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 7: Commit**

```bash
git add lib/meals/engine.ts lib/meals/engine.test.ts
git commit -m "feat(meals): dessert day-pick draws from the week's batch

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Engine — `generateWeek` computes and threads the dessert batch

**Files:**
- Modify: `lib/meals/engine.ts`
- Modify: `lib/meals/engine.test.ts`

**Interfaces:**
- Consumes: `pickDessertBatch`, `DESSERT_WEEK_CAP` from `./dessert`.
- Produces: `generateWeek`'s output never places more than `DESSERT_WEEK_CAP` distinct dessert dish_ids across a generated week.

- [ ] **Step 1: Write the failing test**

Append to `lib/meals/engine.test.ts` (near the other `generateWeek` describe blocks):

```ts
describe('generateWeek (dessert batch)', () => {
  it('never uses more than DESSERT_WEEK_CAP distinct dessert dishes across the week', () => {
    const dishesBySlot = pools() // desert: mk('desert', 8) — 8 candidates, cap should still bind to 3
    const picks = generateWeek({ weekStart: '2026-08-10', days: WEEK, dishesBySlot,
      allDishes: Object.values(dishesBySlot).flat(), priorPlans: [], lockedCells: [],
      rng: seq([0.3,0.6,0.1,0.8,0.5,0.2,0.9,0.4,0.7,0.05]) })
    const dessertIds = new Set(picks.filter(p => p.slot === 'desert' && p.dish_id).map(p => p.dish_id))
    expect(dessertIds.size).toBeLessThanOrEqual(3)
  })
  it('keeps a locked dessert dish in the batch so other days can still show it', () => {
    const dishesBySlot = pools()
    const lockedDish = dishesBySlot.desert[5] // pick one not among the first weighted picks typically
    const locked = [{ id: 'L', plan_date: '2026-08-12', slot: 'desert' as Slot, dish_id: lockedDish.id,
      dish_name: lockedDish.name, locked: true, role: 'optional' as Role, skipped: false }]
    const picks = generateWeek({ weekStart: '2026-08-10', days: WEEK, dishesBySlot,
      allDishes: Object.values(dishesBySlot).flat(), priorPlans: [], lockedCells: locked,
      rng: seq([0.3,0.6,0.1,0.8,0.5,0.2,0.9,0.4,0.7,0.05]) })
    const lockedCell = picks.find(p => p.plan_date === '2026-08-12' && p.slot === 'desert')!
    expect(lockedCell.dish_id).toBe(lockedDish.id)
    expect(lockedCell.locked).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/meals/engine.test.ts`
Expected: FAIL — `generateWeek` doesn't yet compute/pass a `dessertBatch`, so `composeDay` receives `undefined` and `pickDessertForDay` throws on `batch.length`.

- [ ] **Step 3: Wire the batch pre-pass into `generateWeek`**

Add the import at the top of `engine.ts`:
```ts
import { pickDessertBatch, DESSERT_WEEK_CAP } from './dessert'
```

In `generateWeek`, change:
```ts
export function generateWeek(input: {
  weekStart: string; days: string[]; dishesBySlot: Record<Slot, Dish[]>
  allDishes: Dish[]; priorPlans: MealPlan[]; lockedCells: MealPlan[]; rng: Rng
}): Pick[] {
  const { days, dishesBySlot, allDishes, priorPlans, lockedCells, rng } = input
  const dishById = new Map(allDishes.map(d => [d.id, d]))
  const specialDays = preassignSpecialDays(days, lockedCells, dishById, rng)
  const hardDays = preassignHardDays(days, specialDays, rng)
  const breakfastSpecialDays = preassignBreakfastSpecialDays(days, lockedCells, dishById, rng)
  const lockedByCell = new Map(lockedCells.map(l =>
    [l.slot === 'fruit' ? `${l.plan_date}|${l.slot}|${l.role}` : `${l.plan_date}|${l.slot}`, l]))
  const runPicks: Pick[] = lockedCells.map(l => ({
    plan_date: l.plan_date, slot: l.slot, dish_id: l.dish_id, dish_name: l.dish_name,
    locked: true, role: l.role ?? 'support', skipped: l.skipped ?? false,
  }))

  for (const date of days) {
    composeDay({ date, dishesBySlot, dishById, priorPlans, runPicks, lockedByCell, specialDays, hardDays, breakfastSpecialDays, rng })
  }
```
to:
```ts
export function generateWeek(input: {
  weekStart: string; days: string[]; dishesBySlot: Record<Slot, Dish[]>
  allDishes: Dish[]; priorPlans: MealPlan[]; lockedCells: MealPlan[]; rng: Rng
}): Pick[] {
  const { days, dishesBySlot, allDishes, priorPlans, lockedCells, rng } = input
  const dishById = new Map(allDishes.map(d => [d.id, d]))
  const specialDays = preassignSpecialDays(days, lockedCells, dishById, rng)
  const hardDays = preassignHardDays(days, specialDays, rng)
  const breakfastSpecialDays = preassignBreakfastSpecialDays(days, lockedCells, dishById, rng)
  const lockedByCell = new Map(lockedCells.map(l =>
    [l.slot === 'fruit' ? `${l.plan_date}|${l.slot}|${l.role}` : `${l.plan_date}|${l.slot}`, l]))
  const runPicks: Pick[] = lockedCells.map(l => ({
    plan_date: l.plan_date, slot: l.slot, dish_id: l.dish_id, dish_name: l.dish_name,
    locked: true, role: l.role ?? 'support', skipped: l.skipped ?? false,
  }))

  const lockedDessertDishIds = lockedCells
    .filter(l => l.slot === 'desert' && l.dish_id)
    .map(l => l.dish_id as string)
  const dessertBatch = pickDessertBatch(dishesBySlot.desert ?? [], lockedDessertDishIds, DESSERT_WEEK_CAP, rng)

  for (const date of days) {
    composeDay({ date, dishesBySlot, dishById, priorPlans, runPicks, lockedByCell, specialDays, hardDays, breakfastSpecialDays, dessertBatch, rng })
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/meals/engine.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add lib/meals/engine.ts lib/meals/engine.test.ts
git commit -m "feat(meals): generateWeek pre-computes the week's dessert batch

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Engine — `validateWeek` dessert cap + split fruit-presence checks

**Files:**
- Modify: `lib/meals/engine.ts`
- Modify: `lib/meals/engine.test.ts`

**Interfaces:**
- Produces: `validateWeek` flags >`DESSERT_WEEK_CAP` distinct dessert dishes/week; splits the old single "evening fruit present" check into breakfast-fruit and dessert-fruit presence, keyed by `role`.

- [ ] **Step 1: Write the failing tests**

Replace the existing `'flags a day with no evening fruit planned'` test in
`lib/meals/engine.test.ts` with two role-specific versions:

```ts
  it('flags a day with no breakfast-fruit planned', () => {
    const byId = new Map<string, Dish>([['fr', dish({ id: 'fr', slot: 'fruit' })]])
    const rows = [
      { plan_date: '2026-08-17', slot: 'fruit' as Slot, role: 'breakfast' as Role, dish_id: 'fr' },
      { plan_date: '2026-08-18', slot: 'fruit' as Slot, role: 'breakfast' as Role, dish_id: null },
    ]
    const report = validateWeek(rows, byId)
    expect(report.some(v => v.includes('2026-08-18') && v.includes('no breakfast fruit'))).toBe(true)
    expect(report.some(v => v.includes('2026-08-17') && v.includes('no breakfast fruit'))).toBe(false)
  })
  it('flags a day with no dessert-fruit planned', () => {
    const byId = new Map<string, Dish>([['fr', dish({ id: 'fr', slot: 'fruit' })]])
    const rows = [
      { plan_date: '2026-08-17', slot: 'fruit' as Slot, role: 'optional' as Role, dish_id: 'fr' },
      { plan_date: '2026-08-18', slot: 'fruit' as Slot, role: 'optional' as Role, dish_id: null },
    ]
    const report = validateWeek(rows, byId)
    expect(report.some(v => v.includes('2026-08-18') && v.includes('no dessert fruit'))).toBe(true)
  })
```

Add a new dessert-cap test in the same file:

```ts
describe('validateWeek (dessert cap)', () => {
  it('flags more than DESSERT_WEEK_CAP distinct dessert dishes in the week', () => {
    const byId = new Map<string, Dish>([
      ['d1', dish({ id: 'd1', slot: 'desert', name: 'Kacang ijo' })],
      ['d2', dish({ id: 'd2', slot: 'desert', name: 'Yogurt' })],
      ['d3', dish({ id: 'd3', slot: 'desert', name: 'Brownie' })],
      ['d4', dish({ id: 'd4', slot: 'desert', name: 'Banana cake' })],
    ])
    const rows = [
      { plan_date: '2026-08-10', slot: 'desert' as Slot, dish_id: 'd1' },
      { plan_date: '2026-08-11', slot: 'desert' as Slot, dish_id: 'd2' },
      { plan_date: '2026-08-12', slot: 'desert' as Slot, dish_id: 'd3' },
      { plan_date: '2026-08-13', slot: 'desert' as Slot, dish_id: 'd4' },
    ]
    const report = validateWeek(rows, byId)
    expect(report.some(v => v.includes('4 dessert types'))).toBe(true)
  })
  it('does not flag exactly DESSERT_WEEK_CAP distinct dessert dishes', () => {
    const byId = new Map<string, Dish>([
      ['d1', dish({ id: 'd1', slot: 'desert' })],
      ['d2', dish({ id: 'd2', slot: 'desert' })],
      ['d3', dish({ id: 'd3', slot: 'desert' })],
    ])
    const rows = [
      { plan_date: '2026-08-10', slot: 'desert' as Slot, dish_id: 'd1' },
      { plan_date: '2026-08-11', slot: 'desert' as Slot, dish_id: 'd2' },
      { plan_date: '2026-08-12', slot: 'desert' as Slot, dish_id: 'd3' },
    ]
    expect(validateWeek(rows, byId).some(v => v.includes('dessert types'))).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/meals/engine.test.ts`
Expected: FAIL — the new role-specific/cap messages don't exist yet.

- [ ] **Step 3: Update `validateWeek`**

`validateWeek`'s row parameter type needs `role` available (it's currently
`{ plan_date: string; slot?: Slot; dish_id: string | null; skipped?: boolean }`).
Change the signature:
```ts
export function validateWeek(
  rows: { plan_date: string; slot?: Slot; dish_id: string | null; skipped?: boolean }[],
  dishById: Map<string, Dish>,
): string[] {
```
to:
```ts
export function validateWeek(
  rows: { plan_date: string; slot?: Slot; role?: Role; dish_id: string | null; skipped?: boolean }[],
  dishById: Map<string, Dish>,
): string[] {
```

Replace the old single fruit-presence block:
```ts
  // --- Evening fruit: present every day; advisory on the ~2-fruit-portions target ---
  const fruitRows = rows.filter(r => r.slot === 'fruit')
  if (fruitRows.length) {
    for (const date of allDates) {
      const planned = fruitRows.some(r => r.plan_date === date && r.dish_id && !r.skipped)
      if (!planned) viol.push(`⚠️ ${date}: no evening fruit planned`)
    }
    const daysReaching2 = allDates.filter(date => {
      const total = rows
        .filter(r => r.plan_date === date && r.dish_id && !r.skipped && (r.slot === 'fruit' || r.slot === 'desert'))
        .reduce((n, r) => n + (dishById.get(r.dish_id!)?.fruit_portions ?? 0), 0)
      return total >= 2
    }).length
    if (daysReaching2 < 5) {
      viol.push(`ℹ️ week: only ${daysReaching2} of ${allDates.length} days reach ~2 fruit portions`)
    }
  }

  return viol
}
```
with:
```ts
  // --- Fruit pairings: present every day for each role; advisory on the ~2-fruit-portions target ---
  const fruitRows = rows.filter(r => r.slot === 'fruit')
  if (fruitRows.length) {
    for (const [role, label] of [['breakfast', 'breakfast fruit'], ['optional', 'dessert fruit']] as const) {
      const roleRows = fruitRows.filter(r => r.role === role)
      if (!roleRows.length) continue
      for (const date of allDates) {
        const planned = roleRows.some(r => r.plan_date === date && r.dish_id && !r.skipped)
        if (!planned) viol.push(`⚠️ ${date}: no ${label} planned`)
      }
    }
    const daysReaching2 = allDates.filter(date => {
      const total = rows
        .filter(r => r.plan_date === date && r.dish_id && !r.skipped && (r.slot === 'fruit' || r.slot === 'desert'))
        .reduce((n, r) => n + (dishById.get(r.dish_id!)?.fruit_portions ?? 0), 0)
      return total >= 2
    }).length
    if (daysReaching2 < 5) {
      viol.push(`ℹ️ week: only ${daysReaching2} of ${allDates.length} days reach ~2 fruit portions`)
    }
  }

  // --- Dessert cap: no more than DESSERT_WEEK_CAP distinct dessert types/week ---
  const dessertIds = new Set(rows.filter(r => r.slot === 'desert' && r.dish_id && !r.skipped).map(r => r.dish_id))
  if (dessertIds.size > DESSERT_WEEK_CAP) {
    viol.push(`⚠️ week: ${dessertIds.size} dessert types used (cap is ${DESSERT_WEEK_CAP})`)
  }

  return viol
}
```

(`DESSERT_WEEK_CAP` is already imported in this file from Task 6.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/meals/engine.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add lib/meals/engine.ts lib/meals/engine.test.ts
git commit -m "feat(meals): validateWeek checks the dessert cap and per-role fruit presence

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Generate route persists the dessert batch

**Files:**
- Modify: `app/api/meals/generate/route.ts`

**Interfaces:**
- Produces: after a successful generate, `dessert_weeks` has a row for `weekStart` and `dessert_week_items` holds that week's batch (delete-then-insert, mirroring the shopping-list generator's non-locked-row replacement pattern).

- [ ] **Step 1: Extract the batch from `generateWeek`'s output and persist it**

The batch itself isn't directly returned by `generateWeek` (only the day
picks are) — recompute which dishes ended up in the `desert` slot across
the week's picks (this is exactly the batch, since `pickDessertForDay`
only ever chooses from it) and persist that set.

Change:
```ts
  const picks = generateWeek({ weekStart, days, dishesBySlot, allDishes, priorPlans, lockedCells, rng })

  const dishById = new Map(allDishes.map(d => [d.id, d]))
  const report = validateWeek(picks, dishById)
```
to:
```ts
  const picks = generateWeek({ weekStart, days, dishesBySlot, allDishes, priorPlans, lockedCells, rng })

  const dishById = new Map(allDishes.map(d => [d.id, d]))
  const report = validateWeek(picks, dishById)

  // Persist the week's realized dessert batch (the distinct dessert dish_ids
  // that actually landed on the week's days) so /settings-free rerolls and
  // the day view can read back "this week's 2-3 dessert types."
  const dessertDishIds = [...new Set(picks.filter(p => p.slot === 'desert' && p.dish_id).map(p => p.dish_id as string))]
  await supabase.from('dessert_weeks').upsert({ week_start: weekStart }, { onConflict: 'week_start' })
  await supabase.from('dessert_week_items').delete().eq('week_start', weekStart)
  if (dessertDishIds.length) {
    await supabase.from('dessert_week_items').insert(dessertDishIds.map(id => ({
      week_start: weekStart, dish_id: id, dish_name: dishById.get(id)?.name ?? 'Dish', kind: 'dessert',
    })))
  }
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Verify against the live database**

Start the dev server, POST a generate for a test week, then check:
```sql
select * from dessert_weeks where week_start = '<the weekStart you used>';
select dish_name from dessert_week_items where week_start = '<the weekStart you used>';
```
Expected: one `dessert_weeks` row, and 1-3 `dessert_week_items` rows whose
names match the `desert`-slot dish names actually showing on that week's
generated days (spot-check a couple of days via `select plan_date, dish_name from meal_plans where plan_date between '<start>' and '<end>' and slot = 'desert';` — every `dish_name` there should be one of the `dessert_week_items` names).

- [ ] **Step 4: Commit**

```bash
git add app/api/meals/generate/route.ts
git commit -m "feat(meals): persist the week's dessert batch on generate

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Reroll route — existing-batch wiring for day/main reroll, `week-breakfasts` scope

**Files:**
- Modify: `app/api/meals/reroll/route.ts`

**Interfaces:**
- Produces: day-reroll and main-reroll (both already call `composeDay`) never invent a new dessert type outside the week's existing batch. New `scope: 'week-breakfasts'` regenerates breakfast dish + breakfast-fruit for every non-locked day.

- [ ] **Step 1: Add a helper to load the week's existing dessert batch**

Add near the top of the file, after `loadWeek`:

```ts
async function loadDessertBatch(weekStart: string, allDishes: Dish[]): Promise<Dish[]> {
  const { data } = await supabase.from('dessert_week_items').select('dish_id').eq('week_start', weekStart)
  const ids = new Set((data ?? []).map(r => r.dish_id as string))
  return allDishes.filter(d => ids.has(d.id))
}
```

- [ ] **Step 2: Pass the existing batch into the day-reroll and main-reroll `composeDay` calls**

In the `scope: 'day'` branch, change:
```ts
    const dishesBySlot = Object.fromEntries(SLOTS.map(s => [s, allDishes.filter(d => d.slot === s)])) as Record<Slot, Dish[]>
    const breakfastSpecialDays = deriveBreakfastSpecialDays(week, plans, dishById)
    const created = composeDay({ date: plan_date, dishesBySlot, dishById, priorPlans, runPicks, lockedByCell, specialDays, hardDays, breakfastSpecialDays, rng })
```
to:
```ts
    const dishesBySlot = Object.fromEntries(SLOTS.map(s => [s, allDishes.filter(d => d.slot === s)])) as Record<Slot, Dish[]>
    const breakfastSpecialDays = deriveBreakfastSpecialDays(week, plans, dishById)
    const dessertBatch = await loadDessertBatch(mondayOf(plan_date), allDishes)
    const created = composeDay({ date: plan_date, dishesBySlot, dishById, priorPlans, runPicks, lockedByCell, specialDays, hardDays, breakfastSpecialDays, dessertBatch, rng })
```

In the `slot === 'utama'` (main reroll) branch, apply the identical change
— same `composeDay({...})` call shape, same fix: add
`const dessertBatch = await loadDessertBatch(mondayOf(plan_date), allDishes)`
before the call and `dessertBatch` into its argument object.

- [ ] **Step 3: Add `scope: 'week-breakfasts'`**

Add this branch right after the existing `if (body.scope === 'day') { ... }`
block (before the `if (!plan_date || !SLOTS.includes(slot))` guard):

```ts
  // ---- Randomize breakfast → re-pick breakfast dish + fruit for every non-locked day ----
  if (body.scope === 'week-breakfasts') {
    const { weekStart } = body
    if (!weekStart) return Response.json({ error: 'weekStart required' }, { status: 400 })
    const week = weekDates(weekStart)
    const { data: dishesRaw } = await supabase.from('dishes').select('*').eq('active', true)
    const allDishes = (dishesRaw ?? []) as Dish[]
    const dishById = new Map(allDishes.map(d => [d.id, d]))
    const start = new Date(week[0]); start.setDate(start.getDate() - 14)
    const historyStart = start.toISOString().split('T')[0]
    const { data: plansRaw } = await supabase.from('meal_plans').select('*')
      .gte('plan_date', historyStart).lte('plan_date', week[6])
    const plans = (plansRaw ?? []) as MealPlan[]
    const weekSet = new Set(week)
    const priorPlans = plans.filter(p => !weekSet.has(p.plan_date))
    const lockedCells = plans.filter(p => weekSet.has(p.plan_date) && p.locked)
    const breakfastSpecialDays = preassignBreakfastSpecialDays(week, lockedCells, dishById, rng)
    const breakfastPool = allDishes.filter(d => d.slot === 'breakfast')
    const fruitPool = allDishes.filter(d => d.slot === 'fruit')

    const runPicks = lockedCells.map(l => ({ plan_date: l.plan_date, slot: l.slot as Slot, dish_id: l.dish_id,
      dish_name: l.dish_name, locked: true, role: (l.role ?? 'support') as Role, skipped: l.skipped ?? false }))
    const toUpsert: { plan_date: string; slot: Slot; dish_id: string | null; dish_name: string | null; role: Role; skipped: boolean }[] = []
    for (const date of week) {
      const lockedBf = lockedCells.some(l => l.plan_date === date && l.slot === 'breakfast')
      const lockedBfFruit = lockedCells.some(l => l.plan_date === date && l.slot === 'fruit' && l.role === 'breakfast')
      const ctxBase = { date, priorPlans, runPicks, dishById, specialDays: new Set<string>(), hardDays: new Set<string>(),
        relax: { spicy: false, fried: false, hardDay: false, hardSpacing: false, proteinClash: false, spicyMainSpacing: false, noRepeatFactor: 1 } }
      if (!lockedBf) {
        const p = pickBreakfast(breakfastPool, { ...ctxBase, slot: 'breakfast', role: 'breakfast', spicyFloor: 1, plannedRemaining: 0 },
          breakfastSpecialDays.has(date), rng)
        runPicks.push(p)
        toUpsert.push({ plan_date: date, slot: 'breakfast', dish_id: p.dish_id, dish_name: p.dish_name, role: 'breakfast', skipped: p.skipped })
      }
      if (!lockedBfFruit) {
        const p = pickForSlot(fruitPoolFor('breakfast', fruitPool), { ...ctxBase, slot: 'fruit', role: 'breakfast', spicyFloor: 1, plannedRemaining: 0 }, rng)
        runPicks.push(p)
        toUpsert.push({ plan_date: date, slot: 'fruit', dish_id: p.dish_id, dish_name: p.dish_name, role: 'breakfast', skipped: p.skipped })
      }
    }
    for (const row of toUpsert) {
      const { error } = await supabase.from('meal_plans')
        .upsert({ ...row, locked: false }, { onConflict: row.slot === 'fruit' ? 'plan_date,slot,role' : 'plan_date,slot' })
      if (error) return Response.json({ error: error.message }, { status: 500 })
    }
    const { data: weekRows } = await supabase.from('meal_plans').select(SELECT).gte('plan_date', week[0]).lte('plan_date', week[6])
    return Response.json({ week: (weekRows ?? []) as MealPlan[] })
  }
```

This needs two new imports at the top of the file:
```ts
import { candidates, composeDay, pickForSlot, pickBreakfast, breakfastCandidates, weightFor, fruitPoolFor, preassignBreakfastSpecialDays, type PickContext } from '@/lib/meals/engine'
```
(adding `fruitPoolFor` and `preassignBreakfastSpecialDays` to the existing
import line from `@/lib/meals/engine`).

Note the `upsert` for a `slot: 'fruit'` row uses `onConflict:
'plan_date,slot,role'` instead of `'plan_date,slot'` — this requires a
unique constraint on `meal_plans(plan_date, slot, role)` where one didn't
exist before (the table currently has no unique constraint on
`meal_plans` at all beyond its primary key, so the existing single-slot
upserts elsewhere in this file, e.g. the breakfast reroll's
`onConflict: 'plan_date,slot'`, must *already* be relying on a
`(plan_date, slot)` unique constraint — confirm it exists via
`select conname from pg_constraint where conrelid = 'meal_plans'::regclass and contype = 'u';`
before writing this task's migration addition below).

- [ ] **Step 3b: Migration — meal_plans unique constraint for the fruit role**

Add to a new migration file `migrations/2026-08-24-meal-plans-fruit-role.sql`:
```sql
-- Existing single-row-per-(plan_date,slot) upserts need a matching unique
-- constraint; confirm the current one's exact name first via:
--   select conname from pg_constraint where conrelid = 'meal_plans'::regclass and contype = 'u';
-- then drop it and replace with a role-aware version so slot='fruit' rows
-- (now two per day: role='breakfast', role='optional') can each be
-- upserted independently. Substitute the real constraint name below.
alter table meal_plans drop constraint if exists meal_plans_plan_date_slot_key;
alter table meal_plans add constraint meal_plans_plan_date_slot_role_key unique (plan_date, slot, role);
```
Apply via the Supabase MCP `apply_migration` tool. **Important:** every
other `onConflict: 'plan_date,slot'` upsert elsewhere in this codebase
(breakfast reroll, single-cell support/optional reroll) must now include
`role` in both the upserted row *and* the `onConflict` target, or those
upserts will fail against the new 3-column constraint — Task 12 (single-cell
reroll) handles the fruit-specific ones; the non-fruit ones (breakfast,
utama, support slots) already always upsert with a stable, single `role`
per slot, so add `,role` to their `onConflict` strings too as part of this
task (grep this file for `onConflict: 'plan_date,slot'` and update every
occurrence to `onConflict: 'plan_date,slot,role'`, and confirm the row
object being upserted always includes `role` — it already does at every
existing call site in this file).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 5: Verify against the live database**

With the dev server running and a synthetic session cookie:
```bash
curl -s -X POST "http://localhost:3000/api/meals/reroll" -H 'Cookie: hs_session={"id":"test","name":"Test"}' \
  -H 'Content-Type: application/json' -d '{"scope":"week-breakfasts","weekStart":"<a Monday you have data for>"}' | jq '.week | length'
```
Expected: a non-empty week array. Then:
```sql
select plan_date, dish_name from meal_plans where plan_date between '<start>' and '<end>' and slot = 'breakfast' order by plan_date;
select plan_date, dish_name from meal_plans where plan_date between '<start>' and '<end>' and slot = 'fruit' and role = 'breakfast' order by plan_date;
```
Expected: one row per day for each, both non-null (assuming pools exist).

- [ ] **Step 6: Commit**

```bash
git add app/api/meals/reroll/route.ts migrations/2026-08-24-meal-plans-fruit-role.sql
git commit -m "feat(meals): reroll respects the existing dessert batch, add week-breakfasts scope

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: Reroll route — `week-desserts` scope, single-cell dessert/fruit reroll

**Files:**
- Modify: `app/api/meals/reroll/route.ts`

**Interfaces:**
- Produces: new `scope: 'week-desserts'` (regenerates the batch + redistributes non-locked `desert` cells only). Single-cell dessert reroll/alternatives draw from the existing batch. Single-cell fruit reroll/alternatives require a `role` to disambiguate which of the day's two fruit rows is being acted on.

- [ ] **Step 1: Add `scope: 'week-desserts'`**

Add right after the `scope: 'week-breakfasts'` block from Task 9:

```ts
  // ---- Randomize desserts → new weekly batch, redistribute non-locked desert days ----
  if (body.scope === 'week-desserts') {
    const { weekStart } = body
    if (!weekStart) return Response.json({ error: 'weekStart required' }, { status: 400 })
    const week = weekDates(weekStart)
    const { data: dishesRaw } = await supabase.from('dishes').select('*').eq('active', true)
    const allDishes = (dishesRaw ?? []) as Dish[]
    const dishById = new Map(allDishes.map(d => [d.id, d]))
    const start = new Date(week[0]); start.setDate(start.getDate() - 14)
    const historyStart = start.toISOString().split('T')[0]
    const { data: plansRaw } = await supabase.from('meal_plans').select('*')
      .gte('plan_date', historyStart).lte('plan_date', week[6])
    const plans = (plansRaw ?? []) as MealPlan[]
    const weekSet = new Set(week)
    const priorPlans = plans.filter(p => !weekSet.has(p.plan_date))
    const lockedCells = plans.filter(p => weekSet.has(p.plan_date) && p.locked)
    const lockedDessertDishIds = lockedCells.filter(l => l.slot === 'desert' && l.dish_id).map(l => l.dish_id as string)
    const dessertPool = allDishes.filter(d => d.slot === 'desert')
    const newBatch = pickDessertBatch(dessertPool, lockedDessertDishIds, DESSERT_WEEK_CAP, rng)

    await supabase.from('dessert_weeks').upsert({ week_start: weekStart }, { onConflict: 'week_start' })
    await supabase.from('dessert_week_items').delete().eq('week_start', weekStart)
    if (newBatch.length) {
      await supabase.from('dessert_week_items').insert(newBatch.map(d => ({
        week_start: weekStart, dish_id: d.id, dish_name: d.name, kind: 'dessert',
      })))
    }

    const runPicks = lockedCells.map(l => ({ plan_date: l.plan_date, slot: l.slot as Slot, dish_id: l.dish_id,
      dish_name: l.dish_name, locked: true, role: (l.role ?? 'support') as Role, skipped: l.skipped ?? false }))
    for (const date of week) {
      if (lockedCells.some(l => l.plan_date === date && l.slot === 'desert')) continue
      const p = pickDessertForDay(newBatch, {
        date, slot: 'desert', priorPlans, runPicks, dishById, specialDays: new Set(), hardDays: new Set(),
        relax: { spicy: false, fried: false, hardDay: false, hardSpacing: false, proteinClash: false, spicyMainSpacing: false, noRepeatFactor: 1 },
        role: 'optional', spicyFloor: 1, plannedRemaining: 0,
      }, rng)
      runPicks.push(p)
      const { error } = await supabase.from('meal_plans')
        .upsert({ plan_date: date, slot: 'desert', dish_id: p.dish_id, dish_name: p.dish_name, role: 'optional', skipped: p.skipped, locked: false },
          { onConflict: 'plan_date,slot,role' })
      if (error) return Response.json({ error: error.message }, { status: 500 })
    }
    const { data: weekRows } = await supabase.from('meal_plans').select(SELECT).gte('plan_date', week[0]).lte('plan_date', week[6])
    return Response.json({ week: (weekRows ?? []) as MealPlan[] })
  }
```

Add the needed imports:
```ts
import { pickDessertBatch, DESSERT_WEEK_CAP } from '@/lib/meals/dessert'
import { pickDessertForDay } from '@/lib/meals/engine'
```
(fold `pickDessertForDay` into the existing `@/lib/meals/engine` import line from Task 9.)

- [ ] **Step 2: Single-cell dessert reroll/alternatives use the existing batch**

The generic single-cell branch at the bottom of `POST` currently does:
```ts
  const poolSlot = poolSlotFor(slot as Slot, plan_date, plans, allDishes)
  const { ctx, slotDishes } = buildSingleContext(plan_date, slot as Slot, allDishes, plans, week, poolSlot)
  const p = pickForSlot(slotDishes, ctx, rng)
```
Add a `slot === 'desert'` special case right before this, replacing the
generic path for that one slot:
```ts
  if (slot === 'desert' && !body.dish_id) {
    const batch = await loadDessertBatch(mondayOf(plan_date), allDishes)
    const { ctx } = buildSingleContext(plan_date, 'desert', allDishes, plans, week, 'desert')
    const p = pickDessertForDay(batch, ctx, rng)
    const { data, error } = await supabase.from('meal_plans')
      .upsert({ plan_date, slot: 'desert', dish_id: p.dish_id, dish_name: p.dish_name, locked: false, role: 'optional', skipped: p.skipped },
        { onConflict: 'plan_date,slot,role' }).select(SELECT).single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ pick: data as MealPlan })
  }
```
And the `GET` (alternatives) handler needs the equivalent: right before its
generic `candidates(slotDishes, ctx)` call, add:
```ts
  if (slot === 'desert') {
    const batch = await loadDessertBatch(mondayOf(plan_date), allDishes)
    return Response.json({ alternatives: batch.map(d => ({ id: d.id, name: d.name })) })
  }
```

- [ ] **Step 3: Single-cell fruit reroll/alternatives require `role`**

`buildSingleContext`'s `role: roleForSlot(poolSlot)` already resolves
`'fruit'` → `'optional'` unconditionally — this is now wrong when the
caller means the breakfast-fruit cell. Change the `POST` single-cell
branch's fruit handling: the client must send `role` for `slot === 'fruit'`
(PlanClient is updated in Task 13 to always do this). Add a guard right
after the existing `if (!plan_date || !SLOTS.includes(slot))` check:
```ts
  const cellRole: Role | undefined = body.role
  if (slot === 'fruit' && !cellRole) {
    return Response.json({ error: 'role required for slot=fruit' }, { status: 400 })
  }
```
Then everywhere this branch looks up or writes the existing row for
`(plan_date, slot)`, add the role filter when it's a fruit cell. Change:
```ts
  const { data: existing } = await supabase
    .from('meal_plans').select('*').eq('plan_date', plan_date).eq('slot', slot).maybeSingle()
```
to:
```ts
  let existingQuery = supabase.from('meal_plans').select('*').eq('plan_date', plan_date).eq('slot', slot)
  if (slot === 'fruit') existingQuery = existingQuery.eq('role', cellRole!)
  const { data: existing } = await existingQuery.maybeSingle()
```
And the final generic upsert (for support/optional/fruit-dessert cells)
change:
```ts
  const { ctx, slotDishes } = buildSingleContext(plan_date, slot as Slot, allDishes, plans, week, poolSlot)
  const p = pickForSlot(slotDishes, ctx, rng)
  const { data, error } = await supabase.from('meal_plans')
    .upsert({ plan_date, slot, dish_id: p.dish_id, dish_name: p.dish_name, locked: false, role: roleForSlot(slot as Slot), skipped: false },
      { onConflict: 'plan_date,slot', **})** .select(SELECT).single()
```
to (using `cellRole` when the slot is `'fruit'`, falling back to
`roleForSlot` otherwise, and switching the conflict target for fruit rows):
```ts
  const { ctx, slotDishes } = buildSingleContext(plan_date, slot as Slot, allDishes, plans, week, poolSlot)
  const pickedFruitPool = slot === 'fruit' ? fruitPoolFor(cellRole === 'breakfast' ? 'breakfast' : 'dessert', slotDishes) : slotDishes
  const p = pickForSlot(pickedFruitPool, ctx, rng)
  const rowRole = slot === 'fruit' ? cellRole! : roleForSlot(slot as Slot)
  const { data, error } = await supabase.from('meal_plans')
    .upsert({ plan_date, slot, dish_id: p.dish_id, dish_name: p.dish_name, locked: false, role: rowRole, skipped: false },
      { onConflict: slot === 'fruit' ? 'plan_date,slot,role' : 'plan_date,slot' }).select(SELECT).single()
```
(The explicit-`dish_id` branch right above this one, and the `GET`
alternatives handler's equivalent lookup, need the same `role`-aware
`onConflict`/filter treatment — mirror the same pattern.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 5: Verify against the live database**

```bash
curl -s -X POST "http://localhost:3000/api/meals/reroll" -H 'Cookie: hs_session={"id":"test","name":"Test"}' \
  -H 'Content-Type: application/json' -d '{"scope":"week-desserts","weekStart":"<a Monday>"}' | jq '.week | length'
```
Then:
```sql
select dish_name from dessert_week_items where week_start = '<that Monday>';
select plan_date, dish_name from meal_plans where plan_date between '<start>' and '<end>' and slot = 'desert' order by plan_date;
```
Expected: every `meal_plans` dessert `dish_name` appears in the
`dessert_week_items` list for that week, and the item count is ≤3.

- [ ] **Step 6: Commit**

```bash
git add app/api/meals/reroll/route.ts
git commit -m "feat(meals): add week-desserts reroll scope, role-aware single-cell fruit/desert reroll

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: `cook_log` route + `CookLogSheet` become role-aware

**Files:**
- Modify: `app/api/meals/cook-log/route.ts`
- Modify: `components/meals/CookLogSheet.tsx`

**Interfaces:**
- Produces: cook-log entries are addressed by `(cook_date, slot, role)`, matching Task 1's migration, so the two `slot='fruit'` rows on a day no longer collide.

- [ ] **Step 1: Update the cook-log route**

Change:
```ts
  type Entry = { slot: string; planned_dish_id: string | null; planned_dish_name: string | null;
    actual_dish_id: string | null; actual_dish_name: string | null; cooked: boolean; note?: string | null }
  let entries: Entry[] = body.entries

  if (!entries) {
    // "cooked as planned" — derive from the day's non-skipped plan rows
    const { data: plan } = await supabase.from('meal_plans').select('slot, dish_id, dish_name')
      .eq('plan_date', cook_date).eq('skipped', false)
    entries = (plan ?? []).filter(p => p.dish_id).map(p => ({
      slot: p.slot, planned_dish_id: p.dish_id, planned_dish_name: p.dish_name,
      actual_dish_id: p.dish_id, actual_dish_name: p.dish_name, cooked: true, note: null,
    }))
  }

  const rows = entries.map(e => ({ ...e, cook_date, logged_by: by }))
  if (rows.length === 0) return Response.json({ entries: [] })
  const { data, error } = await supabase.from('cook_log')
    .upsert(rows, { onConflict: 'cook_date,slot' }).select()
```
to:
```ts
  type Entry = { slot: string; role: string; planned_dish_id: string | null; planned_dish_name: string | null;
    actual_dish_id: string | null; actual_dish_name: string | null; cooked: boolean; note?: string | null }
  let entries: Entry[] = body.entries

  if (!entries) {
    // "cooked as planned" — derive from the day's non-skipped plan rows
    const { data: plan } = await supabase.from('meal_plans').select('slot, role, dish_id, dish_name')
      .eq('plan_date', cook_date).eq('skipped', false)
    entries = (plan ?? []).filter(p => p.dish_id).map(p => ({
      slot: p.slot, role: p.role ?? 'support', planned_dish_id: p.dish_id, planned_dish_name: p.dish_name,
      actual_dish_id: p.dish_id, actual_dish_name: p.dish_name, cooked: true, note: null,
    }))
  }

  const rows = entries.map(e => ({ ...e, cook_date, logged_by: by }))
  if (rows.length === 0) return Response.json({ entries: [] })
  const { data, error } = await supabase.from('cook_log')
    .upsert(rows, { onConflict: 'cook_date,slot,role' }).select()
```

- [ ] **Step 2: Update `CookLogSheet`**

Read the full current file first (`components/meals/CookLogSheet.tsx`) to
get exact line numbers/context, then: add `role: Slot['role'] | string` (matching
whatever `MealPlan['role']` is typed as — import `Role` from
`@/lib/meals/types` if not already) to the `Draft` type; change every
place that matches/builds a draft by `e.slot === r.slot` to
`e.slot === r.slot && e.role === r.role`; change the `pools` state
(currently keyed by `d.slot`) to a composite key like `` `${d.slot}|${d.role}` ``
for both reading and writing; and update the alternatives fetch URL to
include `&role=${r.role}` when `r.slot === 'fruit'` (harmless/ignored for
every other slot, so it's simplest to always include it):
```ts
const res = await fetch(`/api/meals/reroll?plan_date=${date}&slot=${r.slot}&role=${r.role}&alternatives=8`)
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Verify in the browser**

With the dev server running and logged in, open `/meals`, find a day with
a plan, click "Mark cooked", then "Edit" to open `CookLogSheet` — confirm
both fruit rows (breakfast pairing and dessert pairing) appear as
*separate* rows (not one overwriting the other) and each can be toggled
independently. Save and reload — confirm both persisted correctly via:
```sql
select slot, role, planned_dish_name, actual_dish_name from cook_log where cook_date = '<that date>';
```
Expected: two distinct `slot='fruit'` rows, one per role.

- [ ] **Step 5: Commit**

```bash
git add app/api/meals/cook-log/route.ts components/meals/CookLogSheet.tsx
git commit -m "feat(meals): cook log addresses fruit rows by (date, slot, role)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 12: `SmallDishCard` component

**Files:**
- Modify: `components/meals/PlanClient.tsx`

**Interfaces:**
- Produces: `SmallDishCard` — image-left/label-right compact card, replacing `BreakfastStrip` and `FruitLine`. Same lock/reroll/recipe-link affordances as `SupportChip`, sized for a phone row rather than a hero.

- [ ] **Step 1: Add the component**

Add this new function, replacing `BreakfastStrip` and `FruitLine` in
place (delete both of those functions entirely — Task 13 removes their
call sites):

```tsx
// Compact image-left / label-right card — the breakfast pair and dessert
// pair both use this, sized for a phone row rather than the dinner hero's
// video-aspect thumbnail.
function SmallDishCard({ row, date, emoji, onReplaceCell }: {
  row: MealPlan; date: string; emoji?: string; onReplaceCell: (r: MealPlan) => void
}) {
  const { open, setOpen, alts, openAlts, toggleLock } = useCellControls(date, row, onReplaceCell)
  const qty = qtyDisplay(row.dishes)
  const isTreat = row.dishes?.tier === 'special'
  async function swap(dishId?: string) {
    const res = await fetch('/api/meals/reroll', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan_date: date, slot: row.slot, role: row.role, ...(dishId ? { dish_id: dishId } : {}) }),
    })
    if (res.ok) { const { pick } = await res.json(); onReplaceCell(pick) }
    setOpen(false)
  }
  return (
    <div className="relative flex items-center gap-2 bg-stone-50 border border-stone-200 rounded-xl pr-1.5 overflow-hidden">
      <Link href={row.dish_id ? `/meals/dish/${row.dish_id}` : '#'} aria-label={`View recipe for ${row.dish_name}`}
        className="flex items-center gap-2 min-w-0 flex-1 py-1.5">
        <DishImage imageUrl={row.dishes?.recipe_image_url ?? null} protein={row.dishes?.protein ?? 'none'} name={row.dish_name ?? undefined}
          className="w-10 h-10 shrink-0 ml-1.5" rounded="rounded-lg" iconSize={18} />
        <div className="min-w-0">
          <div className="text-xs text-stone-800 leading-snug truncate">
            {emoji && <span className="mr-1">{emoji}</span>}{row.dish_name ?? '—'}
          </div>
          <div className="flex items-center gap-1 mt-0.5">
            {isTreat && <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-orange-100 text-orange-700">eat-out</span>}
            {qty && <span className="text-[10px] text-stone-400 truncate">{qty}</span>}
          </div>
        </div>
      </Link>
      <div className="flex gap-0.5 shrink-0">
        <RecipeLinkButton row={row} onReplaceCell={onReplaceCell} />
        <button onClick={toggleLock} className={`p-0.5 rounded ${row.locked ? 'text-orange-600' : 'text-stone-400 hover:text-stone-700'}`}>{row.locked ? <Lock size={12} /> : <Unlock size={12} />}</button>
        <button onClick={openAlts} className="p-0.5 rounded text-stone-400 hover:text-stone-700"><Shuffle size={12} /></button>
      </div>
      {open && (
        <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-white border border-stone-200 rounded-xl shadow-lg p-1">
          <button onClick={() => swap()} className="w-full text-left px-2 py-1 rounded-lg hover:bg-orange-50 text-orange-700 text-xs">🎲 Surprise me</button>
          {alts?.map(a => <button key={a.id} onClick={() => swap(a.id)} className="w-full text-left px-2 py-1 rounded-lg hover:bg-stone-50 text-stone-700 text-xs truncate">{a.name}</button>)}
          <button onClick={() => setOpen(false)} className="w-full text-left px-2 py-1 rounded-lg text-stone-400 text-xs">Cancel</button>
        </div>
      )}
    </div>
  )
}
```

`useCellControls`'s `openAlts` already does
`` fetch(`/api/meals/reroll?plan_date=${date}&slot=${row.slot}&alternatives=5`) `` —
this needs `&role=${row.role}` appended too (harmless for non-fruit slots,
required for fruit). Update `useCellControls`:
```ts
  async function openAlts() {
    setOpen(true)
    if (alts) return
    const res = await fetch(`/api/meals/reroll?plan_date=${date}&slot=${row.slot}&role=${row.role}&alternatives=5`)
    const { alternatives } = await res.json(); setAlts(alternatives ?? [])
  }
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors at `BreakfastStrip`/`FruitLine`'s old call sites (still
referencing the now-deleted functions) — that's expected; Task 13 fixes
those next.

- [ ] **Step 3: Commit**

Hold this commit — Task 13 fixes the now-broken call sites in the same
file, so commit both together at the end of Task 13 to keep the tree
buildable at every commit. Skip committing here.

---

### Task 13: Wire the breakfast pair and dessert pair into `DayPlate`

**Files:**
- Modify: `components/meals/PlanClient.tsx`

**Interfaces:**
- Produces: day card renders breakfast pair (2 `SmallDishCard`s) and dessert pair (1-2 `SmallDishCard`s) in place of the old `BreakfastStrip`/desert+evening-fruit lines.

- [ ] **Step 1: Update `DayPlate`'s row selection and rendering**

Change:
```ts
  const supports = rows.filter(r => r.role === 'support' && r.dish_id)
  const soupSkipped = rows.some(r => r.slot === 'kuah' && r.skipped)
  const desert = rows.find(r => r.slot === 'desert')
  const eveningFruit = rows.find(r => r.slot === 'fruit')
```
to:
```ts
  const supports = rows.filter(r => r.role === 'support' && r.dish_id)
  const soupSkipped = rows.some(r => r.slot === 'kuah' && r.skipped)
  const breakfastFruit = rows.find(r => r.slot === 'fruit' && r.role === 'breakfast')
  const dessert = rows.find(r => r.slot === 'desert')
  const dessertFruit = rows.find(r => r.slot === 'fruit' && r.role === 'optional')
```

Change:
```ts
      {breakfast && <BreakfastStrip row={breakfast} date={date} onReplaceCell={onReplaceCell} />}
```
to:
```ts
      {(breakfast || breakfastFruit) && (
        <div className="grid grid-cols-2 gap-2">
          {breakfast && <SmallDishCard row={breakfast} date={date} emoji="🌅" onReplaceCell={onReplaceCell} />}
          {breakfastFruit && <SmallDishCard row={breakfastFruit} date={date} onReplaceCell={onReplaceCell} />}
        </div>
      )}
```

Change:
```ts
      {(desert || eveningFruit) && (
        <div className="flex flex-col gap-1">
          {desert && <FruitLine row={desert} label="desert" date={date} onReplaceCell={onReplaceCell} />}
          {eveningFruit && <FruitLine row={eveningFruit} label="evening" date={date} onReplaceCell={onReplaceCell} />}
        </div>
      )}
```
to:
```ts
      {(dessert || dessertFruit) && (
        <div className="grid grid-cols-2 gap-2">
          {dessert && <SmallDishCard row={dessert} date={date} onReplaceCell={onReplaceCell} />}
          {dessertFruit && <SmallDishCard row={dessertFruit} date={date} onReplaceCell={onReplaceCell} />}
        </div>
      )}
```

(If only one of a pair exists — e.g. the dessert batch produced a dish but
no dessert-fruit that day — `grid-cols-2` with a single child simply
leaves the second column empty, matching the spec's "e.g. a day shows...
or just 'Kacang ijo'" behavior with zero extra markup.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors — `BreakfastStrip`/`FruitLine` are gone from both
definition (Task 12) and every call site (this step).

- [ ] **Step 3: Verify in the browser**

With the dev server running and a generated week, visit `/meals` and
confirm: each day shows a 2-column breakfast row (dish left, fruit right,
both small image-left cards) above the dinner hero, and a 2-column dessert
row (dessert item, dessert-fruit when present) below the supports. Tap a
dessert card's shuffle icon — confirm the alternatives list shows only
the week's 2-3 batch items, not the full dessert table.

- [ ] **Step 4: Commit** (Task 12 + 13 together)

```bash
git add components/meals/PlanClient.tsx
git commit -m "feat(meals): breakfast pair and dessert pair as small image-left cards

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 14: Randomize breakfast/desserts buttons

**Files:**
- Modify: `components/meals/PlanClient.tsx`

**Interfaces:**
- Produces: two new buttons next to "Build shopping list"/"Generate Week", calling the Task 9/10 reroll scopes.

- [ ] **Step 1: Add the handlers and buttons**

Add two new pieces of state and handlers near `generate`/`buildList`:
```ts
  const [randomizingBreakfast, setRandomizingBreakfast] = useState(false)
  const [randomizingDesserts, setRandomizingDesserts] = useState(false)
  async function randomizeBreakfasts() {
    setRandomizingBreakfast(true)
    try {
      const res = await fetch('/api/meals/reroll', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope: 'week-breakfasts', weekStart }),
      })
      if (res.ok) { const { week } = await res.json(); setWeek(week ?? []) }
    } finally { setRandomizingBreakfast(false) }
  }
  async function randomizeDesserts() {
    setRandomizingDesserts(true)
    try {
      const res = await fetch('/api/meals/reroll', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope: 'week-desserts', weekStart }),
      })
      if (res.ok) { const { week } = await res.json(); setWeek(week ?? []) }
    } finally { setRandomizingDesserts(false) }
  }
```

Add the two buttons into the existing controls row, right before the
"Build shopping list" button:
```tsx
          <button onClick={randomizeBreakfasts} disabled={randomizingBreakfast}
            className="flex items-center gap-1.5 border border-stone-200 text-stone-600 hover:bg-stone-50 disabled:opacity-60 text-sm font-medium px-3 py-2 rounded-xl transition-colors">
            🎲 {randomizingBreakfast ? 'Randomizing…' : 'Randomize breakfast'}
          </button>
          <button onClick={randomizeDesserts} disabled={randomizingDesserts}
            className="flex items-center gap-1.5 border border-stone-200 text-stone-600 hover:bg-stone-50 disabled:opacity-60 text-sm font-medium px-3 py-2 rounded-xl transition-colors">
            🎲 {randomizingDesserts ? 'Randomizing…' : 'Randomize desserts'}
          </button>
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Verify in the browser**

Click "Randomize breakfast" — confirm every non-locked day's breakfast
pair changes (lock one day's breakfast first and confirm it's untouched).
Click "Randomize desserts" — confirm the week's dessert types change
(check `dessert_week_items` before/after) and non-locked dessert cells
update accordingly.

- [ ] **Step 4: Commit**

```bash
git add components/meals/PlanClient.tsx
git commit -m "feat(meals): add Randomize breakfast/desserts buttons

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 15: `fruit_context` editor in `DishesClient`

**Files:**
- Modify: `components/meals/DishesClient.tsx`
- Modify: `app/api/meals/dishes/[id]/route.ts`

**Interfaces:**
- Produces: a `fruit_context` select shown only for `slot === 'fruit'` rows in the dishes table, backed by the `PATCH` route's field whitelist.

- [ ] **Step 1: Whitelist the field server-side**

Change:
```ts
const FIELDS = ['name', 'slot', 'protein', 'tier', 'method', 'spicy', 'rating', 'active', 'no_repeat_days', 'ingredients', 'recipe_steps', 'recipe_image_url', 'saltiness', 'difficulty', 'is_garnish', 'provides_soup', 'recipe_links', 'qty_amount', 'qty_unit', 'qty_note']
```
to:
```ts
const FIELDS = ['name', 'slot', 'protein', 'tier', 'method', 'spicy', 'rating', 'active', 'no_repeat_days', 'ingredients', 'recipe_steps', 'recipe_image_url', 'saltiness', 'difficulty', 'is_garnish', 'provides_soup', 'recipe_links', 'qty_amount', 'qty_unit', 'qty_note', 'fruit_context']
```

- [ ] **Step 2: Add the selector in `DishesClient`**

Add a `FRUIT_CONTEXTS` constant near the other option lists:
```ts
const FRUIT_CONTEXTS = ['', 'breakfast', 'dessert', 'any']
```

In the table header row, add a new `<th>` right after the "Group" column:
```tsx
                    <th className="px-3 py-2 font-medium">Fruit context</th>
```
And in `DishRow`, add the corresponding `<td>` right after the slot `<td>`:
```tsx
      <td className="px-3 py-1.5">
        {dish.slot === 'fruit' ? (
          <select value={dish.fruit_context ?? ''} onChange={e => onPatch(dish.id, { fruit_context: e.target.value || null })}
            className="bg-transparent text-stone-600 focus:outline-none">
            {FRUIT_CONTEXTS.map(c => <option key={c} value={c}>{c || '—'}</option>)}
          </select>
        ) : <span className="text-stone-300">—</span>}
      </td>
```
Update the header `colSpan` on the "No dishes" empty-state row from `14`
to `15` (one more column now).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Verify in the browser**

Visit `/meals/dishes`, filter to "Fruit", confirm the new column shows
`any` for the existing fruit dishes and is editable; confirm it shows `—`
(non-editable) for a non-fruit dish.

- [ ] **Step 5: Commit**

```bash
git add components/meals/DishesClient.tsx app/api/meals/dishes/[id]/route.ts
git commit -m "feat(meals): make fruit_context editable in the dishes editor

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 16: `overview.ts` comment + test for combined fruit tally

**Files:**
- Modify: `lib/meals/overview.ts`
- Modify: `lib/meals/overview.test.ts`

**Interfaces:**
- No functional change — the existing fruit-tally sum already includes
  every `slot === 'fruit' || slot === 'desert'` row regardless of `role`,
  so it automatically picks up both new fruit rows.

- [ ] **Step 1: Update the stale comment**

Change:
```ts
  // 8. Fruit tally — desert + evening fruit portions summed per day
```
to:
```ts
  // 8. Fruit tally — desert (dessert item) + both fruit pairings (breakfast,
  // dessert) summed per day; role-agnostic on purpose, so this needed no
  // code change when the fruit slot grew a second per-day row.
```

- [ ] **Step 2: Add a confirming test**

Append to `lib/meals/overview.test.ts`:
```ts
  it('sums both a breakfast-fruit and a dessert-fruit row into the same day tally', () => {
    const rows = [
      row({ plan_date: '2026-08-10', slot: 'fruit', role: 'breakfast', dishes: meta({ fruit_portions: 1 }) }),
      row({ plan_date: '2026-08-10', slot: 'fruit', role: 'optional', dishes: meta({ fruit_portions: 1 }) }),
      ...D.slice(1).flatMap(d => [
        row({ plan_date: d, slot: 'fruit', role: 'breakfast', dishes: meta({ fruit_portions: 1 }) }),
        row({ plan_date: d, slot: 'fruit', role: 'optional', dishes: meta({ fruit_portions: 1 }) }),
      ]),
    ]
    const o = computeWeekOverview(rows)
    expect(o.signals.find(s => s.emoji === '🍎')!.detail).toMatch(/7 of 7 days/)
  })
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx vitest run lib/meals/overview.test.ts`
Expected: PASS (no implementation change needed — this confirms the
existing role-agnostic sum already does the right thing).

- [ ] **Step 4: Commit**

```bash
git add lib/meals/overview.ts lib/meals/overview.test.ts
git commit -m "test(meals): confirm the fruit tally sums both fruit-pairing rows

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 17: Seed missing images

**Files:**
- No new files — direct DB writes via the Supabase MCP `execute_sql` tool.

**Interfaces:**
- Produces: `recipe_image_url` populated for the 9 breakfast dishes and 4
  original fruit-slot dishes still missing one.

- [ ] **Step 1: Confirm the current gap**

```sql
select id, name, slot from dishes where slot in ('breakfast','fruit') and recipe_image_url is null order by slot, name;
```
Expected: 13 rows (9 breakfast, 4 fruit — "Jeruk (sore)", "Pepaya (sore)",
"Pisang (sore)", "Semangka (sore)").

- [ ] **Step 2: Find a direct, stable image URL per dish**

For each of the 13 dishes, use `WebSearch` to find a Pexels, Unsplash, or
Pixabay page for a matching photo (boiled eggs for "Telur rebus", bread
for "Roti + selai kacang", banana for "Pisang (sore)", etc.), then use
`WebFetch` on the specific photo page to extract its direct CDN image URL
(these sites expose a direct `images.pexels.com`/`images.unsplash.com`/
`cdn.pixabay.com` asset URL either in the page's `<img>` `src`/`srcset` or
via their oEmbed/API metadata — prefer a mid-resolution variant, not the
largest, to keep page weight reasonable). Reject any URL that isn't
directly on one of those three CDN hostnames (a share link or search-results
page URL is not a direct image and won't render via `<img src>`).

- [ ] **Step 3: Verify each URL actually serves an image before writing it**

```bash
curl -sI "<candidate URL>" | grep -i "content-type\|HTTP/"
```
Expected: `200`/`304` and `content-type: image/...`. Discard and re-search
any URL that fails this check.

- [ ] **Step 4: Apply**

```sql
update dishes set recipe_image_url = '<verified url>' where id = '<dish id>';
```
One statement per dish (13 total), run via the Supabase MCP `execute_sql`
tool.

- [ ] **Step 5: Verify**

```sql
select count(*) from dishes where slot in ('breakfast','fruit') and recipe_image_url is null;
```
Expected: `0`.

- [ ] **Step 6: No commit needed** — this task is data-only (no files
  changed in the repo).

---

### Task 18: Final verification

- [ ] **Step 1: Full test suite + typecheck**

```bash
npx vitest run
npx tsc --noEmit
```
Expected: all `lib/**/*.test.ts` pass (baseline + every new case from
Tasks 3-7, 16), no type errors.

- [ ] **Step 2: End-to-end Generate Week**

With the dev server running and logged in, visit `/meals`, click "Generate
Week". Confirm:
- Every day shows a breakfast pair (dish + fruit, both with images now).
- Every day shows a dessert pair (1-2 small cards).
- Across the whole visible week, no more than 3 distinct dessert dish
  names appear (spot-check the day cards, or query `dessert_week_items`
  for that week — should be ≤3 rows).
- The generation report banner shows no dessert-cap or fruit-presence
  violations (`✓ Week validated`, or only pre-existing advisory lines
  unrelated to this feature).

- [ ] **Step 3: Randomize buttons**

Click "Randomize breakfast" and "Randomize desserts" separately; confirm
each only changes what it claims to (breakfast pairs vs dessert types),
and that locking a day's breakfast or dessert cell first protects it from
either randomize action.

- [ ] **Step 4: Report to Kevin**

Summarize what changed, and flag that Task 17's image URLs are third-party
CDN links (Pexels/Unsplash/Pixabay) that are expected to be stable but
aren't hosted by Homespace itself — if any ever 404, `DishesClient`'s
existing photo-upload flow can replace them per-dish at any time.
