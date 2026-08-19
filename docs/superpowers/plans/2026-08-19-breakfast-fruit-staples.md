# Breakfast, Evening Fruit & Daily Staples Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a generated breakfast slot (its own independent eat-out treat quota), a second evening-fruit slot, and an always-on daily-staples display to the Meal Planner, without disturbing dinner's existing rules.

**Architecture:** Extend the `Slot`/`Role` unions and the generation engine with a small, independent breakfast rule path (own quota preassignment, own eligibility check) plus a fruit slot that reuses the existing generic dinner picker unchanged (fruit dishes are neutral on every cross-slot rule). Daily staples are a static, separately-CRUD'd table with no generation involvement. UI changes extend the existing day-card and week-overview components rather than introducing new page-level navigation.

**Tech Stack:** Next.js App Router, Supabase (`lib/supabase.ts`), TypeScript, Vitest, Tailwind CSS. Auth via the `hs_session` cookie (checked by `proxy.ts`; no route-level auth code needed).

**Spec:** `docs/superpowers/specs/2026-08-19-breakfast-fruit-staples-design.md`

## Global Constraints

- Homespace visual style: stone/orange Tailwind palette, `DM Serif Display` for headings, rounded-xl/2xl cards — match the existing `PlanClient.tsx`/`DishesClient.tsx` look exactly, don't introduce a new visual language.
- Mobile-first: every new UI element must stay legible and usable at ~375-420px width first.
- No nutrition tracking, calorie counting, or weekly-average math — display only, as established in the earlier quantities work.
- Daily staples are never generated, rerolled, or locked. They are a static display list, editable only via the inline banner editor.
- This repo has no component-test convention (no `.test.tsx` files exist) — UI tasks are verified by running the dev server and checking in a real browser, not by writing React tests. `lib/**/*.ts` logic is unit-tested with Vitest, following the file's existing style exactly (see `lib/meals/engine.test.ts`'s `dish()`/`plan()`/`pick()`/`ctx()`/`pools()`/`seq()`/`WEEK` fixtures — reuse them, don't recreate).
- Every task must leave `npx tsc --noEmit -p .` and `npx vitest run` clean before moving to the next task.

---

## Task 1: Extend `Slot`/`Role`/constants for breakfast & fruit

**Files:**
- Modify: `lib/meals/types.ts`
- Modify: `lib/meals/engine.test.ts:272-280` (the `pools()` helper), `lib/meals/engine.test.ts:482-487` (an inline `dishesBySlot` literal)
- Test: existing `lib/meals/engine.test.ts` and `lib/meals/overview.test.ts` (full suite must stay green — this task is "make the type change land safely," not "add new behavior")

**Interfaces:**
- Produces: `SLOTS` now `['breakfast', 'utama', 'kuah', 'pelengkap', 'sayuran', 'fruit', 'desert']`; `Slot` union includes `'breakfast' | 'fruit'`; `Role` union includes `'breakfast'`; new type `DailyStaple = { id: string; name: string; person: string; frequency: string; note: string | null }`.

- [ ] **Step 1: Widen `SLOTS`, `SLOT_LABELS`, `DEFAULT_NO_REPEAT`, `Role`, and add `DailyStaple`**

Edit `lib/meals/types.ts`:

```ts
export const SLOTS = ['breakfast', 'utama', 'kuah', 'pelengkap', 'sayuran', 'fruit', 'desert'] as const
export type Slot = (typeof SLOTS)[number]

export const SLOT_LABELS: Record<Slot, string> = {
  breakfast: 'Breakfast', utama: 'Utama', kuah: 'Kuah', pelengkap: 'Pelengkap',
  sayuran: 'Sayuran', fruit: 'Fruit', desert: 'Desert',
}

export type Tier = 'everyday' | 'nice' | 'special'
export type Role = 'main' | 'support' | 'optional' | 'breakfast'
export type Richness = 'light' | 'medium' | 'heavy'
export type Saltiness = 'normal' | 'salty' | 'very_salty'
export type Difficulty = 'easy' | 'medium' | 'hard'

export const DEFAULT_NO_REPEAT: Record<Slot, number> = {
  breakfast: 4, utama: 14, kuah: 7, pelengkap: 7, sayuran: 7, fruit: 3, desert: 10,
}
```

Add, near the other top-level types (after the `Dish` type is fine):

```ts
export type DailyStaple = {
  id: string
  name: string
  person: string
  frequency: string
  note: string | null
}
```

- [ ] **Step 2: Run the typechecker to find every break**

Run: `npx tsc --noEmit -p .`
Expected: FAIL — `lib/meals/engine.test.ts` errors that `pools()`'s return value and the inline `dishesBySlot` literal are missing `breakfast`/`fruit` keys required by `Record<Slot, Dish[]>`.

- [ ] **Step 3: Fix `pools()` and the inline `dishesBySlot` literal in the test file**

In `lib/meals/engine.test.ts`, change the `pools()` helper (around line 272-280):

```ts
function pools() {
  const mk = (slot: Slot, n: number, over: Partial<Dish> = {}) =>
    Array.from({ length: n }, (_, i) => dish({ id: `${slot}-${i}`, slot, ...over,
      protein: slot === 'utama' ? ['beef','chicken','fish','egg','tofu_tempe','shrimp','duck'][i % 7] : 'none' }))
  return {
    breakfast: [] as Dish[], utama: mk('utama', 12), kuah: mk('kuah', 8), pelengkap: mk('pelengkap', 9),
    sayuran: mk('sayuran', 8), fruit: [] as Dish[], desert: mk('desert', 8),
  }
}
```

And the inline literal inside `describe('generateWeek (saltiness + difficulty)', ...)` (around line 482-487):

```ts
    const dishesBySlot = {
      breakfast: [] as Dish[],
      utama: mk('utama', 12, i => ({ tier: (i < 3 ? 'special' : 'everyday') as Dish['tier'], difficulty: (i < 4 ? 'hard' : 'medium') as Dish['difficulty'] })),
      kuah: mk('kuah', 8, i => ({ difficulty: (i === 0 ? 'hard' : 'easy') as Dish['difficulty'], saltiness: (i === 1 ? 'salty' : 'normal') as Dish['saltiness'] })),
      pelengkap: mk('pelengkap', 9, i => ({ saltiness: (i < 3 ? 'very_salty' : 'normal') as Dish['saltiness'] })),
      sayuran: mk('sayuran', 8), fruit: [] as Dish[], desert: mk('desert', 8),
    }
```

(Only the `breakfast: [] as Dish[]` and `fruit: [] as Dish[]` lines are new in both — everything else is unchanged.)

- [ ] **Step 4: Verify the full suite is green**

Run: `npx tsc --noEmit -p . && npx vitest run`
Expected: PASS, 0 TypeScript errors, all existing tests still pass (breakfast/fruit pools being empty means `composeDay`/`generateWeek` will produce a `dish_id: null` row for those two slots in every existing test — this is fine because no existing assertion checks `created.length`/`day.length` exactly, only filtered subsets).

- [ ] **Step 5: Commit**

```bash
git add lib/meals/types.ts lib/meals/engine.test.ts
git commit -m "feat(meals): extend Slot/Role for breakfast + fruit, add DailyStaple type

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: `formatStaplesLine` helper

**Files:**
- Create: `lib/meals/staples.ts`
- Test: `lib/meals/staples.test.ts`

**Interfaces:**
- Consumes: `DailyStaple` from `lib/meals/types.ts` (Task 1).
- Produces: `formatStaplesLine(staples: DailyStaple[]): string` — groups staples sharing an identical `name`+`note` across people, joins people with `&`/commas, and joins distinct items with `" · "`. Returns `''` for an empty list.

- [ ] **Step 1: Write the failing tests**

Create `lib/meals/staples.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatStaplesLine } from './staples'
import type { DailyStaple } from './types'

function staple(over: Partial<DailyStaple> & { id: string; name: string; person: string }): DailyStaple {
  return { frequency: 'daily', note: null, ...over }
}

describe('formatStaplesLine', () => {
  it('returns empty string for no staples', () => {
    expect(formatStaplesLine([])).toBe('')
  })
  it('lists a single staple as "person name"', () => {
    expect(formatStaplesLine([staple({ id: '1', name: 'Susu (milk)', person: 'Son' })]))
      .toBe('Son Susu (milk)')
  })
  it('groups people sharing an identical name+note with "&"', () => {
    const staples = [
      staple({ id: '1', name: 'Susu / yogurt', person: 'Kevin', note: 'daily calcium' }),
      staple({ id: '2', name: 'Susu / yogurt', person: 'Wife', note: 'daily calcium' }),
    ]
    expect(formatStaplesLine(staples)).toBe('Kevin & Wife Susu / yogurt')
  })
  it('joins 3+ people in a group with commas and a final "&"', () => {
    const staples = ['Son', 'Kevin', 'Wife'].map((p, i) =>
      staple({ id: String(i), name: 'Susu (milk)', person: p }))
    expect(formatStaplesLine(staples)).toBe('Son, Kevin & Wife Susu (milk)')
  })
  it('separates distinct items with " · "', () => {
    const staples = [
      staple({ id: '1', name: 'Susu (milk)', person: 'Son' }),
      staple({ id: '2', name: 'Susu / yogurt', person: 'Kevin', note: 'daily calcium' }),
      staple({ id: '3', name: 'Susu / yogurt', person: 'Wife', note: 'daily calcium' }),
    ]
    expect(formatStaplesLine(staples)).toBe('Son Susu (milk) · Kevin & Wife Susu / yogurt')
  })
  it('keeps identically-named items with different notes separate', () => {
    const staples = [
      staple({ id: '1', name: 'Vitamin', person: 'Son', note: 'morning' }),
      staple({ id: '2', name: 'Vitamin', person: 'Son', note: 'evening' }),
    ]
    expect(formatStaplesLine(staples)).toBe('Son Vitamin · Son Vitamin')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/meals/staples.test.ts`
Expected: FAIL — `Cannot find module './staples'`.

- [ ] **Step 3: Implement `lib/meals/staples.ts`**

```ts
import type { DailyStaple } from './types'

// Groups staples that share an identical item+note across people into one
// clause ("Son Susu (milk) · Kevin & Wife Susu / yogurt"), then joins
// distinct items with " · ". Rename a staple's `name` via the editor for a
// shorter/different display — this is a direct, WYSIWYG reflection of the
// data, no hidden translation.
export function formatStaplesLine(staples: DailyStaple[]): string {
  const groups = new Map<string, { name: string; people: string[] }>()
  for (const s of staples) {
    const key = `${s.name.trim().toLowerCase()}|${(s.note ?? '').trim().toLowerCase()}`
    const g = groups.get(key)
    if (g) g.people.push(s.person)
    else groups.set(key, { name: s.name.trim(), people: [s.person] })
  }
  return [...groups.values()].map(g => `${joinPeople(g.people)} ${g.name}`).join(' · ')
}

function joinPeople(people: string[]): string {
  if (people.length === 1) return people[0]
  if (people.length === 2) return `${people[0]} & ${people[1]}`
  return `${people.slice(0, -1).join(', ')} & ${people[people.length - 1]}`
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/meals/staples.test.ts`
Expected: PASS, 6/6.

- [ ] **Step 5: Commit**

```bash
git add lib/meals/staples.ts lib/meals/staples.test.ts
git commit -m "feat(meals): add formatStaplesLine helper for the daily-staples banner

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Daily staples CRUD routes

**Files:**
- Create: `app/api/meals/staples/route.ts`
- Create: `app/api/meals/staples/[id]/route.ts`

**Interfaces:**
- Produces: `GET /api/meals/staples` → `DailyStaple[]`. `POST /api/meals/staples` (body: `{ name?, person?, frequency?, note? }`) → created `DailyStaple`. `PATCH /api/meals/staples/[id]` (body: any of `name`/`person`/`frequency`/`note`) → updated `DailyStaple`. `DELETE /api/meals/staples/[id]` → `{ success: true }`.

- [ ] **Step 1: Create the list/create route**

Create `app/api/meals/staples/route.ts`, mirroring `app/api/meals/dishes/route.ts`'s pattern exactly:

```ts
import { supabase } from '@/lib/supabase'

export async function GET() {
  const { data, error } = await supabase.from('daily_staples').select('*').order('person')
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function POST(request: Request) {
  const body = await request.json()
  const { data, error } = await supabase.from('daily_staples').insert({
    name: body.name?.trim() || 'New staple',
    person: body.person?.trim() || '',
    frequency: body.frequency ?? 'daily',
    note: body.note ?? null,
  }).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}
```

- [ ] **Step 2: Create the update/delete route**

Create `app/api/meals/staples/[id]/route.ts`, mirroring `app/api/meals/dishes/[id]/route.ts`:

```ts
import { supabase } from '@/lib/supabase'

const FIELDS = ['name', 'person', 'frequency', 'note']

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json()
  const patch = Object.fromEntries(Object.entries(body).filter(([k]) => FIELDS.includes(k)))
  const { data, error } = await supabase.from('daily_staples').update(patch).eq('id', id).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { error } = await supabase.from('daily_staples').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: PASS, 0 errors.

- [ ] **Step 4: Manually verify against the dev server**

This repo has no route-handler test convention (dishes routes aren't unit-tested either) — verify with `curl` against a running dev server, using the same session-cookie trick as any other authenticated route (the `hs_session` cookie only needs to be valid JSON — `proxy.ts` doesn't verify a signature):

```bash
npm run dev &
sleep 2
COOKIE='hs_session={"id":"test","name":"Test","phone":"+10000000000"}'
curl -s -H "Cookie: $COOKIE" http://localhost:3000/api/meals/staples | head -c 400
echo
curl -s -X POST -H "Cookie: $COOKIE" -H "content-type: application/json" \
  -d '{"name":"Test staple","person":"Tester"}' http://localhost:3000/api/meals/staples
```

Expected: the `GET` returns the 3 seeded rows (Son/Kevin/Wife); the `POST` returns a new row with an `id`. Then `PATCH`/`DELETE` that new row using its `id` and confirm both succeed, so the temporary test row doesn't linger in the real data:

```bash
NEW_ID=$(curl -s -X POST -H "Cookie: $COOKIE" -H "content-type: application/json" \
  -d '{"name":"Test staple","person":"Tester"}' http://localhost:3000/api/meals/staples | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).id))")
curl -s -X PATCH -H "Cookie: $COOKIE" -H "content-type: application/json" \
  -d '{"note":"updated"}' "http://localhost:3000/api/meals/staples/$NEW_ID"
curl -s -X DELETE -H "Cookie: $COOKIE" "http://localhost:3000/api/meals/staples/$NEW_ID"
```

Stop the dev server afterward.

- [ ] **Step 5: Commit**

```bash
git add app/api/meals/staples
git commit -m "feat(meals): add daily-staples CRUD routes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Engine — breakfast's independent quota + picker

**Files:**
- Modify: `lib/meals/engine.ts`
- Test: `lib/meals/engine.test.ts`

**Interfaces:**
- Consumes: `Dish`, `MealPlan`, `Pick`, `Rng`, `PickContext`, `noRepeatOk`, `weightedPick`, `shuffle` — all already in `engine.ts`.
- Produces: `preassignBreakfastSpecialDays(days: string[], lockedCells: MealPlan[], dishById: Map<string, Dish>, rng: Rng): Set<string>`; `breakfastSpecialOk(dish: Dish, isSpecialDay: boolean): boolean`; `breakfastCandidates(pool: Dish[], ctx: PickContext, isSpecialDay: boolean): Dish[]`; `pickBreakfast(pool: Dish[], ctx: PickContext, isSpecialDay: boolean, rng: Rng): Pick`.

- [ ] **Step 1: Write the failing tests**

Add to `lib/meals/engine.test.ts` (after the existing `describe('preassignSpecialDays', ...)` block, so it sits near its dinner counterpart):

```ts
import { preassignBreakfastSpecialDays, breakfastSpecialOk, breakfastCandidates, pickBreakfast } from './engine'

describe('preassignBreakfastSpecialDays', () => {
  it('returns exactly 2 non-adjacent days', () => {
    const dishById = new Map([['sb', dish({ id: 'sb', slot: 'breakfast', tier: 'special' })]])
    const days = preassignBreakfastSpecialDays(WEEK, [], dishById, seq([0.1, 0.4, 0.7, 0.2, 0.9, 0.3, 0.6]))
    expect(days.size).toBe(2)
    const idx = [...days].map(d => WEEK.indexOf(d)).sort((a, b) => a - b)
    expect(idx[1] - idx[0]).toBeGreaterThanOrEqual(2)
  })
  it('honors a locked special breakfast day', () => {
    const dishById = new Map([['sb', dish({ id: 'sb', slot: 'breakfast', tier: 'special' })]])
    const locked = [plan({ plan_date: '2026-08-13', slot: 'breakfast', dish_id: 'sb', locked: true })]
    const days = preassignBreakfastSpecialDays(WEEK, locked, dishById, seq([0.5]))
    expect(days.has('2026-08-13')).toBe(true)
  })
  it('ignores a locked special DINNER dish — independent of the dinner quota', () => {
    const dishById = new Map([
      ['su', dish({ id: 'su', slot: 'utama', tier: 'special' })],
      ['bf', dish({ id: 'bf', slot: 'breakfast', tier: 'special' })],
    ])
    const locked = [plan({ plan_date: '2026-08-13', slot: 'utama', dish_id: 'su', locked: true })]
    const days = preassignBreakfastSpecialDays(WEEK, locked, dishById, seq([0.5]))
    expect(days.has('2026-08-13')).toBe(false)
  })
  it('returns an empty set when the breakfast pool has no special dishes', () => {
    const dishById = new Map([['bf', dish({ id: 'bf', slot: 'breakfast', tier: 'everyday' })]])
    const days = preassignBreakfastSpecialDays(WEEK, [], dishById, seq([0.5]))
    expect(days.size).toBe(0)
  })
})

describe('breakfastSpecialOk', () => {
  it('requires a special dish on a special day', () => {
    const everyday = dish({ id: 'e', slot: 'breakfast', tier: 'everyday' })
    const special = dish({ id: 's', slot: 'breakfast', tier: 'special' })
    expect(breakfastSpecialOk(special, true)).toBe(true)
    expect(breakfastSpecialOk(everyday, true)).toBe(false)
  })
  it('forbids a special dish on a non-special day', () => {
    const everyday = dish({ id: 'e', slot: 'breakfast', tier: 'everyday' })
    const special = dish({ id: 's', slot: 'breakfast', tier: 'special' })
    expect(breakfastSpecialOk(everyday, false)).toBe(true)
    expect(breakfastSpecialOk(special, false)).toBe(false)
  })
})

describe('pickBreakfast', () => {
  const bfPool = () => [
    dish({ id: 'e1', slot: 'breakfast', tier: 'everyday' }),
    dish({ id: 'e2', slot: 'breakfast', tier: 'everyday' }),
    dish({ id: 's1', slot: 'breakfast', tier: 'special' }),
  ]
  it('only picks special-tier dishes on a special day', () => {
    const pool = bfPool()
    const c = ctx({ date: '2026-08-13', slot: 'breakfast', role: 'breakfast', dishes: pool })
    const p = pickBreakfast(pool, c, true, seq([0.5]))
    expect(p.dish_id).toBe('s1')
  })
  it('only picks everyday-tier dishes on a non-special day', () => {
    const pool = bfPool()
    const c = ctx({ date: '2026-08-13', slot: 'breakfast', role: 'breakfast', dishes: pool })
    const p = pickBreakfast(pool, c, false, seq([0.5]))
    expect(['e1', 'e2']).toContain(p.dish_id)
  })
  it('respects the no-repeat window before relaxing', () => {
    const pool = [dish({ id: 'e1', slot: 'breakfast', tier: 'everyday' }), dish({ id: 'e2', slot: 'breakfast', tier: 'everyday' })]
    const c = ctx({ date: '2026-08-13', slot: 'breakfast', role: 'breakfast', dishes: pool,
      priorPlans: [plan({ plan_date: '2026-08-11', slot: 'breakfast', dish_id: 'e1' })] }) // 2 days ago, window 4
    const p = pickBreakfast(pool, c, false, seq([0.5]))
    expect(p.dish_id).toBe('e2')
  })
  it('relaxes the no-repeat window rather than leaving the slot empty', () => {
    const pool = [dish({ id: 'e1', slot: 'breakfast', tier: 'everyday' })]
    const c = ctx({ date: '2026-08-13', slot: 'breakfast', role: 'breakfast', dishes: pool,
      priorPlans: [plan({ plan_date: '2026-08-11', slot: 'breakfast', dish_id: 'e1' })] }) // window 4 blocks; factor 0.5 -> window 2 allows (gap 2)
    const p = pickBreakfast(pool, c, false, seq([0.5]))
    expect(p.dish_id).toBe('e1')
  })
  it('returns dish_id null when the pool has no dish of the required tier', () => {
    const pool = [dish({ id: 'e1', slot: 'breakfast', tier: 'everyday' })]
    const c = ctx({ date: '2026-08-13', slot: 'breakfast', role: 'breakfast', dishes: pool })
    const p = pickBreakfast(pool, c, true, seq([0.5]))
    expect(p.dish_id).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/meals/engine.test.ts -t "preassignBreakfastSpecialDays|breakfastSpecialOk|pickBreakfast"`
Expected: FAIL — the four new names don't exist yet.

- [ ] **Step 3: Implement in `lib/meals/engine.ts`**

Add these functions right after `preassignHardDays` (so they sit with the other preassignment logic), before the `secondVegForKuah` comment block:

```ts
// Breakfast's own 2-non-adjacent-days/week eat-out quota. Deliberately NOT
// shared with preassignSpecialDays: breakfast is independent of dinner, so a
// day may land both a special dinner AND a special breakfast.
export function preassignBreakfastSpecialDays(
  days: string[], lockedCells: MealPlan[], dishById: Map<string, Dish>, rng: Rng,
): Set<string> {
  const result = new Set<string>()
  const breakfastLocked = lockedCells.filter(lc => lc.slot === 'breakfast')
  for (const lc of breakfastLocked) {
    if (dishById.get(lc.dish_id ?? '')?.tier === 'special') result.add(lc.plan_date)
  }
  const breakfastPool = [...dishById.values()].some(d => d.slot === 'breakfast' && d.tier === 'special' && d.active)
  if (!breakfastPool) return result

  const isAdjacent = (d: string) =>
    [...result].some(r => Math.abs(days.indexOf(r) - days.indexOf(d)) < 2)
  const lockedSpecialDays = new Set(
    breakfastLocked.filter(lc => dishById.get(lc.dish_id ?? '')?.tier === 'special').map(lc => lc.plan_date))
  const shuffled = shuffle(days.filter(d => !lockedSpecialDays.has(d)), rng)
  for (const d of shuffled) {
    if (result.size >= 2) break
    if (!isAdjacent(d)) result.add(d)
  }
  return result
}

// Breakfast is a single dish per day (not a multi-slot plate), so unlike
// dinner's specialOk there's no cross-slot day-cap to check — just whether
// today was assigned a special day.
export function breakfastSpecialOk(dish: Dish, isSpecialDay: boolean): boolean {
  return isSpecialDay ? dish.tier === 'special' : dish.tier !== 'special'
}

// Breakfast bypasses passesHardRules entirely — it's independent of dinner's
// fried/spicy/saltiness/protein-clash/difficulty/spacing rules by design.
// Only active + right slot + no-repeat + the quota above apply.
export function breakfastCandidates(pool: Dish[], ctx: PickContext, isSpecialDay: boolean): Dish[] {
  const eligible = pool.filter(d => d.active && !d.is_garnish && d.slot === 'breakfast' && breakfastSpecialOk(d, isSpecialDay))
  const strict = eligible.filter(d => noRepeatOk(d, ctx))
  if (strict.length > 0) return strict
  const relaxedCtx: PickContext = { ...ctx, relax: { ...ctx.relax, noRepeatFactor: 0.5 } }
  const relaxed = eligible.filter(d => noRepeatOk(d, relaxedCtx))
  if (relaxed.length > 0) return relaxed
  return eligible // last resort: ignore no-repeat rather than leave the slot empty
}

export function pickBreakfast(pool: Dish[], ctx: PickContext, isSpecialDay: boolean, rng: Rng): Pick {
  const candidates = breakfastCandidates(pool, ctx, isSpecialDay)
  if (candidates.length === 0) {
    return { plan_date: ctx.date, slot: 'breakfast', dish_id: null, dish_name: null,
      locked: false, role: ctx.role, skipped: false, note: 'no candidate available' }
  }
  return toPick(ctx, weightedPick(candidates, ctx, rng)!)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/meals/engine.test.ts -t "preassignBreakfastSpecialDays|breakfastSpecialOk|pickBreakfast"`
Expected: PASS, all new cases green.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npx tsc --noEmit -p . && npx vitest run`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add lib/meals/engine.ts lib/meals/engine.test.ts
git commit -m "feat(meals): breakfast's independent treat-quota + picker

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Engine — wire breakfast + evening fruit into `composeDay`/`generateWeek`

**Files:**
- Modify: `lib/meals/engine.ts`
- Test: `lib/meals/engine.test.ts`

**Interfaces:**
- Consumes: `pickBreakfast` (Task 4), `pickForSlot` (existing, reused unchanged for `fruit`), `preassignBreakfastSpecialDays` (Task 4).
- Produces: `composeDay`'s input type gains `breakfastSpecialDays: Set<string>`; `generateWeek`'s behavior now includes one `breakfast` row and one `fruit` row per day.

- [ ] **Step 1: Write the failing tests**

Add to `lib/meals/engine.test.ts`, right after the existing `describe('composeDay (3-component plate)', ...)` block:

```ts
describe('composeDay (breakfast + evening fruit)', () => {
  const withBreakfastAndFruit = (): Record<Slot, Dish[]> => ({
    ...pools(),
    breakfast: [
      dish({ id: 'bf-e1', slot: 'breakfast', tier: 'everyday' }),
      dish({ id: 'bf-e2', slot: 'breakfast', tier: 'everyday' }),
    ],
    fruit: [
      dish({ id: 'fr-1', slot: 'fruit', tier: 'everyday', protein: 'none' }),
      dish({ id: 'fr-2', slot: 'fruit', tier: 'everyday', protein: 'none' }),
    ],
  })
  const run = (dishesBySlot: Record<Slot, Dish[]>, breakfastSpecialDays = new Set<string>(), lockedByCell = new Map<string, MealPlan>()) => {
    const dishById = new Map(Object.values(dishesBySlot).flat().map(d => [d.id, d]))
    return composeDay({ date: '2026-08-10', dishesBySlot, dishById, priorPlans: [], runPicks: [],
      lockedByCell, specialDays: new Set(), hardDays: new Set(), breakfastSpecialDays,
      rng: seq([0.3,0.6,0.1,0.8,0.5,0.2,0.9,0.4]) })
  }

  it('adds one breakfast and one evening fruit row alongside the dinner plate', () => {
    const created = run(withBreakfastAndFruit())
    expect(created.filter(x => x.slot === 'breakfast').length).toBe(1)
    expect(created.find(x => x.slot === 'breakfast')!.dish_id).toBeTruthy()
    expect(created.filter(x => x.slot === 'fruit').length).toBe(1)
    expect(created.find(x => x.slot === 'fruit')!.dish_id).toBeTruthy()
  })

  it('picks a special breakfast only on an assigned breakfastSpecialDays date', () => {
    const p = withBreakfastAndFruit()
    p.breakfast.push(dish({ id: 'bf-s1', slot: 'breakfast', tier: 'special' }))
    const dishById = new Map(Object.values(p).flat().map(d => [d.id, d]))
    const created = composeDay({ date: '2026-08-10', dishesBySlot: p, dishById, priorPlans: [], runPicks: [],
      lockedByCell: new Map(), specialDays: new Set(), hardDays: new Set(), breakfastSpecialDays: new Set(['2026-08-10']),
      rng: seq([0.3,0.6,0.1,0.8,0.5,0.2,0.9,0.4]) })
    const bf = created.find(x => x.slot === 'breakfast')!
    expect(dishById.get(bf.dish_id!)!.tier).toBe('special')
  })

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

  it('an empty breakfast/fruit pool produces a null-dish row rather than throwing', () => {
    const created = run(pools()) // breakfast: [], fruit: [] from the shared helper
    expect(created.find(x => x.slot === 'breakfast')!.dish_id).toBeNull()
    expect(created.find(x => x.slot === 'fruit')!.dish_id).toBeNull()
  })
})

describe('generateWeek (breakfast + fruit)', () => {
  it('gives every day exactly one breakfast and one evening fruit; breakfast specials are <=2/week non-adjacent', () => {
    const dishesBySlot = pools()
    dishesBySlot.utama[0].tier = 'special'; dishesBySlot.utama[1].tier = 'special'
    dishesBySlot.breakfast = [
      dish({ id: 'bf-e1', slot: 'breakfast', tier: 'everyday' }),
      dish({ id: 'bf-e2', slot: 'breakfast', tier: 'everyday' }),
      dish({ id: 'bf-e3', slot: 'breakfast', tier: 'everyday' }),
      dish({ id: 'bf-s1', slot: 'breakfast', tier: 'special' }),
    ]
    dishesBySlot.fruit = [
      dish({ id: 'fr-1', slot: 'fruit', tier: 'everyday', protein: 'none' }),
      dish({ id: 'fr-2', slot: 'fruit', tier: 'everyday', protein: 'none' }),
    ]
    const allDishes = Object.values(dishesBySlot).flat()
    const byId = new Map(allDishes.map(d => [d.id, d]))
    const picks = generateWeek({ weekStart: '2026-08-10', days: WEEK, dishesBySlot, allDishes,
      priorPlans: [], lockedCells: [], rng: seq([0.3,0.6,0.1,0.8,0.5,0.2,0.9,0.4,0.7,0.05]) })
    for (const date of WEEK) {
      const day = picks.filter(p => p.plan_date === date)
      expect(day.filter(p => p.slot === 'breakfast').length).toBe(1)
      expect(day.filter(p => p.slot === 'fruit').length).toBe(1)
    }
    const bfSpecialDays = [...new Set(picks.filter(p => p.slot === 'breakfast' && byId.get(p.dish_id ?? '')?.tier === 'special').map(p => p.plan_date))]
    expect(bfSpecialDays.length).toBeLessThanOrEqual(2)
    const idx = bfSpecialDays.map(d => WEEK.indexOf(d)).sort((a, b) => a - b)
    if (idx.length === 2) expect(idx[1] - idx[0]).toBeGreaterThanOrEqual(2)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/meals/engine.test.ts -t "breakfast \+ evening fruit|breakfast \+ fruit"`
Expected: FAIL — `composeDay` doesn't accept `breakfastSpecialDays` yet and produces no `breakfast`/`fruit` rows.

- [ ] **Step 3: Implement in `lib/meals/engine.ts`**

Update `composeDay`'s signature and body:

```ts
export function composeDay(input: {
  date: string
  dishesBySlot: Record<Slot, Dish[]>
  dishById: Map<string, Dish>
  priorPlans: MealPlan[]
  runPicks: Pick[]                       // appended in place with the day's created picks
  lockedByCell: Map<string, MealPlan>    // keyed `${date}|${slot}`
  specialDays: Set<string>
  hardDays: Set<string>
  breakfastSpecialDays: Set<string>
  rng: Rng
}): Pick[] {
  const { date, dishesBySlot, dishById, priorPlans, runPicks, lockedByCell, specialDays, hardDays, breakfastSpecialDays, rng } = input
  const created: Pick[] = []
  const mkCtx = (slot: Slot, role: Role, plannedRemaining: number): PickContext => ({
    date, slot, priorPlans, runPicks, dishById, specialDays, hardDays,
    relax: { ...ENFORCED },
    role, spicyFloor: 1, plannedRemaining,
  })
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

  // 1. MAIN
  let main: Dish | undefined
  if (isLocked('utama')) {
    main = lockedDish('utama')
  } else {
    const p = pickForSlot(dishesBySlot.utama ?? [], mkCtx('utama', 'main', 1), rng)
    push(p)
    main = p.dish_id ? dishById.get(p.dish_id) : undefined
  }
  const providesSoup = main?.provides_soup ?? false

  // 2. SAYURAN — always. One more savory pick (the kuah slot) always follows, so plannedRemaining=1.
  if (!isLocked('sayuran')) {
    push(pickForSlot(dishesBySlot.sayuran ?? [], mkCtx('sayuran', 'support', 1), rng))
  }

  // 3. KUAH slot — a soup for a dry main; a SECOND sayuran for a provides_soup main.
  //    A wet main already brings the broth, so a separate soup would be a second soup;
  //    convert the freed slot to an extra vegetable instead (keeping 3 savory components).
  if (!isLocked('kuah')) {
    if (providesSoup) {
      push(secondVegForKuah(dishesBySlot.sayuran ?? [], mkCtx('sayuran', 'support', 0), date, rng))
    } else {
      push(pickForSlot(dishesBySlot.kuah ?? [], mkCtx('kuah', 'support', 0), rng))
    }
  }

  // 4. DESERT — optional
  if (!isLocked('desert')) {
    push(pickForSlot(dishesBySlot.desert ?? [], mkCtx('desert', 'optional', 0), rng))
  }

  // 5. FRUIT (evening) — neutral on every cross-slot axis (protein none, never
  // spicy/fried, saltiness normal, tier always everyday), so the generic
  // dinner picker already does the right thing here with zero new rule code.
  if (!isLocked('fruit')) {
    push(pickForSlot(dishesBySlot.fruit ?? [], mkCtx('fruit', 'optional', 0), rng))
  }

  return created
}
```

Update `generateWeek` to compute and thread `breakfastSpecialDays`:

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
  const lockedByCell = new Map(lockedCells.map(l => [`${l.plan_date}|${l.slot}`, l]))
  const runPicks: Pick[] = lockedCells.map(l => ({
    plan_date: l.plan_date, slot: l.slot, dish_id: l.dish_id, dish_name: l.dish_name,
    locked: true, role: l.role ?? 'support', skipped: l.skipped ?? false,
  }))

  for (const date of days) {
    composeDay({ date, dishesBySlot, dishById, priorPlans, runPicks, lockedByCell, specialDays, hardDays, breakfastSpecialDays, rng })
  }

  const slotOrder = (s: Slot) => SLOTS.indexOf(s)
  return runPicks.sort((a, b) =>
    a.plan_date === b.plan_date ? slotOrder(a.slot) - slotOrder(b.slot)
      : a.plan_date < b.plan_date ? -1 : 1)
}
```

- [ ] **Step 4: Fix the 4 pre-existing `composeDay` call sites in `describe('composeDay (3-component plate)', ...)`**

`composeDay`'s input type now requires `breakfastSpecialDays`. The existing `describe('composeDay (3-component plate)', ...)` block (just above the two new `describe` blocks from Step 1) has 4 call sites that don't go through the new `run()` helper you just added and will now fail to typecheck — add `breakfastSpecialDays: new Set(),` to each:

1. The block's own `run` helper (the one used by the *first* test, `'main that does NOT provide soup...'`) — add the field to its `composeDay({...})` call.
2. The second test, `'main that provides soup...'` — it builds its own inline `composeDay({...})` call (not via `run`); add the field there too.
3. The third test, `'LOCKED provides-soup main (reshuffle case)...'` — same, another standalone inline call.
4. The fourth test, `'provides-soup main with no second veg available...'` — same.

Each just needs `breakfastSpecialDays: new Set(),` added next to its existing `specialDays: new Set(), hardDays: new Set(),` line — none of their assertions change.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run lib/meals/engine.test.ts`
Expected: PASS — every existing and new `composeDay`/`generateWeek` test green.

- [ ] **Step 6: Full suite + typecheck**

Run: `npx tsc --noEmit -p . && npx vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/meals/engine.ts lib/meals/engine.test.ts
git commit -m "feat(meals): wire breakfast + evening fruit into composeDay/generateWeek

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: Engine — `validateWeek` breakfast/fruit checks

**Files:**
- Modify: `lib/meals/engine.ts`
- Test: `lib/meals/engine.test.ts`

**Interfaces:**
- Produces: `validateWeek`'s row type becomes `{ plan_date: string; slot?: Slot; dish_id: string | null; skipped?: boolean }[]` (the `slot` field is optional and additive — every existing call site and test, which never set `slot`, is unaffected).

- [ ] **Step 1: Write the failing tests**

Add to `lib/meals/engine.test.ts`, right after the existing `describe('validateWeek', ...)` block:

```ts
describe('validateWeek (breakfast + evening fruit)', () => {
  it('flags a day with no breakfast planned', () => {
    const byId = new Map<string, Dish>([['bf', dish({ id: 'bf', slot: 'breakfast' })]])
    const rows = [
      { plan_date: '2026-08-17', slot: 'breakfast' as Slot, dish_id: 'bf' },
      { plan_date: '2026-08-18', slot: 'breakfast' as Slot, dish_id: null },
    ]
    const report = validateWeek(rows, byId)
    expect(report.some(v => v.includes('2026-08-18') && v.includes('no breakfast'))).toBe(true)
    expect(report.some(v => v.includes('2026-08-17') && v.includes('no breakfast'))).toBe(false)
  })
  it('flags more than 2 eat-out breakfasts in the week', () => {
    const byId = new Map<string, Dish>([['bf', dish({ id: 'bf', slot: 'breakfast', tier: 'special' })]])
    const rows = ['2026-08-10', '2026-08-13', '2026-08-16'].map(date => ({ plan_date: date, slot: 'breakfast' as Slot, dish_id: 'bf' }))
    const report = validateWeek(rows, byId)
    expect(report.some(v => v.includes('3 eat-out breakfasts'))).toBe(true)
  })
  it('flags eat-out breakfasts on adjacent days', () => {
    const byId = new Map<string, Dish>([['bf', dish({ id: 'bf', slot: 'breakfast', tier: 'special' })]])
    const rows = [
      { plan_date: '2026-08-10', slot: 'breakfast' as Slot, dish_id: 'bf' },
      { plan_date: '2026-08-11', slot: 'breakfast' as Slot, dish_id: 'bf' },
    ]
    const report = validateWeek(rows, byId)
    expect(report.some(v => v.includes('eat-out breakfasts on adjacent days'))).toBe(true)
  })
  it('does not count a special DINNER dish toward the breakfast eat-out quota', () => {
    const byId = new Map<string, Dish>([
      ['bf', dish({ id: 'bf', slot: 'breakfast', tier: 'everyday' })],
      ['dn', dish({ id: 'dn', slot: 'utama', tier: 'special' })],
    ])
    const rows = [
      { plan_date: '2026-08-17', slot: 'breakfast' as Slot, dish_id: 'bf' },
      { plan_date: '2026-08-17', slot: 'utama' as Slot, dish_id: 'dn' },
    ]
    const report = validateWeek(rows, byId)
    expect(report.some(v => v.includes('eat-out breakfast'))).toBe(false)
  })
  it('flags a day with no evening fruit planned', () => {
    const byId = new Map<string, Dish>([['fr', dish({ id: 'fr', slot: 'fruit' })]])
    const rows = [
      { plan_date: '2026-08-17', slot: 'fruit' as Slot, dish_id: 'fr' },
      { plan_date: '2026-08-18', slot: 'fruit' as Slot, dish_id: null },
    ]
    const report = validateWeek(rows, byId)
    expect(report.some(v => v.includes('2026-08-18') && v.includes('no evening fruit'))).toBe(true)
  })
  it('gives an advisory when fewer than 5 of 7 days reach ~2 fruit portions', () => {
    const byId = new Map<string, Dish>([
      ['fr', dish({ id: 'fr', slot: 'fruit', fruit_portions: 1 })],
      ['ds', dish({ id: 'ds', slot: 'desert', fruit_portions: 0 })],
    ])
    const rows = WEEK.flatMap(date => [
      { plan_date: date, slot: 'fruit' as Slot, dish_id: 'fr' },
      { plan_date: date, slot: 'desert' as Slot, dish_id: 'ds' },
    ])
    const report = validateWeek(rows, byId)
    expect(report.some(v => v.includes('0 of 7 days reach ~2 fruit portions'))).toBe(true)
  })
  it('gives no advisory when most days reach ~2 fruit portions', () => {
    const byId = new Map<string, Dish>([
      ['fr', dish({ id: 'fr', slot: 'fruit', fruit_portions: 1 })],
      ['ds', dish({ id: 'ds', slot: 'desert', fruit_portions: 1 })],
    ])
    const rows = WEEK.flatMap(date => [
      { plan_date: date, slot: 'fruit' as Slot, dish_id: 'fr' },
      { plan_date: date, slot: 'desert' as Slot, dish_id: 'ds' },
    ])
    const report = validateWeek(rows, byId)
    expect(report.some(v => v.includes('fruit portions'))).toBe(false)
  })
  it("does not couple a salty/fried breakfast dish into dinner's per-day caps", () => {
    const byId = new Map<string, Dish>([
      ['bf', dish({ id: 'bf', slot: 'breakfast', saltiness: 'salty', method: 'fried' })],
      ['dn', dish({ id: 'dn', slot: 'utama', saltiness: 'salty' })],
    ])
    const rows = [
      { plan_date: '2026-08-17', slot: 'breakfast' as Slot, dish_id: 'bf' },
      { plan_date: '2026-08-17', slot: 'utama' as Slot, dish_id: 'dn' },
    ]
    const report = validateWeek(rows, byId)
    expect(report.some(v => v.includes('salty'))).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/meals/engine.test.ts -t "breakfast \+ evening fruit\)"`
Expected: FAIL — none of these checks exist yet (the salty-coupling test currently *passes* by accident since no breakfast rows exist at all today; after Step 3 it must keep passing for the right reason).

- [ ] **Step 3: Implement in `lib/meals/engine.ts`**

Change `validateWeek`'s signature and byDate-building loop:

```ts
export function validateWeek(
  rows: { plan_date: string; slot?: Slot; dish_id: string | null; skipped?: boolean }[],
  dishById: Map<string, Dish>,
): string[] {
  const viol: string[] = []
  const byDate = new Map<string, Dish[]>()
  for (const r of rows) {
    if (!r.dish_id || r.skipped) continue
    if (r.slot === 'breakfast' || r.slot === 'fruit') continue // independent of dinner's cross-slot checks
    const d = dishById.get(r.dish_id)
    if (!d) continue
    if (!byDate.has(r.plan_date)) byDate.set(r.plan_date, [])
    byDate.get(r.plan_date)!.push(d)
  }
  // ... everything from here down through the spicyMainDates loop is UNCHANGED ...
```

Then, immediately before the function's final `return viol`, add:

```ts
  // --- Breakfast: one per day, <=2 eat-out, non-adjacent (own independent quota) ---
  const allDates = [...new Set(rows.map(r => r.plan_date))].sort()
  const breakfastRows = rows.filter(r => r.slot === 'breakfast')
  if (breakfastRows.length) {
    for (const date of allDates) {
      const planned = breakfastRows.some(r => r.plan_date === date && r.dish_id && !r.skipped)
      if (!planned) viol.push(`⚠️ ${date}: no breakfast planned`)
    }
    const treatDates = [...new Set(breakfastRows
      .filter(r => r.dish_id && !r.skipped && dishById.get(r.dish_id!)?.tier === 'special')
      .map(r => r.plan_date))].sort()
    if (treatDates.length > 2) viol.push(`⚠️ week: ${treatDates.length} eat-out breakfasts (${treatDates.join(', ')})`)
    if (hasAdjacent(treatDates)) viol.push(`⚠️ week: eat-out breakfasts on adjacent days (${treatDates.join(', ')})`)
  }

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
```

This block goes *after* the existing `hasAdjacent` local function is defined (it already exists mid-function for the `hardDates`/`specialDates` checks — reuse it, don't redefine it) and after the existing `spicyMainDates` loop.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/meals/engine.test.ts -t "validateWeek"`
Expected: PASS, including all pre-existing `validateWeek` cases (they never set `slot`, so `breakfastRows`/`fruitRows` are empty and both new blocks are skipped) and the new ones.

- [ ] **Step 5: Full suite + typecheck**

Run: `npx tsc --noEmit -p . && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/meals/engine.ts lib/meals/engine.test.ts
git commit -m "feat(meals): validateWeek checks for breakfast quota + evening fruit

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: Wire the generate/reroll API routes

**Files:**
- Modify: `app/api/meals/generate/route.ts`
- Modify: `app/api/meals/reroll/route.ts`

**Interfaces:**
- Consumes: `pickBreakfast`, `breakfastCandidates` (Task 4), `validateWeek` (Task 6, already imported).
- Produces: `POST /api/meals/generate` response gains `report: string[]`. `POST /api/meals/reroll` and `GET /api/meals/reroll` both correctly handle `slot: 'breakfast'` (bespoke branch) and `slot: 'fruit'` (falls through the existing generic path unchanged).

- [ ] **Step 1: Add the validation report to the generate route**

In `app/api/meals/generate/route.ts`, replace:

```ts
  const picks = generateWeek({ weekStart, days, dishesBySlot, allDishes, priorPlans, lockedCells, rng })

  // Dev-only self-audit: log any rule violations in the freshly composed week.
  if (process.env.NODE_ENV !== 'production') {
    const dishById = new Map(allDishes.map(d => [d.id, d]))
    const report = validateWeek(picks, dishById)
    if (report.length) console.warn(`[meal-gen] ${weekStart} rule violations:\n` + report.join('\n'))
    else console.log(`[meal-gen] ${weekStart} validation: clean ✓`)
  }
```

with:

```ts
  const picks = generateWeek({ weekStart, days, dishesBySlot, allDishes, priorPlans, lockedCells, rng })

  const dishById = new Map(allDishes.map(d => [d.id, d]))
  const report = validateWeek(picks, dishById)
  if (process.env.NODE_ENV !== 'production') {
    if (report.length) console.warn(`[meal-gen] ${weekStart} rule violations:\n` + report.join('\n'))
    else console.log(`[meal-gen] ${weekStart} validation: clean ✓`)
  }
```

And change the final return:

```ts
  const { data: week } = await supabase
    .from('meal_plans')
    .select('*, dishes(tier, spicy, richness, provides_soup, recipe_image_url, protein, saltiness, difficulty, method, slot, recipe_links, qty_amount, qty_unit, qty_note, veg_portions, fruit_portions)')
    .gte('plan_date', days[0]).lte('plan_date', days[6])
  return Response.json({ week: (week ?? []) as MealPlan[], report })
```

(`dishesBySlot`'s construction, `Object.fromEntries(SLOTS.map(s => [s, allDishes.filter(d => d.slot === s)]))`, already generically includes `breakfast`/`fruit` once `SLOTS` was widened in Task 1 — no change needed there.)

- [ ] **Step 2: Extend `roleForSlot` in the reroll route**

In `app/api/meals/reroll/route.ts`, replace:

```ts
function roleForSlot(slot: Slot): Role {
  return slot === 'utama' ? 'main' : slot === 'desert' ? 'optional' : 'support'
}
```

with:

```ts
function roleForSlot(slot: Slot): Role {
  return slot === 'utama' ? 'main'
    : slot === 'breakfast' ? 'breakfast'
    : (slot === 'desert' || slot === 'fruit') ? 'optional'
    : 'support'
}
```

- [ ] **Step 3: Add `deriveBreakfastSpecialDays` + a shared breakfast-context builder**

Add these right after the existing `deriveDays` function:

```ts
// Breakfast's already-committed special-day assignment, reconstructed from
// this week's saved plans — independent of deriveDays (dinner's specialDays).
function deriveBreakfastSpecialDays(week: string[], plans: MealPlan[], dishById: Map<string, Dish>): Set<string> {
  return new Set(week.filter(d => plans.some(p =>
    p.plan_date === d && p.slot === 'breakfast' && dishById.get(p.dish_id ?? '')?.tier === 'special')))
}

// Shared context for a single-cell breakfast reroll/alternatives lookup —
// used by both the POST reroll branch and the GET alternatives branch below.
function buildBreakfastContext(plan_date: string, allDishes: Dish[], plans: MealPlan[], week: string[]) {
  const dishById = new Map(allDishes.map(d => [d.id, d]))
  const weekSet = new Set(week)
  const breakfastSpecialDays = deriveBreakfastSpecialDays(week, plans, dishById)
  const runPicks = plans
    .filter(p => weekSet.has(p.plan_date) && !(p.plan_date === plan_date && p.slot === 'breakfast'))
    .map(p => ({ plan_date: p.plan_date, slot: p.slot as Slot, dish_id: p.dish_id, dish_name: p.dish_name,
      locked: p.locked, role: (p.role ?? 'breakfast') as Role, skipped: p.skipped ?? false }))
  const priorPlans = plans.filter(p => !weekSet.has(p.plan_date))
  const ctx: PickContext = {
    date: plan_date, slot: 'breakfast', priorPlans, runPicks, dishById,
    specialDays: new Set(), hardDays: new Set(),
    relax: { spicy: false, fried: false, hardDay: false, hardSpacing: false, proteinClash: false, spicyMainSpacing: false, noRepeatFactor: 1 },
    role: 'breakfast', spicyFloor: 1, plannedRemaining: 0,
  }
  const breakfastPool = allDishes.filter(d => d.slot === 'breakfast')
  return { ctx, breakfastPool, isSpecialDay: breakfastSpecialDays.has(plan_date) }
}
```

Update the top import line to pull in the two new engine functions:

```ts
import { candidates, composeDay, pickForSlot, pickBreakfast, breakfastCandidates, weightFor, type PickContext } from '@/lib/meals/engine'
```

- [ ] **Step 4: Add the breakfast branch to the POST handler**

Insert this block right after the existing `if (slot === 'utama') { ... }` branch and before the `// ---- SUPPORT / OPTIONAL reroll → swap one ----` comment:

```ts
  // ---- BREAKFAST reroll → independent pick honoring the week's breakfast quota ----
  if (slot === 'breakfast') {
    const { week, allDishes, plans } = await loadWeek(plan_date)
    if (body.dish_id) {
      const d = allDishes.find(x => x.id === body.dish_id)
      if (!d) return Response.json({ error: 'dish not found' }, { status: 404 })
      const { data, error } = await supabase.from('meal_plans')
        .upsert({ plan_date, slot: 'breakfast', dish_id: d.id, dish_name: d.name, locked: false, role: 'breakfast', skipped: false },
          { onConflict: 'plan_date,slot' }).select(SELECT).single()
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ pick: data as MealPlan })
    }
    const { ctx, breakfastPool, isSpecialDay } = buildBreakfastContext(plan_date, allDishes, plans, week)
    const p = pickBreakfast(breakfastPool, ctx, isSpecialDay, rng)
    const { data, error } = await supabase.from('meal_plans')
      .upsert({ plan_date, slot: 'breakfast', dish_id: p.dish_id, dish_name: p.dish_name, locked: false, role: 'breakfast', skipped: false },
        { onConflict: 'plan_date,slot' }).select(SELECT).single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ pick: data as MealPlan })
  }
```

- [ ] **Step 5: Add the breakfast branch to the GET (alternatives) handler**

In the `GET` function, right after `const { week, allDishes, plans } = await loadWeek(plan_date)`, insert:

```ts
  if (slot === 'breakfast') {
    const { ctx, breakfastPool, isSpecialDay } = buildBreakfastContext(plan_date, allDishes, plans, week)
    const pool = breakfastCandidates(breakfastPool, ctx, isSpecialDay)
      .map(d => ({ d, w: weightFor(d, ctx) }))
      .sort((a, b) => b.w - a.w)
      .slice(0, n)
      .map(({ d }) => ({ id: d.id, name: d.name }))
    return Response.json({ alternatives: pool })
  }
```

(before the existing `const poolSlot = poolSlotFor(slot, plan_date, plans, allDishes)` line — that generic path continues to serve every other slot, `fruit` included, unchanged).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: PASS, 0 errors.

- [ ] **Step 7: Manually verify against the dev server**

```bash
npm run dev &
sleep 2
COOKIE='hs_session={"id":"test","name":"Test","phone":"+10000000000"}'
DATE=$(date -v+7d +%F 2>/dev/null || date -d '+7 days' +%F)  # a date unlikely to already have plans

# generate a week and confirm the response includes a report array
curl -s -X POST -H "Cookie: $COOKIE" -H "content-type: application/json" \
  -d "{\"weekStart\":\"$DATE\"}" http://localhost:3000/api/meals/generate | node -e "
    let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{
      const j = JSON.parse(d);
      console.log('report:', j.report);
      console.log('breakfast rows:', j.week.filter(r=>r.slot==='breakfast').length);
      console.log('fruit rows:', j.week.filter(r=>r.slot==='fruit').length);
    })"

# single-slot breakfast reroll + alternatives
curl -s "http://localhost:3000/api/meals/reroll?plan_date=$DATE&slot=breakfast&alternatives=5" -H "Cookie: $COOKIE"
curl -s -X POST -H "Cookie: $COOKIE" -H "content-type: application/json" \
  -d "{\"plan_date\":\"$DATE\",\"slot\":\"breakfast\"}" http://localhost:3000/api/meals/reroll
```

Expected: `report` is an array (empty on a clean week); `breakfast rows`/`fruit rows` both print `1` (assuming `$DATE` lands on a Monday matching a full week — if not exactly 7, run it for the actual week start the route resolves and check per-day, or just eyeball the printed counts are sane); the alternatives call returns a list of `{id,name}` breakfast dishes; the reroll POST returns a `pick` with `slot: 'breakfast'`. Stop the dev server afterward.

- [ ] **Step 8: Commit**

```bash
git add app/api/meals/generate/route.ts app/api/meals/reroll/route.ts
git commit -m "feat(meals): wire breakfast reroll + validation report into the API routes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: Week overview — fruit tally + breakfast-treats signals

**Files:**
- Modify: `lib/meals/overview.ts`
- Test: `lib/meals/overview.test.ts`

**Interfaces:**
- Produces: `computeWeekOverview`'s `signals` array drops the `🍚` placeholder and gains `🍎` (fruit tally) and `🌅` (breakfast treats) signals — 9 signals total instead of 8.

- [ ] **Step 1: Update the existing placeholder test and add new tests**

In `lib/meals/overview.test.ts`, replace the existing test:

```ts
  it('always includes the calories placeholder', () => {
    const o = computeWeekOverview([mainRow('2026-08-11', {})])
    expect(o.signals.find(s => s.emoji === '🍚')!.detail).toMatch(/coming soon/i)
  })
```

with:

```ts
  it('no longer shows the calories placeholder', () => {
    const o = computeWeekOverview([mainRow('2026-08-11', {})])
    expect(o.signals.some(s => s.emoji === '🍚')).toBe(false)
  })
```

Add, right after the `D` constant and before `describe('computeWeekOverview', ...)`:

```ts
function fruitRow(date: string, slot: 'fruit' | 'desert', fruitPortions: number): MealPlan {
  return row({ plan_date: date, slot, role: 'optional', dishes: meta({ fruit_portions: fruitPortions }) })
}
function breakfastRow(date: string, tier: 'everyday' | 'special' = 'everyday'): MealPlan {
  return row({ plan_date: date, slot: 'breakfast', role: 'breakfast', dishes: meta({ tier }) })
}
```

Add, inside `describe('computeWeekOverview', ...)`, after the existing "flags two same-protein mains" test:

```ts
  it('replaces the placeholder with a fruit tally (days hitting ~2 fruit portions)', () => {
    const rows = [
      ...D.map(d => fruitRow(d, 'fruit', 1)),
      ...D.slice(0, 5).map(d => fruitRow(d, 'desert', 1)), // 5 days total 2, 2 days total 1
    ]
    const o = computeWeekOverview(rows)
    const fruit = o.signals.find(s => s.emoji === '🍎')!
    expect(fruit.detail).toMatch(/5 of 7 days/)
    expect(fruit.status).toBe('good')
  })
  it('marks a low fruit tally as neutral', () => {
    const rows = D.slice(0, 2).map(d => fruitRow(d, 'fruit', 1))
    const o = computeWeekOverview(rows)
    expect(o.signals.find(s => s.emoji === '🍎')!.status).toBe('neutral')
  })
  it('reports 2 eat-out breakfasts as good', () => {
    const rows = [breakfastRow('2026-08-11', 'special'), breakfastRow('2026-08-14', 'special'), breakfastRow('2026-08-12', 'everyday')]
    const o = computeWeekOverview(rows)
    const breakfast = o.signals.find(s => s.emoji === '🌅')!
    expect(breakfast.detail).toMatch(/2 eat-out breakfasts/)
    expect(breakfast.status).toBe('good')
  })
  it('reports no eat-out breakfasts when the week has none', () => {
    const rows = D.map(d => breakfastRow(d, 'everyday'))
    const o = computeWeekOverview(rows)
    expect(o.signals.find(s => s.emoji === '🌅')!.detail).toMatch(/No eat-out breakfasts/)
    expect(o.signals.find(s => s.emoji === '🌅')!.status).toBe('neutral')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/meals/overview.test.ts`
Expected: FAIL — `🍎`/`🌅` signals don't exist; the updated placeholder test fails because `🍚` still exists.

- [ ] **Step 3: Implement in `lib/meals/overview.ts`**

Replace the existing:

```ts
  // 8. Placeholder
  const calories: Signal = { emoji: '🍚', label: 'Portions & calories', detail: 'coming soon', status: 'neutral' }
```

with:

```ts
  // 8. Fruit tally — desert + evening fruit portions summed per day
  const fruitByDay = dates.map(d => planned
    .filter(r => r.plan_date === d && (r.slot === 'fruit' || r.slot === 'desert'))
    .reduce((n, r) => n + (r.dishes?.fruit_portions ?? 0), 0))
  const daysHitting2 = fruitByDay.filter(n => n >= 2).length
  const fruit: Signal = {
    emoji: '🍎', label: 'Fruit tally',
    detail: `${daysHitting2} of ${dates.length} days hit ~2 fruit portions`,
    status: daysHitting2 >= 5 ? 'good' : 'neutral',
  }

  // 9. Breakfast treats — independent eat-out quota
  const breakfastRows = planned.filter(r => r.slot === 'breakfast')
  const bfTreatDates = [...new Set(breakfastRows.filter(r => r.dishes?.tier === 'special').map(r => r.plan_date))]
  const breakfast: Signal = {
    emoji: '🌅', label: 'Breakfast treats',
    detail: bfTreatDates.length === 0 ? 'No eat-out breakfasts this week'
      : `${bfTreatDates.length} eat-out breakfast${bfTreatDates.length > 1 ? 's' : ''} this week (${list(bfTreatDates)})`,
    status: bfTreatDates.length === 2 ? 'good' : 'neutral',
  }
```

And update the final return statement:

```ts
  return { hasPlan: true, verdict, summary, signals: [spicy, special, difficulty, saltiness, fried, protein, soup, fruit, breakfast] }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/meals/overview.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Full suite + typecheck**

Run: `npx tsc --noEmit -p . && npx vitest run`
Expected: PASS. (`components/meals/WeekOverview.tsx` needs no change — it already renders `overview.signals` generically via `.map()`.)

- [ ] **Step 6: Commit**

```bash
git add lib/meals/overview.ts lib/meals/overview.test.ts
git commit -m "feat(meals): week overview gets fruit-tally + breakfast-treats signals

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: `StaplesBanner` + wiring into the Plan page

**Files:**
- Create: `components/meals/StaplesBanner.tsx`
- Modify: `app/meals/page.tsx`
- Modify: `components/meals/PlanClient.tsx`

**Interfaces:**
- Consumes: `DailyStaple` (Task 1), `formatStaplesLine` (Task 2), the staples CRUD routes (Task 3).
- Produces: `<StaplesBanner initialStaples={DailyStaple[]} />`, mounted once in `PlanClient`. `PlanClient`'s props gain `initialStaples: DailyStaple[]`.

- [ ] **Step 1: Build `StaplesBanner.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { Pencil, X, Plus, Trash2 } from 'lucide-react'
import type { DailyStaple } from '@/lib/meals/types'
import { formatStaplesLine } from '@/lib/meals/staples'

export default function StaplesBanner({ initialStaples }: { initialStaples: DailyStaple[] }) {
  const [staples, setStaples] = useState<DailyStaple[]>(initialStaples)
  const [editing, setEditing] = useState(false)

  async function patch(id: string, fields: Partial<DailyStaple>) {
    const prev = staples
    setStaples(s => s.map(x => x.id === id ? { ...x, ...fields } : x))
    const res = await fetch(`/api/meals/staples/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fields),
    })
    if (!res.ok) setStaples(prev)
  }
  async function add() {
    const res = await fetch('/api/meals/staples', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'New staple', person: '' }),
    })
    if (res.ok) { const s = await res.json() as DailyStaple; setStaples(prev => [...prev, s]) }
  }
  async function remove(id: string) {
    const prev = staples
    setStaples(s => s.filter(x => x.id !== id))
    const res = await fetch(`/api/meals/staples/${id}`, { method: 'DELETE' })
    if (!res.ok) setStaples(prev)
  }

  if (staples.length === 0 && !editing) return null

  return (
    <div className="mb-4 bg-white border border-stone-200 rounded-xl px-4 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-stone-600 min-w-0 truncate">
          🥛 Daily: <span className="text-stone-500">{formatStaplesLine(staples) || 'No staples yet'}</span>
        </div>
        <button onClick={() => setEditing(e => !e)} className="shrink-0 p-1 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100" aria-label="Edit daily staples">
          {editing ? <X size={14} /> : <Pencil size={14} />}
        </button>
      </div>
      {editing && (
        <div className="mt-2.5 pt-2.5 border-t border-stone-100 space-y-1.5">
          {staples.map(s => <StapleRow key={s.id} staple={s} onPatch={patch} onRemove={remove} />)}
          <button onClick={add} className="flex items-center gap-1 text-xs text-orange-600 hover:text-orange-700">
            <Plus size={13} /> Add staple
          </button>
        </div>
      )}
    </div>
  )
}

function StapleRow({ staple, onPatch, onRemove }: {
  staple: DailyStaple
  onPatch: (id: string, fields: Partial<DailyStaple>) => void
  onRemove: (id: string) => void
}) {
  const [person, setPerson] = useState(staple.person)
  const [name, setName] = useState(staple.name)
  return (
    <div className="flex items-center gap-1.5">
      <input value={person} onChange={e => setPerson(e.target.value)}
        onBlur={() => person.trim() !== staple.person && onPatch(staple.id, { person: person.trim() })}
        placeholder="Person" className="w-24 px-2 py-1 rounded-lg border border-stone-200 text-xs focus:outline-none focus:border-orange-300" />
      <input value={name} onChange={e => setName(e.target.value)}
        onBlur={() => name.trim() !== staple.name && onPatch(staple.id, { name: name.trim() })}
        placeholder="Item" className="flex-1 min-w-0 px-2 py-1 rounded-lg border border-stone-200 text-xs focus:outline-none focus:border-orange-300" />
      <button onClick={() => onRemove(staple.id)} className="p-1 text-stone-300 hover:text-red-500 shrink-0" aria-label={`Remove ${staple.name}`}>
        <Trash2 size={13} />
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Fetch staples in the page and pass them down**

Edit `app/meals/page.tsx`:

```tsx
export const dynamic = 'force-dynamic'

import { supabase } from '@/lib/supabase'
import { weekDates } from '@/lib/meals/dates'
import { reconcileSoup } from '@/lib/meals/reconcile'
import type { DailyStaple, MealPlan } from '@/lib/meals/types'
import PlanClient from '@/components/meals/PlanClient'

function currentMonday(): string {
  const now = new Date()
  const dow = (now.getDay() + 6) % 7
  now.setDate(now.getDate() - dow)
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export default async function MealsPlanPage() {
  const weekStart = currentMonday()
  const days = weekDates(weekStart)
  const [{ data }, { data: staplesData }] = await Promise.all([
    supabase.from('meal_plans').select('*, dishes(tier, spicy, richness, provides_soup, recipe_image_url, protein, saltiness, difficulty, method, slot, recipe_links, qty_amount, qty_unit, qty_note, veg_portions, fruit_portions)')
      .gte('plan_date', days[0]).lte('plan_date', days[6]),
    supabase.from('daily_staples').select('*').order('person'),
  ])
  const initialWeek = await reconcileSoup((data ?? []) as MealPlan[])
  return <PlanClient initialWeekStart={weekStart} initialWeek={initialWeek} initialStaples={(staplesData ?? []) as DailyStaple[]} />
}
```

- [ ] **Step 3: Mount the banner in `PlanClient`**

In `components/meals/PlanClient.tsx`, update the import and the component signature:

```tsx
import { SLOT_LABELS, type DailyStaple, type MealPlan, type Slot, type Tier } from '@/lib/meals/types'
```

```tsx
import StaplesBanner from './StaplesBanner'
```

```tsx
export default function PlanClient({ initialWeekStart, initialWeek, initialStaples }:
  { initialWeekStart: string; initialWeek: MealPlan[]; initialStaples: DailyStaple[] }) {
```

And render it once, right after the week-nav/actions row and before the day grid:

```tsx
      <StaplesBanner initialStaples={initialStaples} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 5: Manually verify in the browser**

```bash
npm run dev &
sleep 2
```

Open a browser (or use the Playwright MCP tools if available), set the `hs_session` cookie the same way as prior manual UI checks in this app (see git history for the pattern: fetch a real user id from `users` via the anon key, then `document.cookie = 'hs_session=' + encodeURIComponent(JSON.stringify({id,name,phone})) + '; path=/'`), navigate to `/meals`, and confirm:
- The banner shows `🥛 Daily: Son Susu (milk) · Kevin & Wife Susu / yogurt` (or similar, grouped) above the day grid.
- Clicking the pencil icon expands an editable list of the 3 seeded rows plus an "Add staple" button.
- Editing a person/item field and blurring persists (reload the page and confirm the change stuck).
- Adding a staple and then removing it round-trips correctly (reload and confirm it's gone).

Stop the dev server afterward.

- [ ] **Step 6: Commit**

```bash
git add components/meals/StaplesBanner.tsx app/meals/page.tsx components/meals/PlanClient.tsx
git commit -m "feat(meals): daily-staples banner with inline editing

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 10: Day-card restructuring — breakfast strip, fruit row, generation report

**Files:**
- Modify: `components/meals/PlanClient.tsx`

**Interfaces:**
- Produces: each day card now shows, top to bottom: breakfast strip → dinner hero+supports (unchanged) → fruit row (desert + evening fruit) → day total (unchanged) → mark-cooked/edit (unchanged). `generate()` shows a dismissible validation-report banner.

- [ ] **Step 1: Fix the desert/fruit row lookups in `DayPlate`**

Both `desert` and the new evening-`fruit` row share `role === 'optional'` (Task 1's role mapping), so the existing `role === 'optional'` lookup is now ambiguous. Replace:

```tsx
  const main = rows.find(r => r.role === 'main')
  const supports = rows.filter(r => r.role === 'support' && r.dish_id)
  const soupSkipped = rows.some(r => r.slot === 'kuah' && r.skipped)
  const desert = rows.find(r => r.role === 'optional')
```

with:

```tsx
  const breakfast = rows.find(r => r.slot === 'breakfast')
  const main = rows.find(r => r.role === 'main')
  const supports = rows.filter(r => r.role === 'support' && r.dish_id)
  const soupSkipped = rows.some(r => r.slot === 'kuah' && r.skipped)
  const desert = rows.find(r => r.slot === 'desert')
  const eveningFruit = rows.find(r => r.slot === 'fruit')
```

- [ ] **Step 2: Render the breakfast strip and the fruit row**

Replace:

```tsx
      {main
        ? <MainHero row={main} date={date} onReroll={rerollMain} onReplaceCell={onReplaceCell} />
        : <div className="aspect-video rounded-xl bg-gradient-to-br from-stone-100 to-orange-50 flex items-center justify-center text-3xl text-stone-300">🍽️</div>}
```

with:

```tsx
      {breakfast && <BreakfastStrip row={breakfast} date={date} onReplaceCell={onReplaceCell} />}

      {main
        ? <MainHero row={main} date={date} onReroll={rerollMain} onReplaceCell={onReplaceCell} />
        : <div className="aspect-video rounded-xl bg-gradient-to-br from-stone-100 to-orange-50 flex items-center justify-center text-3xl text-stone-300">🍽️</div>}
```

And replace:

```tsx
      {desert && <DesertRow row={desert} date={date} onReplaceCell={onReplaceCell} />}
```

with:

```tsx
      {(desert || eveningFruit) && (
        <div className="flex flex-col gap-1">
          {desert && <FruitLine row={desert} label="desert" date={date} onReplaceCell={onReplaceCell} />}
          {eveningFruit && <FruitLine row={eveningFruit} label="evening" date={date} onReplaceCell={onReplaceCell} />}
        </div>
      )}
```

- [ ] **Step 3: Add `BreakfastStrip` and rename `DesertRow` → `FruitLine`**

Replace the entire `DesertRow` function (currently the last function in the file) with:

```tsx
function BreakfastStrip({ row, date, onReplaceCell }: { row: MealPlan; date: string; onReplaceCell: (r: MealPlan) => void }) {
  const { open, setOpen, alts, openAlts, toggleLock } = useCellControls(date, row, onReplaceCell)
  const qty = qtyDisplay(row.dishes)
  const isTreat = row.dishes?.tier === 'special'
  async function swap(dishId?: string) {
    const res = await fetch('/api/meals/reroll', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan_date: date, slot: 'breakfast', ...(dishId ? { dish_id: dishId } : {}) }),
    })
    if (res.ok) { const { pick } = await res.json(); onReplaceCell(pick) }
    setOpen(false)
  }
  return (
    <div className="relative flex items-center justify-between gap-2 bg-stone-50 border border-stone-200 rounded-xl px-2.5 py-1.5">
      <Link href={row.dish_id ? `/meals/dish/${row.dish_id}` : '#'} aria-label={`View recipe for ${row.dish_name}`}
        className="min-w-0 flex items-center gap-1.5 text-xs text-stone-700 hover:text-stone-900">
        <span className="shrink-0">🌅</span>
        <span className="truncate">{row.dish_name ?? '—'}</span>
        {isTreat && <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-medium bg-orange-100 text-orange-700">eat-out</span>}
        {qty && <span className="shrink-0 text-stone-400">· {qty}</span>}
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

function FruitLine({ row, label, date, onReplaceCell }: { row: MealPlan; label: string; date: string; onReplaceCell: (r: MealPlan) => void }) {
  const { open, setOpen, alts, openAlts, toggleLock } = useCellControls(date, row, onReplaceCell)
  const qty = qtyDisplay(row.dishes)
  async function swap(dishId?: string) {
    const res = await fetch('/api/meals/reroll', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan_date: date, slot: row.slot, ...(dishId ? { dish_id: dishId } : {}) }),
    })
    if (res.ok) { const { pick } = await res.json(); onReplaceCell(pick) }
    setOpen(false)
  }
  return (
    <div className="relative flex items-center justify-between text-xs text-stone-400 border-t border-stone-100 pt-2">
      <Link href={row.dish_id ? `/meals/dish/${row.dish_id}` : '#'} className="truncate hover:text-stone-600">
        · {label}: <span className="text-stone-500">{row.dish_name}</span>{qty && <span> · {qty}</span>}
      </Link>
      <div className="flex gap-0.5 shrink-0">
        <RecipeLinkButton row={row} onReplaceCell={onReplaceCell} />
        <button onClick={toggleLock} className={`p-0.5 ${row.locked ? 'text-orange-600' : 'text-stone-300 hover:text-stone-600'}`}>{row.locked ? <Lock size={11} /> : <Unlock size={11} />}</button>
        <button onClick={openAlts} className="p-0.5 text-stone-300 hover:text-stone-600"><Shuffle size={11} /></button>
      </div>
      {open && (
        <div className="absolute z-20 right-0 top-full mt-1 w-40 bg-white border border-stone-200 rounded-xl shadow-lg p-1">
          <button onClick={() => swap()} className="w-full text-left px-2 py-1 rounded-lg hover:bg-orange-50 text-orange-700 text-xs">🎲 Surprise me</button>
          {alts?.map(a => <button key={a.id} onClick={() => swap(a.id)} className="w-full text-left px-2 py-1 rounded-lg hover:bg-stone-50 text-stone-700 text-xs truncate">{a.name}</button>)}
          <button onClick={() => setOpen(false)} className="w-full text-left px-2 py-1 rounded-lg text-stone-400 text-xs">Cancel</button>
        </div>
      )}
    </div>
  )
}
```

(This is the old `DesertRow` renamed to `FruitLine` with a `label` prop, and `slot: 'desert'` in its reroll body replaced by the generic `row.slot` — identical pattern to `SupportChip`'s swap function.)

- [ ] **Step 4: Show the generation report as a dismissible banner**

Add state near the other `useState` calls in `PlanClient`:

```tsx
  const [genReport, setGenReport] = useState<string[] | null>(null)
```

Update `generate()`:

```tsx
  async function generate() {
    setGenerating(true)
    setGenReport(null)
    try {
      const res = await fetch('/api/meals/generate', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ weekStart }),
      })
      const { week, report } = await res.json(); setWeek(week ?? [])
      setGenReport(report ?? [])
      loadCookLog(weekStart)
    } finally { setGenerating(false) }
  }
```

Render the banner right after `<StaplesBanner .../>` and before the day grid:

```tsx
      {genReport && (
        <div className={`mb-4 px-4 py-2.5 rounded-xl text-sm ${genReport.length === 0 ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-amber-50 text-amber-800 border border-amber-200'}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{genReport.length === 0 ? '✓ Week validated' : `${genReport.length} thing${genReport.length > 1 ? 's' : ''} to note`}</span>
            <button onClick={() => setGenReport(null)} className="text-xs opacity-60 hover:opacity-100">Dismiss</button>
          </div>
          {genReport.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs">
              {genReport.map((line, i) => <li key={i}>{line}</li>)}
            </ul>
          )}
        </div>
      )}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: PASS. (Confirm no remaining reference to `DesertRow` anywhere in the file.)

- [ ] **Step 6: Manually verify in the browser**

```bash
npm run dev &
sleep 2
```

Using the same session-cookie technique as Task 9, navigate to `/meals`, click **Generate Week**, and confirm:
- Each day card shows a compact breakfast strip above the dinner hero (with an "eat-out" pill on the ≤2 special days).
- The fruit row shows both `· desert: ...` and `· evening: ...` lines.
- The validation banner appears after generating (green "✓ Week validated" on a clean week, or the specific amber lines otherwise) and dismisses on click.
- Lock/reroll icons on the breakfast strip and both fruit lines work (click reroll, confirm the dish changes; click lock, confirm the day-level lock now covers 9 rows not 7).
- Take a screenshot at mobile width (~390px) and confirm the card stays legible with the added rows.

Stop the dev server afterward.

- [ ] **Step 7: Commit**

```bash
git add components/meals/PlanClient.tsx
git commit -m "feat(meals): restructure day cards for breakfast strip + fruit row + gen report

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 11: Final integration verification

**Files:** none (verification only)

- [ ] **Step 1: Full automated check**

Run: `npx tsc --noEmit -p . && npx vitest run`
Expected: PASS, 0 errors, all tests green.

- [ ] **Step 2: Dishes editor — confirm Breakfast/Fruit sections appeared for free**

```bash
npm run dev &
sleep 2
```

Navigate to `/meals/dishes` (same session-cookie technique as prior tasks). Confirm:
- "Breakfast" and "Fruit" tabs/section headers appear (from `SLOTS`/`SLOT_LABELS` alone — no code change was needed for this).
- Each section lists its seeded dishes (9 breakfast, 4 fruit) with working inline edit (tier, rating, qty amount/unit/note) and "+ Add dish"/delete.
- The "Soup" toggle column shows `—` (not a toggle) for both new slots, same as any non-`utama` slot today.

- [ ] **Step 3: Shopping list — confirm breakfast/fruit dishes with ingredients are included**

Generate a week (from `/meals`), then click "Build shopping list" and open `/meals/shopping`. Confirm any breakfast/fruit dishes that have `ingredients` set contribute to the aggregated list, and any without ingredients appear in the "Dishes this week" fallback section with their `qty_amount`/`qty_unit` — this is automatic (the shopping routes already select `meal_plans` and `dishes` generically, with no slot filtering), so this step is confirmation, not new code.

- [ ] **Step 4: End-to-end generate + validate**

On `/meals`, generate a week and confirm the on-screen report plus a manual read of the resulting week satisfies the spec's validation checklist:
- Exactly one breakfast per day.
- ≤2 eat-out (special-tier) breakfasts for the week, and not on adjacent days.
- Evening fruit present every day.
- Most days (check the Week Overview's 🍎 signal) reach ~2 total fruit portions.
- The 🥛 daily-staples banner is visible.

- [ ] **Step 5: Stop the dev server and clean up any scratch files**

```bash
kill %1 2>/dev/null || true
```

Confirm `git status` shows no stray screenshot/log files left in the repo root.

- [ ] **Step 6: Final commit (if any cleanup was needed)**

Only if Step 5 found something to clean up:

```bash
git add -A
git commit -m "chore(meals): final verification pass for breakfast/fruit/staples

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
