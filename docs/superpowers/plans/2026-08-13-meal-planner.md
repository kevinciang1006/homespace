# Meal Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/meals` sub-app that generates a rule-respecting weekly meal plan (5 slots × 7 days) from 94 seeded dishes, with per-cell lock/re-roll and an editable dish library.

**Architecture:** A pure, framework-free generation engine (`lib/meals/engine.ts`) holds all algorithm logic and is unit-tested with Vitest. Next.js route handlers own Supabase reads/writes and call the engine with plain data. Server components fetch initial data and pass it to `'use client'` components that do optimistic mutations — the established Homespace pattern (`ShoppingClient`).

**Tech Stack:** Next.js 16.2.4 (App Router), TypeScript (strict), Tailwind v4, Supabase JS (anon key, `lib/supabase.ts`), lucide-react, Vitest (new dev dep).

## Global Constraints

- **Read the bundled Next.js docs before writing route/page code.** Per `AGENTS.md`: "This is NOT the Next.js you know" — check `node_modules/next/dist/docs/` for App Router route-handler and page conventions; heed deprecation notices.
- **Supabase access:** use the shared `supabase` client from `@/lib/supabase` in route handlers only. Anon key, no RLS changes. Do not create a new client.
- **Route handler params are async:** `{ params }: { params: Promise<{ id: string }> }` then `const { id } = await params` — matches existing `app/api/shopping/items/[id]/route.ts`.
- **Path alias:** import project files as `@/lib/...`, `@/components/...` (see `tsconfig.json`).
- **User session:** read `hs_session` cookie via `await cookies()` in server components; value is JSON `{ id, name, ... }`. Wrap `JSON.parse` in try/catch.
- **Dates:** all dates are `YYYY-MM-DD` strings. Parse as **local** dates (`new Date(y, m-1, d)`), never `new Date(str)`, to avoid timezone shifts (see `ShoppingClient` `formatGroupDate`).
- **Design system:** stone palette, orange accent `#C4622D` / `orange-500`/`orange-600`, DM Serif Display headings (`style={{ fontFamily: 'DM Serif Display, serif' }}`), white cards `border border-stone-200 rounded-2xl`, lucide-react icons. Match `app/page.tsx` and `components/shopping/ShoppingClient.tsx`.
- **UI in English; keep Indonesian dish names verbatim.**
- **Mobile-first:** phones get day-by-day stacked/swipeable cards, not a 7-col grid.

---

## File Structure

**Create:**
- `lib/meals/types.ts` — shared types + constants (SLOTS, labels, default no-repeat windows).
- `lib/meals/engine.ts` — pure generation engine.
- `lib/meals/engine.test.ts` — Vitest unit tests.
- `lib/meals/dates.ts` — small date helpers (weekStart→7 dates, day diff, isoDate).
- `app/meals/layout.tsx` — header + Plan/Dishes tabs.
- `app/meals/page.tsx` — Plan server page.
- `app/meals/dishes/page.tsx` — Dishes server page.
- `app/api/meals/generate/route.ts` — POST generate week.
- `app/api/meals/reroll/route.ts` — POST re-roll one cell + GET alternatives.
- `app/api/meals/plan/[id]/route.ts` — PATCH lock/swap cell.
- `app/api/meals/dishes/route.ts` — POST add dish.
- `app/api/meals/dishes/[id]/route.ts` — PATCH edit dish.
- `components/meals/PlanClient.tsx` — week grid/cards + controls.
- `components/meals/DishesClient.tsx` — editable dish table.
- `vitest.config.ts` — Vitest config.

**Modify:**
- `app/page.tsx` — add Meals feature card.
- `package.json` — add `vitest` dev dep + `"test"` script.

---

## Task 1: Types, date helpers, and Vitest setup

**Files:**
- Create: `lib/meals/types.ts`, `lib/meals/dates.ts`, `lib/meals/dates.test.ts`, `vitest.config.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `SLOTS`, `SLOT_LABELS`, `DEFAULT_NO_REPEAT`, types `Slot`, `Tier`, `Dish`, `MealPlan`, `Pick`; date helpers `isoDate(d: Date): string`, `weekDates(weekStart: string): string[]` (7 local dates Mon→Sun), `daysBetween(a: string, b: string): number` (b − a in whole days).

- [ ] **Step 1: Install Vitest**

```bash
npm install -D vitest
```

- [ ] **Step 2: Add test script to package.json**

In `package.json` `"scripts"`, add: `"test": "vitest run"`, `"test:watch": "vitest"`.

- [ ] **Step 3: Create vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node', include: ['lib/**/*.test.ts'] },
})
```

- [ ] **Step 4: Write types.ts**

```ts
export const SLOTS = ['utama', 'kuah', 'pelengkap', 'sayuran', 'desert'] as const
export type Slot = (typeof SLOTS)[number]

export const SLOT_LABELS: Record<Slot, string> = {
  utama: 'Utama', kuah: 'Kuah', pelengkap: 'Pelengkap', sayuran: 'Sayuran', desert: 'Desert',
}

export type Tier = 'everyday' | 'nice' | 'special'

export const DEFAULT_NO_REPEAT: Record<Slot, number> = {
  utama: 14, kuah: 7, pelengkap: 7, sayuran: 7, desert: 10,
}

export type Dish = {
  id: string
  name: string
  slot: Slot
  protein: string
  tier: Tier
  method: string | null
  spicy: boolean
  rating: number
  active: boolean
  no_repeat_days: number | null
}

export type MealPlan = {
  id: string
  plan_date: string
  slot: Slot
  dish_id: string | null
  dish_name: string | null
  locked: boolean
}

// A pick produced by the engine before it is persisted.
export type Pick = {
  plan_date: string
  slot: Slot
  dish_id: string | null
  dish_name: string | null
  locked: boolean
  note?: string
}
```

- [ ] **Step 5: Write the failing date-helpers test**

```ts
// lib/meals/dates.test.ts
import { describe, it, expect } from 'vitest'
import { isoDate, weekDates, daysBetween } from './dates'

describe('date helpers', () => {
  it('weekDates returns 7 consecutive local dates from Monday', () => {
    expect(weekDates('2026-08-10')).toEqual([
      '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13',
      '2026-08-14', '2026-08-15', '2026-08-16',
    ])
  })
  it('daysBetween counts whole days, b minus a', () => {
    expect(daysBetween('2026-08-10', '2026-08-13')).toBe(3)
    expect(daysBetween('2026-08-13', '2026-08-10')).toBe(-3)
  })
  it('isoDate formats a local Date as YYYY-MM-DD', () => {
    expect(isoDate(new Date(2026, 7, 3))).toBe('2026-08-03')
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- dates`
Expected: FAIL — cannot find `./dates`.

- [ ] **Step 7: Write dates.ts**

```ts
// lib/meals/dates.ts
export function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseLocal(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function weekDates(weekStart: string): string[] {
  const start = parseLocal(weekStart)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return isoDate(d)
  })
}

export function daysBetween(a: string, b: string): number {
  const ms = parseLocal(b).getTime() - parseLocal(a).getTime()
  return Math.round(ms / 86_400_000)
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- dates`
Expected: PASS (3 tests).

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json vitest.config.ts lib/meals/types.ts lib/meals/dates.ts lib/meals/dates.test.ts
git commit -m "feat(meals): add types, date helpers, and vitest setup"
```

---

## Task 2: Engine — hard rules

**Files:**
- Create: `lib/meals/engine.ts`
- Test: `lib/meals/engine.test.ts`

**Interfaces:**
- Consumes: types from `@/lib/meals/types`, `daysBetween` from `@/lib/meals/dates`.
- Produces:
  - `type PickContext = { date: string; slot: Slot; priorPlans: MealPlan[]; runPicks: Pick[]; dishById: Map<string, Dish>; specialDays: Set<string>; relax: { spicy: boolean; fried: boolean; noRepeatFactor: number } }`
  - `noRepeatOk(dish: Dish, ctx: PickContext): boolean`
  - `proteinOk(dish: Dish, ctx: PickContext): boolean` (utama continuity; non-utama always true)
  - `specialOk(dish: Dish, ctx: PickContext): boolean`
  - `friedOk(dish: Dish, ctx: PickContext): boolean`
  - `spicyOk(dish: Dish, ctx: PickContext): boolean`
  - `passesHardRules(dish: Dish, ctx: PickContext): boolean`
  - helper `picksForDate(ctx, date): Pick[]`, `resolveDish(ctx, pick): Dish | undefined`

Notes for the implementer:
- `runPicks` are picks already made this generation run (all dates/slots). `priorPlans` are persisted plans from before the week (DB history). Both feed the no-repeat check.
- `relax.noRepeatFactor` is 1 normally, 0.5 when the window is halved by relaxation. Effective window = `max(2, round(base * factor))`.
- The day cap "≤1 special across all slots" and "≥2 non-spicy per day" and "≤2 fried per day" are evaluated against **the other picks already placed on that date this run** plus locked cells for that date included in `runPicks`.

- [ ] **Step 1: Write failing tests for each hard rule**

```ts
// lib/meals/engine.test.ts
import { describe, it, expect } from 'vitest'
import type { Dish, MealPlan, Pick, Slot } from './types'
import {
  noRepeatOk, proteinOk, specialOk, friedOk, spicyOk, passesHardRules,
  type PickContext,
} from './engine'

function dish(over: Partial<Dish> & { id: string; slot: Slot }): Dish {
  return {
    name: over.id, protein: 'chicken', tier: 'everyday', method: null,
    spicy: false, rating: 3, active: true, no_repeat_days: null, ...over,
  } as Dish
}
function plan(over: Partial<MealPlan> & { plan_date: string; slot: Slot }): MealPlan {
  return { id: 'p-' + Math.random(), dish_id: null, dish_name: null, locked: false, ...over } as MealPlan
}
function pick(over: Partial<Pick> & { plan_date: string; slot: Slot }): Pick {
  return { dish_id: null, dish_name: null, locked: false, ...over } as Pick
}

function ctx(over: Partial<PickContext> & { date: string; slot: Slot; dishes: Dish[] }): PickContext {
  const dishById = new Map(over.dishes.map(d => [d.id, d]))
  return {
    date: over.date, slot: over.slot,
    priorPlans: over.priorPlans ?? [], runPicks: over.runPicks ?? [],
    dishById, specialDays: over.specialDays ?? new Set(),
    relax: over.relax ?? { spicy: false, fried: false, noRepeatFactor: 1 },
  }
}

describe('noRepeatOk', () => {
  it('rejects a dish used within its window in prior plans', () => {
    const d = dish({ id: 'a', slot: 'kuah' }) // default window 7
    const c = ctx({ date: '2026-08-13', slot: 'kuah', dishes: [d],
      priorPlans: [plan({ plan_date: '2026-08-10', slot: 'kuah', dish_id: 'a' })] })
    expect(noRepeatOk(d, c)).toBe(false)
  })
  it('allows a dish used outside its window', () => {
    const d = dish({ id: 'a', slot: 'kuah' })
    const c = ctx({ date: '2026-08-13', slot: 'kuah', dishes: [d],
      priorPlans: [plan({ plan_date: '2026-08-01', slot: 'kuah', dish_id: 'a' })] })
    expect(noRepeatOk(d, c)).toBe(true)
  })
  it('also checks picks made earlier this run', () => {
    const d = dish({ id: 'a', slot: 'kuah' })
    const c = ctx({ date: '2026-08-13', slot: 'kuah', dishes: [d],
      runPicks: [pick({ plan_date: '2026-08-12', slot: 'kuah', dish_id: 'a' })] })
    expect(noRepeatOk(d, c)).toBe(false)
  })
  it('uses dish.no_repeat_days when set', () => {
    const d = dish({ id: 'a', slot: 'desert', no_repeat_days: 2 })
    const c = ctx({ date: '2026-08-13', slot: 'desert', dishes: [d],
      priorPlans: [plan({ plan_date: '2026-08-10', slot: 'desert', dish_id: 'a' })] })
    expect(noRepeatOk(d, c)).toBe(true) // 3 days >= 2
  })
})

describe('proteinOk', () => {
  it('rejects utama whose protein equals previous day utama protein', () => {
    const beef = dish({ id: 'b', slot: 'utama', protein: 'beef' })
    const c = ctx({ date: '2026-08-13', slot: 'utama', dishes: [beef],
      runPicks: [pick({ plan_date: '2026-08-12', slot: 'utama', dish_id: 'x' })],
    })
    c.dishById.set('x', dish({ id: 'x', slot: 'utama', protein: 'beef' }))
    expect(proteinOk(beef, c)).toBe(false)
  })
  it('allows non-utama slots regardless', () => {
    const d = dish({ id: 'k', slot: 'kuah', protein: 'beef' })
    const c = ctx({ date: '2026-08-13', slot: 'kuah', dishes: [d] })
    expect(proteinOk(d, c)).toBe(true)
  })
})

describe('specialOk', () => {
  it('rejects special utama on a non-special day', () => {
    const d = dish({ id: 's', slot: 'utama', tier: 'special' })
    const c = ctx({ date: '2026-08-13', slot: 'utama', dishes: [d], specialDays: new Set() })
    expect(specialOk(d, c)).toBe(false)
  })
  it('allows special utama on a special day when no other special that day', () => {
    const d = dish({ id: 's', slot: 'utama', tier: 'special' })
    const c = ctx({ date: '2026-08-13', slot: 'utama', dishes: [d],
      specialDays: new Set(['2026-08-13']) })
    expect(specialOk(d, c)).toBe(true)
  })
  it('rejects any special when the day already has a special', () => {
    const kuahSpecial = dish({ id: 'ks', slot: 'kuah', tier: 'special' })
    const c = ctx({ date: '2026-08-13', slot: 'kuah', dishes: [kuahSpecial],
      runPicks: [pick({ plan_date: '2026-08-13', slot: 'utama', dish_id: 'us' })] })
    c.dishById.set('us', dish({ id: 'us', slot: 'utama', tier: 'special' }))
    expect(specialOk(kuahSpecial, c)).toBe(false)
  })
})

describe('friedOk', () => {
  it('rejects a 3rd fried dish on the same day', () => {
    const d = dish({ id: 'f3', slot: 'pelengkap', method: 'fried' })
    const c = ctx({ date: '2026-08-13', slot: 'pelengkap', dishes: [d],
      runPicks: [
        pick({ plan_date: '2026-08-13', slot: 'utama', dish_id: 'f1' }),
        pick({ plan_date: '2026-08-13', slot: 'kuah', dish_id: 'f2' }),
      ] })
    c.dishById.set('f1', dish({ id: 'f1', slot: 'utama', method: 'fried' }))
    c.dishById.set('f2', dish({ id: 'f2', slot: 'kuah', method: 'fried' }))
    expect(friedOk(d, c)).toBe(false)
  })
})

describe('spicyOk', () => {
  it('rejects a spicy dish when it would make <2 non-spicy possible', () => {
    // day has 5 slots; utama,kuah,pelengkap,sayuran already spicy-picked; this is desert (last slot)
    const d = dish({ id: 'sp', slot: 'desert', spicy: true })
    const spicyPick = (slot: Slot, id: string) => pick({ plan_date: '2026-08-13', slot, dish_id: id })
    const c = ctx({ date: '2026-08-13', slot: 'desert', dishes: [d],
      runPicks: [spicyPick('utama','a'), spicyPick('kuah','b'), spicyPick('pelengkap','c'), spicyPick('sayuran','e')] })
    for (const id of ['a','b','c','e']) c.dishById.set(id, dish({ id, slot: 'utama', spicy: true }))
    expect(spicyOk(d, c)).toBe(false)
  })
  it('is not enforced when relax.spicy is true', () => {
    const d = dish({ id: 'sp', slot: 'desert', spicy: true })
    const c = ctx({ date: '2026-08-13', slot: 'desert', dishes: [d],
      relax: { spicy: true, fried: false, noRepeatFactor: 1 } })
    expect(spicyOk(d, c)).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- engine`
Expected: FAIL — cannot find `./engine`.

- [ ] **Step 3: Implement engine.ts hard rules**

```ts
// lib/meals/engine.ts
import type { Dish, MealPlan, Pick, Slot } from './types'
import { SLOTS, DEFAULT_NO_REPEAT } from './types'
import { daysBetween } from './dates'

export type PickContext = {
  date: string
  slot: Slot
  priorPlans: MealPlan[]
  runPicks: Pick[]
  dishById: Map<string, Dish>
  specialDays: Set<string>
  relax: { spicy: boolean; fried: boolean; noRepeatFactor: number }
}

export function resolveDish(ctx: PickContext, dishId: string | null): Dish | undefined {
  return dishId ? ctx.dishById.get(dishId) : undefined
}

export function picksForDate(ctx: PickContext, date: string): Pick[] {
  return ctx.runPicks.filter(p => p.plan_date === date)
}

function windowFor(dish: Dish, ctx: PickContext): number {
  const base = dish.no_repeat_days ?? DEFAULT_NO_REPEAT[dish.slot]
  return Math.max(2, Math.round(base * ctx.relax.noRepeatFactor))
}

export function noRepeatOk(dish: Dish, ctx: PickContext): boolean {
  const win = windowFor(dish, ctx)
  const uses = [
    ...ctx.priorPlans.filter(p => p.dish_id === dish.id),
    ...ctx.runPicks.filter(p => p.dish_id === dish.id),
  ]
  for (const u of uses) {
    const gap = Math.abs(daysBetween(u.plan_date, ctx.date))
    if (gap < win) return false
  }
  return true
}

export function proteinOk(dish: Dish, ctx: PickContext): boolean {
  if (ctx.slot !== 'utama') return true
  // previous calendar day's utama protein (from run picks, else prior plans)
  const prevDate = prevDay(ctx.date)
  const prevPick = ctx.runPicks.find(p => p.plan_date === prevDate && p.slot === 'utama')
  let prevProtein: string | undefined
  if (prevPick) prevProtein = resolveDish(ctx, prevPick.dish_id)?.protein
  else {
    const prevPlan = ctx.priorPlans.find(p => p.plan_date === prevDate && p.slot === 'utama')
    prevProtein = prevPlan ? resolveDish(ctx, prevPlan.dish_id)?.protein : undefined
  }
  if (!prevProtein) return true
  return dish.protein !== prevProtein
}

export function specialOk(dish: Dish, ctx: PickContext): boolean {
  // day cap: at most one special dish across all slots
  const dayHasSpecial = picksForDate(ctx, ctx.date).some(
    p => resolveDish(ctx, p.dish_id)?.tier === 'special'
  )
  if (dish.tier === 'special') {
    if (dayHasSpecial) return false
    if (ctx.slot === 'utama' && !ctx.specialDays.has(ctx.date)) return false
  }
  return true
}

export function friedOk(dish: Dish, ctx: PickContext): boolean {
  if (ctx.relax.fried) return true
  if (dish.method !== 'fried') return true
  const friedCount = picksForDate(ctx, ctx.date).filter(
    p => resolveDish(ctx, p.dish_id)?.method === 'fried'
  ).length
  return friedCount < 2
}

export function spicyOk(dish: Dish, ctx: PickContext): boolean {
  if (ctx.relax.spicy) return true
  if (!dish.spicy) return true
  // slots not yet filled today AFTER this one (this pick counts as spicy)
  const filledSlots = new Set(picksForDate(ctx, ctx.date).map(p => p.slot))
  const remaining = SLOTS.filter(s => s !== ctx.slot && !filledSlots.has(s)).length
  const nonSpicySoFar = picksForDate(ctx, ctx.date).filter(
    p => resolveDish(ctx, p.dish_id)?.spicy === false
  ).length
  // if we pick spicy here, best case non-spicy = nonSpicySoFar + remaining
  return nonSpicySoFar + remaining >= 2
}

export function passesHardRules(dish: Dish, ctx: PickContext): boolean {
  return (
    dish.active &&
    dish.slot === ctx.slot &&
    noRepeatOk(dish, ctx) &&
    proteinOk(dish, ctx) &&
    specialOk(dish, ctx) &&
    friedOk(dish, ctx) &&
    spicyOk(dish, ctx)
  )
}

function prevDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() - 1)
  const yy = dt.getFullYear()
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const dd = String(dt.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- engine`
Expected: PASS (all hard-rule tests).

- [ ] **Step 5: Commit**

```bash
git add lib/meals/engine.ts lib/meals/engine.test.ts
git commit -m "feat(meals): add engine hard rules with tests"
```

---

## Task 3: Engine — weighted pick, freshness, relaxation, pickForSlot

**Files:**
- Modify: `lib/meals/engine.ts`
- Test: `lib/meals/engine.test.ts`

**Interfaces:**
- Consumes: hard-rule helpers + `PickContext` from Task 2.
- Produces:
  - `type Rng = () => number` (returns 0..1)
  - `freshnessFactor(dish: Dish, ctx: PickContext): number` (1..2)
  - `weightFor(dish: Dish, ctx: PickContext): number` (= `rating^2 * freshness`)
  - `weightedPick(dishes: Dish[], ctx: PickContext, rng: Rng): Dish | undefined`
  - `candidates(slotDishes: Dish[], ctx: PickContext): Dish[]` (filter by hard rules at current relax level)
  - `pickForSlot(slotDishes: Dish[], ctx: PickContext, rng: Rng): Pick` — applies the relaxation ladder and returns a Pick (dish or null with note).

Relaxation ladder inside `pickForSlot`: try relax `{spicy:false,fried:false,factor:1}`; if empty → `{spicy:true}`; then `{spicy:true,fried:true}`; then `{spicy:true,fried:true,factor:0.5}`; then last resort: any active dish of the slot (ignore all but R1-at-min via factor 0.5, i.e. keep the halved no-repeat). Attach `note` naming the relaxation used when it is beyond the first level.

- [ ] **Step 1: Write failing tests**

```ts
// append to lib/meals/engine.test.ts
import { freshnessFactor, weightFor, weightedPick, pickForSlot, type Rng } from './engine'

const seq = (vals: number[]): Rng => { let i = 0; return () => vals[i++ % vals.length] }

describe('freshnessFactor', () => {
  it('is 2 for a never-served dish', () => {
    const d = dish({ id: 'a', slot: 'kuah' })
    const c = ctx({ date: '2026-08-13', slot: 'kuah', dishes: [d] })
    expect(freshnessFactor(d, c)).toBe(2)
  })
  it('scales days_since_last / window, capped at 2 and floored at 1', () => {
    const d = dish({ id: 'a', slot: 'kuah' }) // window 7
    const c = ctx({ date: '2026-08-13', slot: 'kuah', dishes: [d],
      priorPlans: [plan({ plan_date: '2026-08-06', slot: 'kuah', dish_id: 'a' })] }) // 7 days
    expect(freshnessFactor(d, c)).toBe(1) // 7/7 = 1
  })
})

describe('weightFor', () => {
  it('is rating squared times freshness', () => {
    const d = dish({ id: 'a', slot: 'kuah', rating: 5 })
    const c = ctx({ date: '2026-08-13', slot: 'kuah', dishes: [d] })
    expect(weightFor(d, c)).toBe(25 * 2) // never served -> freshness 2
  })
})

describe('weightedPick', () => {
  it('is deterministic under a seeded rng', () => {
    const a = dish({ id: 'a', slot: 'kuah', rating: 1 })
    const b = dish({ id: 'b', slot: 'kuah', rating: 5 })
    const c = ctx({ date: '2026-08-13', slot: 'kuah', dishes: [a, b] })
    // rng near 1 lands in the heavier (b) bucket
    expect(weightedPick([a, b], c, seq([0.99]))?.id).toBe('b')
    expect(weightedPick([a, b], c, seq([0.0]))?.id).toBe('a')
  })
})

describe('pickForSlot relaxation ladder', () => {
  it('relaxes spicy floor when the only candidate is spicy', () => {
    const onlySpicy = dish({ id: 'sp', slot: 'desert', spicy: true })
    // day already has 4 spicy picks -> spicyOk would reject at level 0
    const runPicks = ['utama','kuah','pelengkap','sayuran'].map(
      (s) => pick({ plan_date: '2026-08-13', slot: s as Slot, dish_id: 'x-' + s }))
    const c = ctx({ date: '2026-08-13', slot: 'desert', dishes: [onlySpicy], runPicks })
    for (const s of ['utama','kuah','pelengkap','sayuran'])
      c.dishById.set('x-' + s, dish({ id: 'x-' + s, slot: 'utama', spicy: true }))
    const result = pickForSlot([onlySpicy], c, seq([0.5]))
    expect(result.dish_id).toBe('sp')
    expect(result.note).toContain('spicy')
  })
  it('returns a null pick with a note when no dish exists at all', () => {
    const c = ctx({ date: '2026-08-13', slot: 'desert', dishes: [] })
    const result = pickForSlot([], c, seq([0.5]))
    expect(result.dish_id).toBeNull()
    expect(result.note).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- engine`
Expected: FAIL — new exports undefined.

- [ ] **Step 3: Implement in engine.ts**

```ts
// append to lib/meals/engine.ts
export type Rng = () => number

export function freshnessFactor(dish: Dish, ctx: PickContext): number {
  const base = dish.no_repeat_days ?? DEFAULT_NO_REPEAT[dish.slot]
  const uses = [
    ...ctx.priorPlans.filter(p => p.dish_id === dish.id),
    ...ctx.runPicks.filter(p => p.dish_id === dish.id),
  ]
  if (uses.length === 0) return 2
  const mostRecent = uses.reduce((min, u) => {
    const gap = Math.abs(daysBetween(u.plan_date, ctx.date))
    return gap < min ? gap : min
  }, Infinity)
  return Math.min(2, Math.max(1, mostRecent / base))
}

export function weightFor(dish: Dish, ctx: PickContext): number {
  return dish.rating * dish.rating * freshnessFactor(dish, ctx)
}

export function weightedPick(dishes: Dish[], ctx: PickContext, rng: Rng): Dish | undefined {
  if (dishes.length === 0) return undefined
  const weights = dishes.map(d => weightFor(d, ctx))
  const total = weights.reduce((a, b) => a + b, 0)
  if (total <= 0) return dishes[Math.floor(rng() * dishes.length)]
  let r = rng() * total
  for (let i = 0; i < dishes.length; i++) {
    r -= weights[i]
    if (r < 0) return dishes[i]
  }
  return dishes[dishes.length - 1]
}

export function candidates(slotDishes: Dish[], ctx: PickContext): Dish[] {
  return slotDishes.filter(d => passesHardRules(d, ctx))
}

const RELAX_LADDER: { relax: PickContext['relax']; note?: string }[] = [
  { relax: { spicy: false, fried: false, noRepeatFactor: 1 } },
  { relax: { spicy: true, fried: false, noRepeatFactor: 1 }, note: 'relaxed: spicy floor' },
  { relax: { spicy: true, fried: true, noRepeatFactor: 1 }, note: 'relaxed: spicy + fried cap' },
  { relax: { spicy: true, fried: true, noRepeatFactor: 0.5 }, note: 'relaxed: spicy + fried + short no-repeat' },
]

export function pickForSlot(slotDishes: Dish[], ctx: PickContext, rng: Rng): Pick {
  for (const level of RELAX_LADDER) {
    const c: PickContext = { ...ctx, relax: level.relax }
    const pool = candidates(slotDishes, c)
    if (pool.length > 0) {
      const chosen = weightedPick(pool, c, rng)!
      return toPick(ctx, chosen, level.note)
    }
  }
  // last resort: any active dish of the slot, keep min no-repeat (factor 0.5)
  const lastCtx: PickContext = { ...ctx, relax: { spicy: true, fried: true, noRepeatFactor: 0.5 } }
  const anyActive = slotDishes.filter(d => d.active && d.slot === ctx.slot && noRepeatOk(d, lastCtx))
  if (anyActive.length > 0) {
    const chosen = weightedPick(anyActive, lastCtx, rng)!
    return toPick(ctx, chosen, 'relaxed: all soft rules dropped')
  }
  return { plan_date: ctx.date, slot: ctx.slot, dish_id: null, dish_name: null, locked: false, note: 'no candidate available' }
}

function toPick(ctx: PickContext, dish: Dish, note?: string): Pick {
  return { plan_date: ctx.date, slot: ctx.slot, dish_id: dish.id, dish_name: dish.name, locked: false, note }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- engine`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/meals/engine.ts lib/meals/engine.test.ts
git commit -m "feat(meals): add weighting, freshness, and relaxation ladder"
```

---

## Task 4: Engine — special-day pre-assignment + generateWeek

**Files:**
- Modify: `lib/meals/engine.ts`
- Test: `lib/meals/engine.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `preassignSpecialDays(days: string[], lockedCells: MealPlan[], dishById: Map<string,Dish>, rng: Rng): Set<string>` — returns exactly 2 non-adjacent days (or fewer if impossible), honoring locked specials.
  - `generateWeek(input: { weekStart: string; days: string[]; dishesBySlot: Record<Slot, Dish[]>; allDishes: Dish[]; priorPlans: MealPlan[]; lockedCells: MealPlan[]; rng: Rng }): Pick[]` — returns 35 picks; locked cells are passed through unchanged as picks (with `locked: true`).

Behavior:
- Seed `runPicks` with the locked cells (converted to `Pick` with `locked:true`) so hard rules see them.
- `dishById` = map over `allDishes` (needed to resolve locked/prior dish ids for protein/special checks).
- Iterate days in order, slots in `SLOTS` order; skip a (date,slot) if a locked pick already occupies it; otherwise `pickForSlot` and append to `runPicks`.
- Return all 35 picks sorted by day then slot order.

`preassignSpecialDays`:
- Start with days already holding a locked special utama → those count toward the 2.
- Pick remaining special days from days that have no locked special anywhere, ensuring no two chosen days are adjacent (`|dayIndex diff| >= 2`). Use `rng` to shuffle candidate order deterministically.
- Cap total at 2. If the special-utama pool (`dishesBySlot.utama` with tier special & active) is empty, return the locked-special days only.

- [ ] **Step 1: Write failing tests**

```ts
// append to lib/meals/engine.test.ts
import { preassignSpecialDays, generateWeek } from './engine'

const WEEK = ['2026-08-10','2026-08-11','2026-08-12','2026-08-13','2026-08-14','2026-08-15','2026-08-16']

describe('preassignSpecialDays', () => {
  it('returns exactly 2 non-adjacent days', () => {
    const specialUtama = [dish({ id: 'su', slot: 'utama', tier: 'special' })]
    const dishById = new Map(specialUtama.map(d => [d.id, d]))
    const days = preassignSpecialDays(WEEK, [], dishById, seq([0.1, 0.4, 0.7, 0.2, 0.9, 0.3, 0.6]))
    expect(days.size).toBe(2)
    const idx = [...days].map(d => WEEK.indexOf(d)).sort((a,b)=>a-b)
    expect(idx[1] - idx[0]).toBeGreaterThanOrEqual(2)
  })
  it('honors a locked special utama day', () => {
    const dishById = new Map([['su', dish({ id: 'su', slot: 'utama', tier: 'special' })]])
    const locked = [plan({ plan_date: '2026-08-13', slot: 'utama', dish_id: 'su', locked: true })]
    const days = preassignSpecialDays(WEEK, locked, dishById, seq([0.5]))
    expect(days.has('2026-08-13')).toBe(true)
  })
})

describe('generateWeek', () => {
  it('fills 35 cells and never overwrites a locked cell', () => {
    // small but sufficient pools per slot
    const mk = (slot: Slot, n: number, over: Partial<Dish> = {}) =>
      Array.from({ length: n }, (_, i) => dish({ id: `${slot}-${i}`, slot, ...over,
        protein: slot === 'utama' ? ['beef','chicken','fish','egg','tofu_tempe','shrimp','duck'][i % 7] : 'none' }))
    const dishesBySlot = {
      utama: mk('utama', 10), kuah: mk('kuah', 8), pelengkap: mk('pelengkap', 9),
      sayuran: mk('sayuran', 8), desert: mk('desert', 8),
    }
    // ensure some special utama exist
    dishesBySlot.utama[0].tier = 'special'
    dishesBySlot.utama[1].tier = 'special'
    dishesBySlot.utama[2].tier = 'special'
    const allDishes = Object.values(dishesBySlot).flat()
    const locked = [plan({ plan_date: '2026-08-12', slot: 'kuah', dish_id: 'kuah-3', dish_name: 'kuah-3', locked: true })]
    const picks = generateWeek({
      weekStart: '2026-08-10', days: WEEK, dishesBySlot, allDishes,
      priorPlans: [], lockedCells: locked, rng: seq([0.3, 0.6, 0.1, 0.8, 0.5, 0.2, 0.9, 0.4, 0.7, 0.05]),
    })
    expect(picks.length).toBe(35)
    const lockedPick = picks.find(p => p.plan_date === '2026-08-12' && p.slot === 'kuah')!
    expect(lockedPick.dish_id).toBe('kuah-3')
    expect(lockedPick.locked).toBe(true)
  })
  it('places at most 2 special mains, on non-adjacent days', () => {
    const mk = (slot: Slot, n: number) =>
      Array.from({ length: n }, (_, i) => dish({ id: `${slot}-${i}`, slot,
        tier: slot === 'utama' && i < 3 ? 'special' : 'everyday',
        protein: slot === 'utama' ? ['beef','chicken','fish','egg','tofu_tempe','shrimp','duck'][i % 7] : 'none' }))
    const dishesBySlot = { utama: mk('utama',10), kuah: mk('kuah',8), pelengkap: mk('pelengkap',9), sayuran: mk('sayuran',8), desert: mk('desert',8) }
    const picks = generateWeek({ weekStart: '2026-08-10', days: WEEK, dishesBySlot,
      allDishes: Object.values(dishesBySlot).flat(), priorPlans: [], lockedCells: [],
      rng: seq([0.3,0.6,0.1,0.8,0.5,0.2,0.9,0.4,0.7,0.05]) })
    const byId = new Map(Object.values(dishesBySlot).flat().map(d => [d.id, d]))
    const specialMainDays = picks.filter(p => p.slot === 'utama' && byId.get(p.dish_id!)?.tier === 'special')
      .map(p => WEEK.indexOf(p.plan_date)).sort((a,b)=>a-b)
    expect(specialMainDays.length).toBeLessThanOrEqual(2)
    if (specialMainDays.length === 2) expect(specialMainDays[1] - specialMainDays[0]).toBeGreaterThanOrEqual(2)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- engine`
Expected: FAIL.

- [ ] **Step 3: Implement in engine.ts**

```ts
// append to lib/meals/engine.ts
export function preassignSpecialDays(
  days: string[], lockedCells: MealPlan[], dishById: Map<string, Dish>, rng: Rng,
): Set<string> {
  const result = new Set<string>()
  // days that already hold ANY locked special count toward the cap
  for (const lc of lockedCells) {
    if (dishById.get(lc.dish_id ?? '')?.tier === 'special') result.add(lc.plan_date)
  }
  const specialPool = [...dishById.values()].some(d => d.slot === 'utama' && d.tier === 'special' && d.active)
  if (!specialPool) return result

  const isAdjacent = (d: string) =>
    [...result].some(r => Math.abs(days.indexOf(r) - days.indexOf(d)) < 2)
  // days with no locked non-utama special (day cap = 1 special) and not already chosen
  const lockedSpecialDays = new Set(
    lockedCells.filter(lc => dishById.get(lc.dish_id ?? '')?.tier === 'special').map(lc => lc.plan_date))
  const shuffled = shuffle(days.filter(d => !lockedSpecialDays.has(d)), rng)
  for (const d of shuffled) {
    if (result.size >= 2) break
    if (!isAdjacent(d)) result.add(d)
  }
  return result
}

function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function generateWeek(input: {
  weekStart: string; days: string[]; dishesBySlot: Record<Slot, Dish[]>
  allDishes: Dish[]; priorPlans: MealPlan[]; lockedCells: MealPlan[]; rng: Rng
}): Pick[] {
  const { days, dishesBySlot, allDishes, priorPlans, lockedCells, rng } = input
  const dishById = new Map(allDishes.map(d => [d.id, d]))
  const specialDays = preassignSpecialDays(days, lockedCells, dishById, rng)

  const lockedByCell = new Map(lockedCells.map(l => [`${l.plan_date}|${l.slot}`, l]))
  const runPicks: Pick[] = lockedCells.map(l => ({
    plan_date: l.plan_date, slot: l.slot, dish_id: l.dish_id, dish_name: l.dish_name, locked: true,
  }))

  for (const date of days) {
    for (const slot of SLOTS) {
      const key = `${date}|${slot}`
      if (lockedByCell.has(key)) continue
      const ctx: PickContext = {
        date, slot, priorPlans, runPicks, dishById, specialDays,
        relax: { spicy: false, fried: false, noRepeatFactor: 1 },
      }
      const pick = pickForSlot(dishesBySlot[slot] ?? [], ctx, rng)
      runPicks.push(pick)
    }
  }

  const slotOrder = (s: Slot) => SLOTS.indexOf(s)
  return runPicks.sort((a, b) =>
    a.plan_date === b.plan_date ? slotOrder(a.slot) - slotOrder(b.slot)
      : a.plan_date < b.plan_date ? -1 : 1)
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- engine`
Expected: PASS (full engine suite green).

- [ ] **Step 5: Commit**

```bash
git add lib/meals/engine.ts lib/meals/engine.test.ts
git commit -m "feat(meals): add special-day preassignment and generateWeek"
```

---

## Task 5: Home page Meals card

**Files:**
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: a navigable `/meals` link card.

- [ ] **Step 1: Add UtensilsCrossed to the lucide import**

In `app/page.tsx` line 3, change the import to include `UtensilsCrossed`:
```ts
import { Receipt, Calendar, ShoppingCart, UtensilsCrossed, Plus, LogOut } from 'lucide-react'
```

- [ ] **Step 2: Add the Meals feature entry**

In the `features` array, add after the shopping entry:
```ts
  {
    href: '/meals',
    icon: UtensilsCrossed,
    label: 'Meals',
    description: 'Weekly meal planner',
    color: 'bg-amber-50 text-amber-600',
  },
```

- [ ] **Step 3: Verify manually**

Run: `npm run dev`, open `/`, confirm the Meals card appears (warm amber) and links to `/meals`. (`/meals` 404s until Task 6 — that's expected.)

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "feat(meals): add Meals card to home page"
```

---

## Task 6: Meals layout with Plan/Dishes tabs

**Files:**
- Create: `app/meals/layout.tsx`

**Interfaces:**
- Consumes: `hs_session` cookie.
- Produces: shared chrome for `/meals` and `/meals/dishes`. Client tab component highlights the active route via `usePathname`.

- [ ] **Step 1: Read the Next.js layout + usePathname docs**

Check `node_modules/next/dist/docs/` for App Router `layout.tsx` conventions and client-component navigation (`usePathname` from `next/navigation`). Confirm nested layouts wrap child pages.

- [ ] **Step 2: Create the layout**

```tsx
// app/meals/layout.tsx
import { cookies } from 'next/headers'
import Link from 'next/link'
import MealsTabs from '@/components/meals/MealsTabs'

export default async function MealsLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('hs_session')?.value
  let userName = ''
  if (sessionCookie) {
    try { userName = JSON.parse(sessionCookie).name ?? '' } catch {}
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="bg-white border-b border-stone-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-2xl font-semibold text-stone-900" style={{ fontFamily: 'DM Serif Display, serif' }}>
              home<span className="text-orange-500 italic">space</span>
            </Link>
            {userName && <span className="text-sm text-stone-500">Hi, {userName}</span>}
          </div>
          <MealsTabs />
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6">{children}</main>
    </div>
  )
}
```

- [ ] **Step 3: Create the tabs client component**

```tsx
// components/meals/MealsTabs.tsx
'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const tabs = [
  { href: '/meals', label: 'Plan' },
  { href: '/meals/dishes', label: 'Dishes' },
]

export default function MealsTabs() {
  const pathname = usePathname()
  return (
    <nav className="flex gap-1">
      {tabs.map(t => {
        const active = pathname === t.href
        return (
          <Link key={t.href} href={t.href}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              active ? 'text-orange-600 bg-orange-50' : 'text-stone-500 hover:text-stone-800'}`}>
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add app/meals/layout.tsx components/meals/MealsTabs.tsx
git commit -m "feat(meals): add meals layout with Plan/Dishes tabs"
```

---

## Task 7: Generate API route

**Files:**
- Create: `app/api/meals/generate/route.ts`

**Interfaces:**
- Consumes: `generateWeek` from `@/lib/meals/engine`, `weekDates` from `@/lib/meals/dates`, `supabase` from `@/lib/supabase`, `SLOTS`, `Dish`, `Slot` from `@/lib/meals/types`.
- Produces: `POST` accepting `{ weekStart: 'YYYY-MM-DD' }`, returning `{ week: MealPlan[] }` (the 35 persisted rows for the week).

- [ ] **Step 1: Read the Next.js route handler docs**

Check `node_modules/next/dist/docs/` for the App Router Route Handler API (`export async function POST(request: Request)`, `Response.json`). Match `app/api/shopping/items/route.ts`.

- [ ] **Step 2: Implement the route**

```ts
// app/api/meals/generate/route.ts
import { supabase } from '@/lib/supabase'
import { SLOTS, type Dish, type MealPlan, type Slot } from '@/lib/meals/types'
import { generateWeek } from '@/lib/meals/engine'
import { weekDates } from '@/lib/meals/dates'

// Math.random-backed rng; engine stays pure/deterministic via injection.
const rng = () => Math.random()

export async function POST(request: Request) {
  const { weekStart } = await request.json()
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return Response.json({ error: 'weekStart (YYYY-MM-DD) required' }, { status: 400 })
  }
  const days = weekDates(weekStart)

  // history window: 14 days (max no-repeat) before weekStart
  const lookback = weekDates(weekStart)[0]
  const start = new Date(lookback); start.setDate(start.getDate() - 14)
  const historyStart = start.toISOString().split('T')[0]

  const [{ data: dishesRaw }, { data: plansRaw }] = await Promise.all([
    supabase.from('dishes').select('*').eq('active', true),
    supabase.from('meal_plans').select('*').gte('plan_date', historyStart).lte('plan_date', days[6]),
  ])

  const allDishes = (dishesRaw ?? []) as Dish[]
  const plans = (plansRaw ?? []) as MealPlan[]
  const weekSet = new Set(days)
  const lockedCells = plans.filter(p => weekSet.has(p.plan_date) && p.locked)
  const priorPlans = plans.filter(p => !weekSet.has(p.plan_date)) // strictly before/after week is history

  const dishesBySlot = Object.fromEntries(
    SLOTS.map(s => [s, allDishes.filter(d => d.slot === s)]),
  ) as Record<Slot, Dish[]>

  const picks = generateWeek({
    weekStart, days, dishesBySlot, allDishes, priorPlans, lockedCells, rng,
  })

  // Upsert non-locked picks only; locked rows are never overwritten.
  const rows = picks
    .filter(p => !p.locked)
    .map(p => ({ plan_date: p.plan_date, slot: p.slot, dish_id: p.dish_id, dish_name: p.dish_name, locked: false }))

  const { error } = await supabase.from('meal_plans').upsert(rows, { onConflict: 'plan_date,slot' })
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const { data: week } = await supabase
    .from('meal_plans').select('*').gte('plan_date', days[0]).lte('plan_date', days[6])
  return Response.json({ week: (week ?? []) as MealPlan[] })
}
```

- [ ] **Step 3: Manual smoke test**

Run: `npm run dev`, then:
```bash
curl -s -X POST localhost:3000/api/meals/generate -H 'content-type: application/json' \
  -d '{"weekStart":"2026-08-10"}' | head -c 400
```
Expected: JSON `{ "week": [ ... ] }` with ~35 rows. Re-run — locked rows (none yet) unaffected; non-locked replaced.

- [ ] **Step 4: Commit**

```bash
git add app/api/meals/generate/route.ts
git commit -m "feat(meals): add week generation API route"
```

---

## Task 8: Reroll API route (single + alternatives)

**Files:**
- Create: `app/api/meals/reroll/route.ts`

**Interfaces:**
- Consumes: engine `pickForSlot`, `candidates`, `weightFor`, `PickContext`; `supabase`; `weekDates`.
- Produces:
  - `POST { plan_date, slot }` → `{ pick: MealPlan }` (re-rolled + persisted; 409 if the cell is locked).
  - `GET ?plan_date=&slot=&alternatives=N` → `{ alternatives: { id, name }[] }` (no write), up to N candidates highest-weight first.

Shared helper builds a `PickContext` for a target cell from the surrounding week + history.

- [ ] **Step 1: Implement the route**

```ts
// app/api/meals/reroll/route.ts
import { supabase } from '@/lib/supabase'
import { SLOTS, type Dish, type MealPlan, type Slot } from '@/lib/meals/types'
import { candidates, pickForSlot, weightFor, type PickContext } from '@/lib/meals/engine'
import { weekDates } from '@/lib/meals/dates'

const rng = () => Math.random()

function mondayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const dow = (dt.getDay() + 6) % 7 // Mon=0
  dt.setDate(dt.getDate() - dow)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

async function buildContext(plan_date: string, slot: Slot) {
  const week = weekDates(mondayOf(plan_date))
  const start = new Date(week[0]); start.setDate(start.getDate() - 14)
  const historyStart = start.toISOString().split('T')[0]

  const [{ data: dishesRaw }, { data: plansRaw }] = await Promise.all([
    supabase.from('dishes').select('*').eq('active', true),
    supabase.from('meal_plans').select('*').gte('plan_date', historyStart).lte('plan_date', week[6]),
  ])
  const allDishes = (dishesRaw ?? []) as Dish[]
  const plans = (plansRaw ?? []) as MealPlan[]
  const dishById = new Map(allDishes.map(d => [d.id, d]))

  // run picks = all week plans EXCEPT the target cell; special day if this day already had a special utama
  const weekSet = new Set(week)
  const runPicks = plans
    .filter(p => weekSet.has(p.plan_date) && !(p.plan_date === plan_date && p.slot === slot))
    .map(p => ({ plan_date: p.plan_date, slot: p.slot as Slot, dish_id: p.dish_id, dish_name: p.dish_name, locked: p.locked }))
  const priorPlans = plans.filter(p => !weekSet.has(p.plan_date))

  const specialDays = new Set(
    week.filter(d => plans.some(p =>
      p.plan_date === d && p.slot === 'utama' && dishById.get(p.dish_id ?? '')?.tier === 'special')))
  // ensure this day can still receive a special main if it is one of the special days
  const ctx: PickContext = {
    date: plan_date, slot, priorPlans, runPicks, dishById, specialDays,
    relax: { spicy: false, fried: false, noRepeatFactor: 1 },
  }
  const slotDishes = allDishes.filter(d => d.slot === slot)
  return { ctx, slotDishes }
}

export async function POST(request: Request) {
  const { plan_date, slot } = await request.json()
  if (!plan_date || !SLOTS.includes(slot)) {
    return Response.json({ error: 'plan_date and valid slot required' }, { status: 400 })
  }
  const { data: existing } = await supabase
    .from('meal_plans').select('*').eq('plan_date', plan_date).eq('slot', slot).maybeSingle()
  if (existing?.locked) return Response.json({ error: 'cell is locked' }, { status: 409 })

  const { ctx, slotDishes } = await buildContext(plan_date, slot as Slot)
  const pick = pickForSlot(slotDishes, ctx, rng)

  const { data, error } = await supabase.from('meal_plans')
    .upsert({ plan_date, slot, dish_id: pick.dish_id, dish_name: pick.dish_name, locked: false },
      { onConflict: 'plan_date,slot' })
    .select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ pick: data as MealPlan })
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const plan_date = url.searchParams.get('plan_date')
  const slot = url.searchParams.get('slot') as Slot | null
  const n = Math.min(Number(url.searchParams.get('alternatives') ?? 5) || 5, 10)
  if (!plan_date || !slot || !SLOTS.includes(slot)) {
    return Response.json({ error: 'plan_date and valid slot required' }, { status: 400 })
  }
  const { ctx, slotDishes } = await buildContext(plan_date, slot)
  const pool = candidates(slotDishes, ctx)
    .map(d => ({ d, w: weightFor(d, ctx) }))
    .sort((a, b) => b.w - a.w)
    .slice(0, n)
    .map(({ d }) => ({ id: d.id, name: d.name }))
  return Response.json({ alternatives: pool })
}
```

- [ ] **Step 2: Manual smoke test**

Run (dev server up, after a generate):
```bash
curl -s "localhost:3000/api/meals/reroll?plan_date=2026-08-10&slot=kuah&alternatives=5"
curl -s -X POST localhost:3000/api/meals/reroll -H 'content-type: application/json' -d '{"plan_date":"2026-08-10","slot":"kuah"}'
```
Expected: GET returns `{ alternatives: [...] }`; POST returns `{ pick: {...} }` with a (possibly) different dish.

- [ ] **Step 3: Commit**

```bash
git add app/api/meals/reroll/route.ts
git commit -m "feat(meals): add reroll + alternatives API route"
```

---

## Task 9: Plan-cell and Dishes CRUD API routes

**Files:**
- Create: `app/api/meals/plan/[id]/route.ts`, `app/api/meals/dishes/route.ts`, `app/api/meals/dishes/[id]/route.ts`

**Interfaces:**
- Produces:
  - `PATCH /api/meals/plan/[id]` — body is a partial of `{ locked, dish_id, dish_name }`; returns updated row.
  - `POST /api/meals/dishes` — body `{ name, slot }` (+ optional fields); inserts with defaults `rating:3, active:true`; returns the row.
  - `PATCH /api/meals/dishes/[id]` — body is a partial `Dish`; returns updated row.

- [ ] **Step 1: Implement plan/[id] PATCH**

```ts
// app/api/meals/plan/[id]/route.ts
import { supabase } from '@/lib/supabase'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json()
  const allowed = (({ locked, dish_id, dish_name }) => ({ locked, dish_id, dish_name }))(body)
  const patch = Object.fromEntries(Object.entries(allowed).filter(([, v]) => v !== undefined))
  const { data, error } = await supabase.from('meal_plans').update(patch).eq('id', id).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}
```

- [ ] **Step 2: Implement dishes POST**

```ts
// app/api/meals/dishes/route.ts
import { supabase } from '@/lib/supabase'
import { SLOTS } from '@/lib/meals/types'

export async function POST(request: Request) {
  const body = await request.json()
  if (!body.name?.trim() || !SLOTS.includes(body.slot)) {
    return Response.json({ error: 'name and valid slot required' }, { status: 400 })
  }
  const { data, error } = await supabase.from('dishes').insert({
    name: body.name.trim(), slot: body.slot,
    protein: body.protein ?? 'none', tier: body.tier ?? 'everyday',
    method: body.method ?? null, spicy: body.spicy ?? false,
    rating: body.rating ?? 3, active: body.active ?? true,
    no_repeat_days: body.no_repeat_days ?? null,
  }).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}
```

- [ ] **Step 3: Implement dishes/[id] PATCH**

```ts
// app/api/meals/dishes/[id]/route.ts
import { supabase } from '@/lib/supabase'

const FIELDS = ['name','slot','protein','tier','method','spicy','rating','active','no_repeat_days']

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json()
  const patch = Object.fromEntries(Object.entries(body).filter(([k]) => FIELDS.includes(k)))
  const { data, error } = await supabase.from('dishes').update(patch).eq('id', id).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}
```

- [ ] **Step 4: Manual smoke test**

With dev server up, PATCH a known dish id and confirm the row updates:
```bash
curl -s -X PATCH localhost:3000/api/meals/dishes/<some-id> -H 'content-type: application/json' -d '{"rating":5}'
```
Expected: JSON dish row with `"rating":5`.

- [ ] **Step 5: Commit**

```bash
git add app/api/meals/plan app/api/meals/dishes
git commit -m "feat(meals): add plan-cell and dishes CRUD routes"
```

---

## Task 10: Plan page (server) + PlanClient shell with week navigation & Generate

**Files:**
- Create: `app/meals/page.tsx`, `components/meals/PlanClient.tsx`

**Interfaces:**
- Consumes: `supabase`, `MealPlan`, `Slot`, `SLOTS`, `SLOT_LABELS`, `weekDates`, generate API.
- Produces: `PlanClient` receiving `{ initialWeekStart: string; initialWeek: MealPlan[] }`. Later tasks add cell controls.

Design notes:
- `page.tsx` computes the current week's Monday (server-side), fetches that week's `meal_plans`, passes to client.
- Week bar: prev/next shift `weekStart` by ±7; "This week" resets. On week change, client fetches `/api/meals/generate`? No — reads existing plans via a lightweight fetch. Add a small GET is unnecessary; instead re-fetch by navigating with a query param OR fetch plans client-side. **Chosen:** client keeps a `weekStart` state and fetches plans via `supabase`-less API. Add a tiny `GET /api/meals/plan?weekStart=` is overkill; instead reuse generate's returned week only on Generate, and for plain navigation fetch via a new `GET /api/meals/week?weekStart=`.

**Decision (lock this in):** add `GET /api/meals/week?weekStart=` returning `{ week: MealPlan[] }` for read-only week navigation. Implement it in this task (it's tiny) so week switching doesn't require regeneration.

- [ ] **Step 1: Add the week read route**

```ts
// app/api/meals/week/route.ts
import { supabase } from '@/lib/supabase'
import { weekDates } from '@/lib/meals/dates'
import type { MealPlan } from '@/lib/meals/types'

export async function GET(request: Request) {
  const weekStart = new URL(request.url).searchParams.get('weekStart')
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return Response.json({ error: 'weekStart required' }, { status: 400 })
  }
  const days = weekDates(weekStart)
  const { data } = await supabase.from('meal_plans').select('*')
    .gte('plan_date', days[0]).lte('plan_date', days[6])
  return Response.json({ week: (data ?? []) as MealPlan[] })
}
```

- [ ] **Step 2: Create the server page**

```tsx
// app/meals/page.tsx
export const dynamic = 'force-dynamic'

import { supabase } from '@/lib/supabase'
import { weekDates } from '@/lib/meals/dates'
import type { MealPlan } from '@/lib/meals/types'
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
  const { data } = await supabase.from('meal_plans').select('*')
    .gte('plan_date', days[0]).lte('plan_date', days[6])
  return <PlanClient initialWeekStart={weekStart} initialWeek={(data ?? []) as MealPlan[]} />
}
```

- [ ] **Step 3: Create PlanClient shell (week bar + generate + grid scaffold)**

```tsx
// components/meals/PlanClient.tsx
'use client'
import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react'
import { SLOTS, SLOT_LABELS, type MealPlan, type Slot } from '@/lib/meals/types'
import { weekDates } from '@/lib/meals/dates'

function shiftWeek(weekStart: string, deltaDays: number): string {
  const [y, m, d] = weekStart.split('-').map(Number)
  const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() + deltaDays)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
function currentMonday(): string {
  const now = new Date(); const dow = (now.getDay() + 6) % 7
  now.setDate(now.getDate() - dow)
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
function label(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
const DAY_NAMES = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

export default function PlanClient({ initialWeekStart, initialWeek }:
  { initialWeekStart: string; initialWeek: MealPlan[] }) {
  const [weekStart, setWeekStart] = useState(initialWeekStart)
  const [week, setWeek] = useState<MealPlan[]>(initialWeek)
  const [generating, setGenerating] = useState(false)
  const days = useMemo(() => weekDates(weekStart), [weekStart])

  function cell(date: string, slot: Slot): MealPlan | undefined {
    return week.find(p => p.plan_date === date && p.slot === slot)
  }

  async function loadWeek(ws: string) {
    setWeekStart(ws)
    const res = await fetch(`/api/meals/week?weekStart=${ws}`)
    const { week } = await res.json()
    setWeek(week ?? [])
  }
  async function generate() {
    setGenerating(true)
    try {
      const res = await fetch('/api/meals/generate', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ weekStart }),
      })
      const { week } = await res.json()
      setWeek(week ?? [])
    } finally { setGenerating(false) }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => loadWeek(shiftWeek(weekStart, -7))}
            className="p-2 rounded-lg hover:bg-stone-100 text-stone-600"><ChevronLeft size={18} /></button>
          <span className="text-sm font-medium text-stone-700 min-w-[9rem] text-center">
            {label(days[0])} – {label(days[6])}
          </span>
          <button onClick={() => loadWeek(shiftWeek(weekStart, 7))}
            className="p-2 rounded-lg hover:bg-stone-100 text-stone-600"><ChevronRight size={18} /></button>
          <button onClick={() => loadWeek(currentMonday())}
            className="ml-1 text-sm text-stone-500 hover:text-stone-800 px-2 py-1">This week</button>
        </div>
        <button onClick={generate} disabled={generating}
          className="flex items-center gap-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors">
          <Sparkles size={16} /> {generating ? 'Generating…' : 'Generate Week'}
        </button>
      </div>

      {/* Desktop grid */}
      <div className="hidden sm:grid grid-cols-7 gap-2">
        {days.map((date, i) => (
          <div key={date} className="flex flex-col gap-2">
            <div className="text-center">
              <div className="text-xs font-semibold text-stone-700">{DAY_NAMES[i]}</div>
              <div className="text-xs text-stone-400">{label(date)}</div>
            </div>
            {SLOTS.map(slot => (
              <CellView key={slot} date={date} slot={slot} plan={cell(date, slot)}
                onChange={(p) => setWeek(w => upsertCell(w, p))} />
            ))}
          </div>
        ))}
      </div>

      {/* Mobile stacked day cards */}
      <div className="sm:hidden flex flex-col gap-4">
        {days.map((date, i) => (
          <div key={date} className="bg-white border border-stone-200 rounded-2xl p-4">
            <div className="font-medium text-stone-800 mb-3">{DAY_NAMES[i]} · <span className="text-stone-400">{label(date)}</span></div>
            <div className="flex flex-col gap-2">
              {SLOTS.map(slot => (
                <CellView key={slot} date={date} slot={slot} plan={cell(date, slot)}
                  onChange={(p) => setWeek(w => upsertCell(w, p))} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function upsertCell(week: MealPlan[], p: MealPlan): MealPlan[] {
  const idx = week.findIndex(w => w.plan_date === p.plan_date && w.slot === p.slot)
  if (idx === -1) return [...week, p]
  const copy = [...week]; copy[idx] = p; return copy
}

// Placeholder CellView — fully implemented in Task 11.
function CellView({ slot, plan }: { date: string; slot: Slot; plan?: MealPlan; onChange: (p: MealPlan) => void }) {
  return (
    <div className="bg-white border border-stone-200 rounded-xl px-2.5 py-2 text-xs min-h-[3.5rem]">
      <div className="text-[10px] uppercase tracking-wide text-stone-400">{SLOT_LABELS[slot]}</div>
      <div className="text-stone-800 mt-0.5">{plan?.dish_name ?? '—'}</div>
    </div>
  )
}
```

- [ ] **Step 4: Manual check**

Run: `npm run dev`, open `/meals`. Confirm: week bar navigates (prev/next/this week refetch), Generate Week fills the grid, desktop shows 7 columns, mobile (narrow window) shows stacked day cards. Dish names render or "—".

- [ ] **Step 5: Commit**

```bash
git add app/meals/page.tsx app/api/meals/week/route.ts components/meals/PlanClient.tsx
git commit -m "feat(meals): add plan page with week nav and generate"
```

---

## Task 11: Plan cell — tier badge, spicy, special ring, lock, reroll dropdown

**Files:**
- Modify: `components/meals/PlanClient.tsx` (replace the placeholder `CellView`)

**Interfaces:**
- Consumes: `PATCH /api/meals/plan/[id]`, `POST /api/meals/reroll`, `GET /api/meals/reroll?...alternatives=5`. Needs each cell's dish `tier` and `spicy` — the `meal_plans` row lacks these, so fetch dish metadata.

**Decision (lock this in):** the plan page needs `tier`/`spicy` per cell for badges + the special ring. Extend the plan/week fetches to join dish metadata: change the select to `*, dishes(tier, spicy)` in `app/meals/page.tsx`, `app/api/meals/week/route.ts`, and `app/api/meals/generate/route.ts`'s final read. Add to `MealPlan` type an optional `dishes?: { tier: Tier; spicy: boolean } | null`. Supabase returns the embedded relation under the key `dishes`.

- [ ] **Step 1: Add embedded dish metadata to the three reads**

In `app/meals/page.tsx`, `app/api/meals/week/route.ts`, and the final `select('*')` in `app/api/meals/generate/route.ts`, change `.select('*')` to `.select('*, dishes(tier, spicy)')`. In `lib/meals/types.ts`, add to `MealPlan`:
```ts
  dishes?: { tier: Tier; spicy: boolean } | null
```

- [ ] **Step 2: Implement the full CellView**

Replace the placeholder `CellView` in `PlanClient.tsx` with:
```tsx
import { useState } from 'react'
import { Lock, Unlock, Shuffle } from 'lucide-react'
import type { Tier } from '@/lib/meals/types'

const TIER_STYLE: Record<Tier, string> = {
  everyday: 'bg-stone-100 text-stone-500',
  nice: 'bg-amber-100 text-amber-700',
  special: 'bg-orange-100 text-orange-700',
}

function CellView({ date, slot, plan, onChange }:
  { date: string; slot: Slot; plan?: MealPlan; onChange: (p: MealPlan) => void }) {
  const [open, setOpen] = useState(false)
  const [alts, setAlts] = useState<{ id: string; name: string }[] | null>(null)
  const [busy, setBusy] = useState(false)
  const tier = plan?.dishes?.tier
  const spicy = plan?.dishes?.spicy
  const isSpecial = tier === 'special'

  async function toggleLock() {
    if (!plan) return
    const next = !plan.locked
    onChange({ ...plan, locked: next }) // optimistic
    const res = await fetch(`/api/meals/plan/${plan.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locked: next }),
    })
    if (!res.ok) onChange({ ...plan, locked: !next }) // rollback
  }

  async function openAlternatives() {
    setOpen(true)
    if (alts) return
    const res = await fetch(`/api/meals/reroll?plan_date=${date}&slot=${slot}&alternatives=5`)
    const { alternatives } = await res.json()
    setAlts(alternatives ?? [])
  }

  async function chooseReroll(body: object) {
    setBusy(true)
    try {
      const res = await fetch('/api/meals/reroll', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) { const { pick } = await res.json(); onChange(pick) }
    } finally { setBusy(false); setOpen(false); setAlts(null) }
  }

  return (
    <div className={`group/cell relative bg-white border rounded-xl px-2.5 py-2 text-xs min-h-[3.5rem] transition-colors ${
      isSpecial ? 'border-orange-300 ring-1 ring-orange-200' : 'border-stone-200'}`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-stone-400">{SLOT_LABELS[slot]}</span>
        {plan && (
          <div className="flex items-center gap-1 opacity-0 group-hover/cell:opacity-100 focus-within:opacity-100 transition-opacity">
            <button onClick={toggleLock} title={plan.locked ? 'Unlock' : 'Lock'}
              className={`p-0.5 rounded ${plan.locked ? 'text-orange-600' : 'text-stone-300 hover:text-stone-600'}`}>
              {plan.locked ? <Lock size={13} /> : <Unlock size={13} />}
            </button>
            <button onClick={openAlternatives} title="Want something else?"
              className="p-0.5 rounded text-stone-300 hover:text-stone-600"><Shuffle size={13} /></button>
          </div>
        )}
      </div>
      <div className="text-stone-800 mt-0.5 leading-snug">{plan?.dish_name ?? '—'}</div>
      <div className="flex items-center gap-1 mt-1">
        {tier && <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${TIER_STYLE[tier]}`}>{tier}</span>}
        {spicy && <span title="Spicy">🌶️</span>}
      </div>

      {open && (
        <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-white border border-stone-200 rounded-xl shadow-lg p-1">
          <button disabled={busy} onClick={() => chooseReroll({ plan_date: date, slot })}
            className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-orange-50 text-orange-700 font-medium">
            🎲 Surprise me
          </button>
          {alts?.map(a => (
            <button key={a.id} disabled={busy}
              onClick={() => chooseReroll({ plan_date: date, slot, dish_id: a.id })}
              className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-stone-50 text-stone-700 truncate">
              {a.name}
            </button>
          ))}
          {alts && alts.length === 0 && <div className="px-2 py-1.5 text-stone-400">No alternatives</div>}
          <button onClick={() => { setOpen(false); setAlts(null) }}
            className="w-full text-left px-2 py-1.5 rounded-lg text-stone-400 hover:bg-stone-50">Cancel</button>
        </div>
      )}
    </div>
  )
}
```

**Implementer note:** `chooseReroll` supports two shapes — `{plan_date, slot}` (engine re-roll) and `{plan_date, slot, dish_id}` (explicit choice). The reroll POST route from Task 8 handles only the engine re-roll. Extend that route's POST to accept an optional `dish_id`: when present, skip the engine and upsert that dish directly (look up its `name` for `dish_name`). Add near the top of the POST handler, after the lock check:
```ts
  if (body.dish_id) {
    const { data: d } = await supabase.from('dishes').select('id,name').eq('id', body.dish_id).single()
    const { data, error } = await supabase.from('meal_plans')
      .upsert({ plan_date, slot, dish_id: d!.id, dish_name: d!.name, locked: false }, { onConflict: 'plan_date,slot' })
      .select('*, dishes(tier, spicy)').single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ pick: data })
  }
```
(Change the POST signature to read the whole `body` object: `const body = await request.json(); const { plan_date, slot } = body`.) Also change the engine-reroll upsert `.select()` to `.select('*, dishes(tier, spicy)')` so the returned pick carries badge metadata.

- [ ] **Step 3: Manual check**

Run: `npm run dev`, `/meals`, Generate Week. Verify: tier badges + 🌶️ show; special cells have the orange ring; hovering a cell reveals lock + shuffle; locking persists across a regenerate; "Want something else?" lists alternatives and swaps just that cell; "Surprise me" re-rolls.

- [ ] **Step 4: Commit**

```bash
git add components/meals/PlanClient.tsx app/meals/page.tsx app/api/meals/week/route.ts app/api/meals/generate/route.ts app/api/meals/reroll/route.ts lib/meals/types.ts
git commit -m "feat(meals): add cell badges, lock, and reroll dropdown"
```

---

## Task 12: Dishes page — editable grouped table with filter/search/add

**Files:**
- Create: `app/meals/dishes/page.tsx`, `components/meals/DishesClient.tsx`

**Interfaces:**
- Consumes: `supabase`, `Dish`, `SLOTS`, `SLOT_LABELS`, dishes CRUD routes.
- Produces: full dish management UI.

Column option lists:
- protein: `fish, chicken, pork, beef, shrimp, squid, crab, duck, egg, tofu_tempe, none, mixed`
- tier: `everyday, nice, special`
- method: free-ish; use `['fried','boiled','grilled','steamed','sauteed','braised','raw','baked','soup','']` as dropdown options plus keep existing value if not listed.

- [ ] **Step 1: Create the server page**

```tsx
// app/meals/dishes/page.tsx
export const dynamic = 'force-dynamic'

import { supabase } from '@/lib/supabase'
import type { Dish } from '@/lib/meals/types'
import DishesClient from '@/components/meals/DishesClient'

export default async function DishesPage() {
  const { data } = await supabase.from('dishes').select('*').order('slot').order('name')
  return <DishesClient initialDishes={(data ?? []) as Dish[]} />
}
```

- [ ] **Step 2: Create DishesClient**

```tsx
// components/meals/DishesClient.tsx
'use client'
import { useMemo, useState } from 'react'
import { Plus, Star } from 'lucide-react'
import { SLOTS, SLOT_LABELS, type Dish, type Slot, type Tier } from '@/lib/meals/types'

const PROTEINS = ['fish','chicken','pork','beef','shrimp','squid','crab','duck','egg','tofu_tempe','none','mixed']
const TIERS: Tier[] = ['everyday','nice','special']
const METHODS = ['','fried','boiled','grilled','steamed','sauteed','braised','raw','baked','soup']

export default function DishesClient({ initialDishes }: { initialDishes: Dish[] }) {
  const [dishes, setDishes] = useState<Dish[]>(initialDishes)
  const [slotFilter, setSlotFilter] = useState<Slot | 'all'>('all')
  const [search, setSearch] = useState('')

  async function patch(id: string, fields: Partial<Dish>) {
    setDishes(ds => ds.map(d => d.id === id ? { ...d, ...fields } : d)) // optimistic
    const res = await fetch(`/api/meals/dishes/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fields),
    })
    if (!res.ok) { const r = await fetch(`/api/meals/dishes/${id}`); /* best-effort; leave optimistic */ }
  }

  async function addDish(slot: Slot) {
    const res = await fetch('/api/meals/dishes', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'New dish', slot }),
    })
    if (res.ok) { const d = await res.json(); setDishes(ds => [...ds, d as Dish]) }
  }

  const filtered = useMemo(() => dishes.filter(d =>
    (slotFilter === 'all' || d.slot === slotFilter) &&
    d.name.toLowerCase().includes(search.toLowerCase())), [dishes, slotFilter, search])

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <button onClick={() => setSlotFilter('all')}
          className={`px-3 py-1.5 rounded-lg text-sm ${slotFilter === 'all' ? 'bg-orange-100 text-orange-700' : 'text-stone-500 hover:bg-stone-100'}`}>All</button>
        {SLOTS.map(s => (
          <button key={s} onClick={() => setSlotFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-sm ${slotFilter === s ? 'bg-orange-100 text-orange-700' : 'text-stone-500 hover:bg-stone-100'}`}>
            {SLOT_LABELS[s]}</button>
        ))}
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search dishes…"
          className="ml-auto px-3 py-1.5 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-orange-300" />
      </div>

      {SLOTS.filter(s => slotFilter === 'all' || s === slotFilter).map(slot => {
        const rows = filtered.filter(d => d.slot === slot)
        return (
          <section key={slot} className="mb-8">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg text-stone-800" style={{ fontFamily: 'DM Serif Display, serif' }}>{SLOT_LABELS[slot]}</h2>
              <button onClick={() => addDish(slot)}
                className="flex items-center gap-1 text-sm text-orange-600 hover:text-orange-700"><Plus size={15} /> Add dish</button>
            </div>
            <div className="bg-white border border-stone-200 rounded-2xl overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="text-left text-xs text-stone-400 border-b border-stone-100">
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Protein</th>
                    <th className="px-3 py-2 font-medium">Tier</th>
                    <th className="px-3 py-2 font-medium">Method</th>
                    <th className="px-3 py-2 font-medium">Spicy</th>
                    <th className="px-3 py-2 font-medium">Rating</th>
                    <th className="px-3 py-2 font-medium">Active</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(d => <DishRow key={d.id} dish={d} onPatch={patch} />)}
                  {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-stone-400">No dishes</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}
    </div>
  )

  function DishRow({ dish, onPatch }: { dish: Dish; onPatch: (id: string, f: Partial<Dish>) => void }) {
    const [name, setName] = useState(dish.name)
    return (
      <tr className="border-b border-stone-50 last:border-0">
        <td className="px-3 py-1.5">
          <input value={name} onChange={e => setName(e.target.value)}
            onBlur={() => name.trim() && name !== dish.name && onPatch(dish.id, { name: name.trim() })}
            className="w-full bg-transparent focus:outline-none focus:bg-stone-50 rounded px-1 py-0.5" />
        </td>
        <td className="px-3 py-1.5">
          <select value={dish.protein} onChange={e => onPatch(dish.id, { protein: e.target.value })}
            className="bg-transparent text-stone-600 focus:outline-none">
            {PROTEINS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </td>
        <td className="px-3 py-1.5">
          <select value={dish.tier} onChange={e => onPatch(dish.id, { tier: e.target.value as Tier })}
            className="bg-transparent text-stone-600 focus:outline-none">
            {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </td>
        <td className="px-3 py-1.5">
          <select value={dish.method ?? ''} onChange={e => onPatch(dish.id, { method: e.target.value || null })}
            className="bg-transparent text-stone-600 focus:outline-none">
            {METHODS.map(m => <option key={m} value={m}>{m || '—'}</option>)}
            {dish.method && !METHODS.includes(dish.method) && <option value={dish.method}>{dish.method}</option>}
          </select>
        </td>
        <td className="px-3 py-1.5">
          <button onClick={() => onPatch(dish.id, { spicy: !dish.spicy })}
            className={`w-9 h-5 rounded-full transition-colors relative ${dish.spicy ? 'bg-orange-500' : 'bg-stone-200'}`}>
            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${dish.spicy ? 'left-4' : 'left-0.5'}`} />
          </button>
        </td>
        <td className="px-3 py-1.5">
          <div className="flex gap-0.5">
            {[1,2,3,4,5].map(n => (
              <button key={n} onClick={() => onPatch(dish.id, { rating: n })}>
                <Star size={14} className={n <= dish.rating ? 'fill-amber-400 text-amber-400' : 'text-stone-300'} />
              </button>
            ))}
          </div>
        </td>
        <td className="px-3 py-1.5">
          <button onClick={() => onPatch(dish.id, { active: !dish.active })}
            className={`w-9 h-5 rounded-full transition-colors relative ${dish.active ? 'bg-green-500' : 'bg-stone-200'}`}>
            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${dish.active ? 'left-4' : 'left-0.5'}`} />
          </button>
        </td>
      </tr>
    )
  }
}
```

- [ ] **Step 3: Manual check**

Run: `npm run dev`, open `/meals/dishes`. Verify: dishes grouped by slot; slot filter pills + search work; editing name (blur), protein/tier/method dropdowns, spicy/active toggles, and star rating each persist (reload page to confirm). "Add dish" inserts an editable "New dish" row in that slot.

- [ ] **Step 4: Commit**

```bash
git add app/meals/dishes/page.tsx components/meals/DishesClient.tsx
git commit -m "feat(meals): add editable dishes table with filter and search"
```

---

## Task 13: Full-suite verification + build

**Files:** none (verification only).

- [ ] **Step 1: Run the unit tests**

Run: `npm test`
Expected: all engine + date tests PASS.

- [ ] **Step 2: Typecheck / build**

Run: `npm run build`
Expected: build succeeds with no type errors. Fix any surfaced type mismatches (common: `MealPlan.dishes` embedded shape, `Slot` narrowing on query params).

- [ ] **Step 3: End-to-end manual pass**

With `npm run dev`:
- `/` shows Meals card → `/meals`.
- Generate Week fills 35 cells; exactly ~2 special mains on non-adjacent days (orange ring); ≤2 fried/day; no obvious all-spicy day.
- Lock a cell, regenerate → locked cell unchanged.
- "Want something else?" swaps one cell; "Surprise me" re-rolls.
- Week nav prev/next/This week works on desktop grid and mobile stacked cards.
- `/meals/dishes` edits persist.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix(meals): resolve build/type issues from verification"
```

---

## Self-Review Notes (for the planner, not a task)

- **Spec coverage:** home card (T5), plan view week nav/generate (T10), cell badges/lock/reroll (T11), dishes view (T12), generate algorithm incl. all hard rules + relaxation + special preassign (T2–T4, T7), reroll single + alternatives (T8), all API routes (T7–T11), tests (T1–T4). ✅
- **Deviations from spec, intentional:** added `GET /api/meals/week` (read-only week nav) and embedded `dishes(tier,spicy)` in plan reads (badges need tier/spicy not stored on `meal_plans`) — both locked in inside T10/T11.
