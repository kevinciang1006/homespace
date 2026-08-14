# Meal Compose-a-Plate Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite meal generation and the plan view from "fill 5 fixed slots" to "compose a plate of ~3 dishes around one main," with a hero-card UI.

**Architecture:** The pure engine (`lib/meals/engine.ts`) gains a `composeDay` primitive that assembles a day around a main sized by its `richness`; `generateWeek` calls it per day. Routes own Supabase I/O; generate now delete-and-inserts a variable row set; reroll of the main re-composes the day. The plan view becomes hero cards. All engine logic stays unit-tested with Vitest.

**Tech Stack:** Next.js 16.2.4 (App Router), TypeScript (strict), Tailwind v4, Supabase JS (anon key, `lib/supabase.ts`), lucide-react, Vitest.

## Global Constraints

- **Read the bundled Next.js docs** (`node_modules/next/dist/docs/`) before route/page edits.
- **Supabase:** shared `supabase` client from `@/lib/supabase` in route handlers only; anon key; no RLS changes.
- **Route dynamic params are async:** `{ params }: { params: Promise<{ id: string }> }`.
- **Dates:** `YYYY-MM-DD` strings parsed local; use helpers in `@/lib/meals/dates`.
- **Design system:** stone palette, orange accent (`orange-500/600`), DM Serif Display headings, white cards `border border-stone-200 rounded-2xl`, lucide icons. Mobile-first.
- **Engine stays pure** — no Supabase/Next imports in `lib/meals/engine.ts`.
- **Roles:** `main` (utama), `support` (sayuran/pelengkap/kuah), `optional` (desert). `skipped` kuah row (no dish) only when the main provides soup.
- **Budget:** heavy → main+veg; medium/light → main+veg+1 support; desert always (optional). Veg always, free.
- **Spicy floor adapted:** at least 1 non-spicy among a day's main+supports (desert exempt). Fried cap ≤2/day incl. desert.

---

## File Structure

**Modify:**
- `lib/meals/types.ts` — `Dish` += `richness`, `provides_soup`; new `Role`; `Pick`/`MealPlan` += `role`, `skipped`; extend `MealPlan.dishes` meta.
- `lib/meals/engine.ts` — `PickContext` += `role`, `spicyFloor`, `plannedRemaining`; rewrite `spicyOk`, `toPick`, `pickForSlot`; add `composeDay`; rewrite `generateWeek`.
- `lib/meals/engine.test.ts` — update ctx helper + spicy tests; rewrite generation tests for compose.
- `app/api/meals/generate/route.ts` — delete-and-insert variable rows; select new dish fields.
- `app/api/meals/reroll/route.ts` — main reroll re-composes the day (`{day}`); support reroll swaps one (`{pick}`).
- `app/meals/page.tsx` — join `richness, provides_soup` into the fetch.
- `components/meals/PlanClient.tsx` — rewrite to hero-plate layout.

---

## Task 1: Engine + types — compose model

**Files:**
- Modify: `lib/meals/types.ts`, `lib/meals/engine.ts`, `lib/meals/engine.test.ts`

**Interfaces:**
- Produces: `Role`; `Dish.richness`, `Dish.provides_soup`; `Pick.role/skipped`, `MealPlan.role/skipped`; `PickContext.role/spicyFloor/plannedRemaining`; `composeDay(...)`; rewritten `generateWeek(...)` returning `Pick[]` (variable rows/day, incl. `skipped` kuah rows).

- [ ] **Step 1: Extend types.ts**

Add after `Tier`:
```ts
export type Role = 'main' | 'support' | 'optional'
export type Richness = 'light' | 'medium' | 'heavy'
```
In `Dish`, add:
```ts
  richness: Richness
  provides_soup: boolean
```
In `MealPlan`, change `dishes?` and add role/skipped:
```ts
  role: Role
  skipped: boolean
  dishes?: { tier: Tier; spicy: boolean; richness: Richness; provides_soup: boolean; recipe_image_url: string | null } | null
```
In `Pick`, add:
```ts
  role: Role
  skipped: boolean
```

- [ ] **Step 2: Rewrite the failing spicy + generation tests**

In `lib/meals/engine.test.ts`, update the `ctx()` helper to supply the new required fields (defaults keep existing hard-rule tests valid):
```ts
function ctx(over: Partial<PickContext> & { date: string; slot: Slot; dishes: Dish[] }): PickContext {
  const dishById = new Map(over.dishes.map(d => [d.id, d]))
  return {
    date: over.date, slot: over.slot,
    priorPlans: over.priorPlans ?? [], runPicks: over.runPicks ?? [],
    dishById, specialDays: over.specialDays ?? new Set(),
    relax: over.relax ?? { spicy: false, fried: false, noRepeatFactor: 1 },
    role: over.role ?? 'support', spicyFloor: over.spicyFloor ?? 1,
    plannedRemaining: over.plannedRemaining ?? 5,
  }
}
```
Update the `dish()` helper to include the new Dish fields:
```ts
function dish(over: Partial<Dish> & { id: string; slot: Slot }): Dish {
  return {
    name: over.id, protein: 'chicken', tier: 'everyday', method: null,
    spicy: false, rating: 3, active: true, no_repeat_days: null,
    ingredients: null, recipe_steps: null, recipe_image_url: null,
    richness: 'medium', provides_soup: false, ...over,
  } as Dish
}
```
Update `pick()` helper to include role/skipped:
```ts
function pick(over: Partial<Pick> & { plan_date: string; slot: Slot }): Pick {
  return { dish_id: null, dish_name: null, locked: false, role: 'support', skipped: false, ...over } as Pick
}
```
Update the `plan()` helper (MealPlan now requires role/skipped):
```ts
function plan(over: Partial<MealPlan> & { plan_date: string; slot: Slot }): MealPlan {
  return { id: 'p-' + Math.random(), dish_id: null, dish_name: null, locked: false,
    role: 'support', skipped: false, ...over } as MealPlan
}
```
Replace the whole `describe('spicyOk', ...)` block with:
```ts
describe('spicyOk (floor of 1 non-spicy among main+supports)', () => {
  it('rejects a spicy dish that would make the plate all-spicy with none left', () => {
    const d = dish({ id: 'sp', slot: 'pelengkap', spicy: true })
    const c = ctx({ date: '2026-08-13', slot: 'pelengkap', dishes: [d],
      role: 'support', plannedRemaining: 0,
      runPicks: [pick({ plan_date: '2026-08-13', slot: 'utama', dish_id: 'm', role: 'main' })] })
    c.dishById.set('m', dish({ id: 'm', slot: 'utama', spicy: true }))
    expect(spicyOk(d, c)).toBe(false)
  })
  it('allows a spicy dish when a non-spicy pick still remains', () => {
    const d = dish({ id: 'sp', slot: 'utama', spicy: true })
    const c = ctx({ date: '2026-08-13', slot: 'utama', dishes: [d], role: 'main', plannedRemaining: 1 })
    expect(spicyOk(d, c)).toBe(true)
  })
  it('exempts the desert (optional role)', () => {
    const d = dish({ id: 'sp', slot: 'desert', spicy: true })
    const c = ctx({ date: '2026-08-13', slot: 'desert', dishes: [d], role: 'optional', plannedRemaining: 0 })
    expect(spicyOk(d, c)).toBe(true)
  })
})
```
Delete the OLD `describe('generateWeek', ...)` and `describe('preassignSpecialDays', ...)` blocks' generateWeek assertions that assume 35 cells — they are replaced in Step 6. (Keep `preassignSpecialDays` tests; they still hold.)

- [ ] **Step 3: Run tests to verify the spicy tests fail**

Run: `npm test -- engine`
Expected: FAIL — `spicyOk` still uses the old 5-slot logic; new fields unused.

- [ ] **Step 4: Rewrite spicyOk, PickContext, toPick, pickForSlot in engine.ts**

Change `PickContext`:
```ts
export type PickContext = {
  date: string
  slot: Slot
  priorPlans: MealPlan[]
  runPicks: Pick[]
  dishById: Map<string, Dish>
  specialDays: Set<string>
  relax: { spicy: boolean; fried: boolean; noRepeatFactor: number }
  role: Role
  spicyFloor: number
  plannedRemaining: number
}
```
(Import `Role` from `./types`.)

Replace `spicyOk`:
```ts
export function spicyOk(dish: Dish, ctx: PickContext): boolean {
  if (ctx.relax.spicy) return true
  if (!dish.spicy) return true
  if (ctx.role === 'optional') return true // desert exempt from the floor
  const counted = picksForDate(ctx, ctx.date).filter(p => !p.skipped && p.role !== 'optional')
  const nonSpicySoFar = counted.filter(p => resolveDish(ctx, p.dish_id)?.spicy === false).length
  return nonSpicySoFar + ctx.plannedRemaining >= ctx.spicyFloor
}
```
Replace `toPick` and the null-pick fallback to carry role/skipped:
```ts
function toPick(ctx: PickContext, dish: Dish, note?: string): Pick {
  return { plan_date: ctx.date, slot: ctx.slot, dish_id: dish.id, dish_name: dish.name,
    locked: false, role: ctx.role, skipped: false, note }
}
```
In `pickForSlot`, change the final no-candidate return to:
```ts
  return { plan_date: ctx.date, slot: ctx.slot, dish_id: null, dish_name: null,
    locked: false, role: ctx.role, skipped: false, note: 'no candidate available' }
```

- [ ] **Step 5: Run tests to verify spicy + hard-rule tests pass**

Run: `npm test -- engine`
Expected: hard-rule + spicy + weighting + preassign tests PASS; the old generateWeek block (now removed) is gone. If TS errors remain in `generateWeek`, they are fixed in Step 6.

- [ ] **Step 6: Add composeDay and rewrite generateWeek**

Replace the `generateWeek` function with `composeDay` + a new `generateWeek`:
```ts
export function composeDay(input: {
  date: string
  dishesBySlot: Record<Slot, Dish[]>
  dishById: Map<string, Dish>
  priorPlans: MealPlan[]
  runPicks: Pick[]                       // appended in place with the day's created picks
  lockedByCell: Map<string, MealPlan>    // keyed `${date}|${slot}`
  specialDays: Set<string>
  rng: Rng
}): Pick[] {
  const { date, dishesBySlot, dishById, priorPlans, runPicks, lockedByCell, specialDays, rng } = input
  const created: Pick[] = []
  const mkCtx = (slot: Slot, role: Role, plannedRemaining: number): PickContext => ({
    date, slot, priorPlans, runPicks, dishById, specialDays,
    relax: { spicy: false, fried: false, noRepeatFactor: 1 },
    role, spicyFloor: 1, plannedRemaining,
  })
  const push = (p: Pick) => { runPicks.push(p); created.push(p) }
  const isLocked = (slot: Slot) => lockedByCell.has(`${date}|${slot}`)
  const lockedDish = (slot: Slot): Dish | undefined => {
    const lc = lockedByCell.get(`${date}|${slot}`)
    return lc?.dish_id ? dishById.get(lc.dish_id) : undefined
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
  const richness = main?.richness ?? 'medium'
  const extra = richness === 'heavy' ? 0 : 1
  const providesSoup = main?.provides_soup ?? false

  // 3. SOUP skip (only when the main provides soup and kuah isn't locked)
  if (providesSoup && !isLocked('kuah')) {
    push({ plan_date: date, slot: 'kuah', dish_id: null, dish_name: null, locked: false, role: 'support', skipped: true })
  }

  // 4a. VEG — always, free
  if (!isLocked('sayuran')) {
    push(pickForSlot(dishesBySlot.sayuran ?? [], mkCtx('sayuran', 'support', extra), rng))
  }

  // 4b/c. one extra support: a side, or a soup fallback only if no side fits
  if (extra >= 1 && !isLocked('pelengkap')) {
    const preferNonFried = main?.method === 'fried'
    const side = pickPreferNonFried(dishesBySlot.pelengkap ?? [], mkCtx('pelengkap', 'support', 0), rng, preferNonFried)
    if (side.dish_id) push(side)
    else if (!providesSoup && !isLocked('kuah')) {
      const soup = pickForSlot(dishesBySlot.kuah ?? [], mkCtx('kuah', 'support', 0), rng)
      if (soup.dish_id) push(soup)
    }
  }

  // 5. DESERT — always, optional
  if (!isLocked('desert')) {
    push(pickForSlot(dishesBySlot.desert ?? [], mkCtx('desert', 'optional', 0), rng))
  }

  return created
}

function pickPreferNonFried(slotDishes: Dish[], ctx: PickContext, rng: Rng, prefer: boolean): Pick {
  if (prefer) {
    const nonFried = slotDishes.filter(d => d.method !== 'fried')
    const p = pickForSlot(nonFried, ctx, rng)
    if (p.dish_id) return p
  }
  return pickForSlot(slotDishes, ctx, rng)
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
    plan_date: l.plan_date, slot: l.slot, dish_id: l.dish_id, dish_name: l.dish_name,
    locked: true, role: l.role ?? 'support', skipped: l.skipped ?? false,
  }))

  for (const date of days) {
    composeDay({ date, dishesBySlot, dishById, priorPlans, runPicks, lockedByCell, specialDays, rng })
  }

  const slotOrder = (s: Slot) => SLOTS.indexOf(s)
  return runPicks.sort((a, b) =>
    a.plan_date === b.plan_date ? slotOrder(a.slot) - slotOrder(b.slot)
      : a.plan_date < b.plan_date ? -1 : 1)
}
```

- [ ] **Step 7: Add compose-model generation tests**

Append to `lib/meals/engine.test.ts`:
```ts
import { composeDay, generateWeek } from './engine'

const WEEK = ['2026-08-10','2026-08-11','2026-08-12','2026-08-13','2026-08-14','2026-08-15','2026-08-16']
const seqR = (vals: number[]): Rng => { let i = 0; return () => vals[i++ % vals.length] }

function pools() {
  const mk = (slot: Slot, n: number, over: Partial<Dish> = {}) =>
    Array.from({ length: n }, (_, i) => dish({ id: `${slot}-${i}`, slot, ...over,
      protein: slot === 'utama' ? ['beef','chicken','fish','egg','tofu_tempe','shrimp','duck'][i % 7] : 'none' }))
  const dishesBySlot = {
    utama: mk('utama', 12), kuah: mk('kuah', 8), pelengkap: mk('pelengkap', 9),
    sayuran: mk('sayuran', 8), desert: mk('desert', 8),
  }
  return dishesBySlot
}

describe('composeDay', () => {
  it('heavy main → main + veg + desert only (no side/soup dish)', () => {
    const dishesBySlot = pools()
    dishesBySlot.utama.forEach(d => { d.richness = 'heavy' })
    const dishById = new Map(Object.values(dishesBySlot).flat().map(d => [d.id, d]))
    const runPicks: Pick[] = []
    const created = composeDay({ date: '2026-08-10', dishesBySlot, dishById, priorPlans: [], runPicks,
      lockedByCell: new Map(), specialDays: new Set(), rng: seqR([0.3,0.6,0.1,0.8,0.5]) })
    const roles = created.map(p => `${p.slot}:${p.role}`)
    expect(created.filter(p => p.role === 'main').length).toBe(1)
    expect(created.some(p => p.slot === 'sayuran' && p.role === 'support')).toBe(true)
    expect(created.some(p => p.slot === 'pelengkap')).toBe(false) // no side for heavy
    expect(created.some(p => p.slot === 'kuah' && p.dish_id)).toBe(false) // no soup dish
    expect(created.some(p => p.slot === 'desert' && p.role === 'optional')).toBe(true)
    expect(roles).toContain('utama:main')
  })

  it('medium main → main + veg + one side + desert', () => {
    const dishesBySlot = pools()
    dishesBySlot.utama.forEach(d => { d.richness = 'medium'; d.provides_soup = false })
    const dishById = new Map(Object.values(dishesBySlot).flat().map(d => [d.id, d]))
    const created = composeDay({ date: '2026-08-10', dishesBySlot, dishById, priorPlans: [], runPicks: [],
      lockedByCell: new Map(), specialDays: new Set(), rng: seqR([0.3,0.6,0.1,0.8,0.5,0.2]) })
    expect(created.some(p => p.slot === 'sayuran' && p.dish_id)).toBe(true)
    expect(created.some(p => p.slot === 'pelengkap' && p.dish_id)).toBe(true)
    expect(created.some(p => p.slot === 'desert' && p.role === 'optional')).toBe(true)
  })

  it('main that provides soup → skipped kuah row, no soup dish', () => {
    const dishesBySlot = pools()
    dishesBySlot.utama.forEach(d => { d.richness = 'medium'; d.provides_soup = true })
    const dishById = new Map(Object.values(dishesBySlot).flat().map(d => [d.id, d]))
    const created = composeDay({ date: '2026-08-10', dishesBySlot, dishById, priorPlans: [], runPicks: [],
      lockedByCell: new Map(), specialDays: new Set(), rng: seqR([0.3,0.6,0.1,0.8,0.5,0.2]) })
    const kuah = created.find(p => p.slot === 'kuah')!
    expect(kuah.skipped).toBe(true)
    expect(kuah.dish_id).toBeNull()
    expect(created.some(p => p.slot === 'kuah' && p.dish_id)).toBe(false)
  })
})

describe('generateWeek (compose)', () => {
  it('each day has exactly one main and always a desert; specials 2/week non-adjacent', () => {
    const dishesBySlot = pools()
    dishesBySlot.utama[0].tier = 'special'; dishesBySlot.utama[1].tier = 'special'; dishesBySlot.utama[2].tier = 'special'
    const picks = generateWeek({ weekStart: '2026-08-10', days: WEEK, dishesBySlot,
      allDishes: Object.values(dishesBySlot).flat(), priorPlans: [], lockedCells: [],
      rng: seqR([0.3,0.6,0.1,0.8,0.5,0.2,0.9,0.4,0.7,0.05]) })
    const byId = new Map(Object.values(dishesBySlot).flat().map(d => [d.id, d]))
    for (const date of WEEK) {
      const day = picks.filter(p => p.plan_date === date)
      expect(day.filter(p => p.role === 'main').length).toBe(1)
      expect(day.filter(p => p.slot === 'desert' && p.role === 'optional').length).toBe(1)
    }
    const specialDays = picks.filter(p => p.role === 'main' && byId.get(p.dish_id!)?.tier === 'special')
      .map(p => WEEK.indexOf(p.plan_date)).sort((a,b)=>a-b)
    expect(specialDays.length).toBe(2)
    expect(specialDays[1] - specialDays[0]).toBeGreaterThanOrEqual(2)
  })

  it('preserves a locked cell', () => {
    const dishesBySlot = pools()
    const locked = [{ id: 'L', plan_date: '2026-08-12', slot: 'sayuran' as Slot, dish_id: 'sayuran-3',
      dish_name: 'sayuran-3', locked: true, role: 'support' as Role, skipped: false }]
    const picks = generateWeek({ weekStart: '2026-08-10', days: WEEK, dishesBySlot,
      allDishes: Object.values(dishesBySlot).flat(), priorPlans: [], lockedCells: locked,
      rng: seqR([0.3,0.6,0.1,0.8,0.5,0.2,0.9,0.4,0.7,0.05]) })
    const cell = picks.find(p => p.plan_date === '2026-08-12' && p.slot === 'sayuran')!
    expect(cell.dish_id).toBe('sayuran-3')
    expect(cell.locked).toBe(true)
  })
})
```

- [ ] **Step 8: Run the full engine suite**

Run: `npm test -- engine`
Expected: PASS (hard rules, spicy floor, weighting, preassign, composeDay, generateWeek).

- [ ] **Step 9: Run all tests (dates + shopping unaffected)**

Run: `npm test`
Expected: all suites green.

- [ ] **Step 10: Commit**

```bash
git add lib/meals/types.ts lib/meals/engine.ts lib/meals/engine.test.ts
git commit -m "feat(meals): rewrite engine to compose a plate around one main"
```

---

## Task 2: Generate route — variable-row persistence

**Files:**
- Modify: `app/api/meals/generate/route.ts`

**Interfaces:**
- Consumes: rewritten `generateWeek`; `supabase`; `weekDates`; `Dish`, `MealPlan`.
- Produces: `POST { weekStart }` → `{ week: MealPlan[] }` after delete-and-insert of the composed non-locked rows.

- [ ] **Step 1: Rewrite the route**

Replace the body of `POST` so it (a) selects the richer dish fields, (b) delete-and-inserts. Full file:
```ts
import { supabase } from '@/lib/supabase'
import { SLOTS, type Dish, type MealPlan, type Slot } from '@/lib/meals/types'
import { generateWeek } from '@/lib/meals/engine'
import { weekDates } from '@/lib/meals/dates'

const rng = () => Math.random()

export async function POST(request: Request) {
  const { weekStart } = await request.json()
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return Response.json({ error: 'weekStart (YYYY-MM-DD) required' }, { status: 400 })
  }
  const days = weekDates(weekStart)

  const start = new Date(days[0]); start.setDate(start.getDate() - 14)
  const historyStart = start.toISOString().split('T')[0]

  const [{ data: dishesRaw }, { data: plansRaw }] = await Promise.all([
    supabase.from('dishes').select('*').eq('active', true),
    supabase.from('meal_plans').select('*').gte('plan_date', historyStart).lte('plan_date', days[6]),
  ])

  const allDishes = (dishesRaw ?? []) as Dish[]
  const plans = (plansRaw ?? []) as MealPlan[]
  const weekSet = new Set(days)
  const lockedCells = plans.filter(p => weekSet.has(p.plan_date) && p.locked)
  const priorPlans = plans.filter(p => !weekSet.has(p.plan_date))

  const dishesBySlot = Object.fromEntries(
    SLOTS.map(s => [s, allDishes.filter(d => d.slot === s)]),
  ) as Record<Slot, Dish[]>

  const picks = generateWeek({ weekStart, days, dishesBySlot, allDishes, priorPlans, lockedCells, rng })

  const rows = picks.filter(p => !p.locked).map(p => ({
    plan_date: p.plan_date, slot: p.slot, dish_id: p.dish_id, dish_name: p.dish_name,
    locked: false, role: p.role, skipped: p.skipped,
  }))

  // variable row set: delete non-locked rows for the week, then insert the composed plate
  await supabase.from('meal_plans').delete()
    .gte('plan_date', days[0]).lte('plan_date', days[6]).eq('locked', false)
  if (rows.length) {
    const { error } = await supabase.from('meal_plans').insert(rows)
    if (error) return Response.json({ error: error.message }, { status: 500 })
  }

  const { data: week } = await supabase
    .from('meal_plans')
    .select('*, dishes(tier, spicy, richness, provides_soup, recipe_image_url)')
    .gte('plan_date', days[0]).lte('plan_date', days[6])
  return Response.json({ week: (week ?? []) as MealPlan[] })
}
```

- [ ] **Step 2: Smoke test**

Start dev (sandbox-disabled if the port is blocked). With a session cookie:
```bash
COOKIE='hs_session={"id":"00000000-0000-0000-0000-000000000000","name":"Test"}'
curl -s -X POST --cookie "$COOKIE" localhost:3000/api/meals/generate -H 'content-type: application/json' -d '{"weekStart":"2026-08-10"}' \
 | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const w=JSON.parse(s).week;
   const days=[...new Set(w.map(r=>r.plan_date))].sort();
   for(const d of days){const day=w.filter(r=>r.plan_date===d);
     const main=day.find(r=>r.role==="main"); const rich=main?.dishes?.richness;
     const supports=day.filter(r=>r.role==="support"&&!r.skipped&&r.dish_id).length;
     const skip=day.some(r=>r.slot==="kuah"&&r.skipped);
     console.log(d.slice(5),"rich="+rich,"supports="+supports,skip?"(soup-skip)":"","desert="+day.some(r=>r.role==="optional"));}})'
```
Expected: heavy days show `supports=1` (veg only), medium/light `supports=2` (veg+side) unless soup-skip; every day has a main + desert; soup-provided mains show `(soup-skip)`.

- [ ] **Step 3: Commit**

```bash
git add app/api/meals/generate/route.ts
git commit -m "feat(meals): generate composes a plate and delete-inserts the week"
```

---

## Task 3: Reroll route — re-compose main, swap support

**Files:**
- Modify: `app/api/meals/reroll/route.ts`

**Interfaces:**
- Consumes: `composeDay`, `pickForSlot`, `candidates`, `weightFor`, `PickContext` from engine; `mondayOf`, `weekDates`; `supabase`.
- Produces:
  - `POST { plan_date, slot: 'utama', dish_id? }` → `{ day: MealPlan[] }` (re-composed day).
  - `POST { plan_date, slot, dish_id? }` for a support/optional slot → `{ pick: MealPlan }` (single swap).
  - `GET ?plan_date&slot&alternatives=N` → candidate list (unchanged).

- [ ] **Step 1: Read current reroll route**

Run: open `app/api/meals/reroll/route.ts`. Reuse its `buildContext`/`GET` for the single-swap + alternatives paths; add a re-compose branch for `slot==='utama'`.

- [ ] **Step 2: Rewrite the POST handler + add a re-compose helper**

Full file:
```ts
import { supabase } from '@/lib/supabase'
import { SLOTS, type Dish, type MealPlan, type Slot, type Role } from '@/lib/meals/types'
import { candidates, composeDay, pickForSlot, weightFor, type PickContext } from '@/lib/meals/engine'
import { weekDates, mondayOf } from '@/lib/meals/dates'

const rng = () => Math.random()
const SELECT = '*, dishes(tier, spicy, richness, provides_soup, recipe_image_url)'

async function loadWeek(plan_date: string) {
  const week = weekDates(mondayOf(plan_date))
  const start = new Date(week[0]); start.setDate(start.getDate() - 14)
  const historyStart = start.toISOString().split('T')[0]
  const [{ data: dishesRaw }, { data: plansRaw }] = await Promise.all([
    supabase.from('dishes').select('*').eq('active', true),
    supabase.from('meal_plans').select('*').gte('plan_date', historyStart).lte('plan_date', week[6]),
  ])
  return {
    week,
    allDishes: (dishesRaw ?? []) as Dish[],
    plans: (plansRaw ?? []) as MealPlan[],
  }
}

function roleForSlot(slot: Slot): Role {
  return slot === 'utama' ? 'main' : slot === 'desert' ? 'optional' : 'support'
}

function buildSingleContext(plan_date: string, slot: Slot, allDishes: Dish[], plans: MealPlan[], week: string[]) {
  const dishById = new Map(allDishes.map(d => [d.id, d]))
  const weekSet = new Set(week)
  const runPicks = plans
    .filter(p => weekSet.has(p.plan_date) && !(p.plan_date === plan_date && p.slot === slot))
    .map(p => ({ plan_date: p.plan_date, slot: p.slot as Slot, dish_id: p.dish_id, dish_name: p.dish_name,
      locked: p.locked, role: p.role ?? 'support', skipped: p.skipped ?? false }))
  const priorPlans = plans.filter(p => !weekSet.has(p.plan_date))
  const specialDays = new Set(
    week.filter(d => plans.some(p => p.plan_date === d && p.slot === 'utama' && dishById.get(p.dish_id ?? '')?.tier === 'special')))
  const ctx: PickContext = {
    date: plan_date, slot, priorPlans, runPicks, dishById, specialDays,
    relax: { spicy: false, fried: false, noRepeatFactor: 1 },
    role: roleForSlot(slot), spicyFloor: 1, plannedRemaining: 5,
  }
  return { ctx, slotDishes: allDishes.filter(d => d.slot === slot), dishById }
}

export async function POST(request: Request) {
  const body = await request.json()
  const { plan_date, slot } = body
  if (!plan_date || !SLOTS.includes(slot)) {
    return Response.json({ error: 'plan_date and valid slot required' }, { status: 400 })
  }
  const { data: existing } = await supabase
    .from('meal_plans').select('*').eq('plan_date', plan_date).eq('slot', slot).maybeSingle()
  if (existing?.locked) return Response.json({ error: 'cell is locked' }, { status: 409 })

  // ---- MAIN reroll → re-compose the day ----
  if (slot === 'utama') {
    const { week, allDishes, plans } = await loadWeek(plan_date)
    const dishById = new Map(allDishes.map(d => [d.id, d]))
    const dayLocked = plans.filter(p => p.plan_date === plan_date && p.locked)
    const lockedByCell = new Map(dayLocked.map(l => [`${l.plan_date}|${l.slot}`, l]))
    const specialDays = new Set(
      week.filter(d => plans.some(p => p.plan_date === d && p.slot === 'utama' && dishById.get(p.dish_id ?? '')?.tier === 'special')))

    // runPicks = whole week EXCEPT this day's non-locked rows
    const runPicks = plans
      .filter(p => !(p.plan_date === plan_date && !p.locked))
      .map(p => ({ plan_date: p.plan_date, slot: p.slot as Slot, dish_id: p.dish_id, dish_name: p.dish_name,
        locked: p.locked, role: (p.role ?? 'support') as Role, skipped: p.skipped ?? false }))
    const priorPlans = plans.filter(p => !new Set(week).has(p.plan_date))

    // explicit main choice → fix it by pre-inserting and locking that cell for the compose
    if (body.dish_id) {
      const chosen = dishById.get(body.dish_id)
      if (!chosen) return Response.json({ error: 'dish not found' }, { status: 404 })
      const mainPick = { plan_date, slot: 'utama' as Slot, dish_id: chosen.id, dish_name: chosen.name,
        locked: false, role: 'main' as Role, skipped: false }
      runPicks.push(mainPick)
      lockedByCell.set(`${plan_date}|utama`, { ...mainPick, id: '' } as unknown as MealPlan)
    }

    const dishesBySlot = Object.fromEntries(
      SLOTS.map(s => [s, allDishes.filter(d => d.slot === s)]),
    ) as Record<Slot, Dish[]>

    const created = composeDay({ date: plan_date, dishesBySlot, dishById, priorPlans, runPicks, lockedByCell, specialDays, rng })
    // if the main was an explicit choice, include that pick too (it wasn't "created")
    const toInsert = [...created]
    if (body.dish_id) toInsert.unshift({ plan_date, slot: 'utama' as Slot, dish_id: body.dish_id,
      dish_name: dishById.get(body.dish_id)!.name, locked: false, role: 'main' as Role, skipped: false })

    // delete the day's non-locked rows, insert the freshly composed set
    await supabase.from('meal_plans').delete().eq('plan_date', plan_date).eq('locked', false)
    if (toInsert.length) {
      const { error } = await supabase.from('meal_plans').insert(toInsert.map(p => ({
        plan_date: p.plan_date, slot: p.slot, dish_id: p.dish_id, dish_name: p.dish_name,
        locked: false, role: p.role, skipped: p.skipped,
      })))
      if (error) return Response.json({ error: error.message }, { status: 500 })
    }
    const { data: day } = await supabase.from('meal_plans').select(SELECT).eq('plan_date', plan_date)
    return Response.json({ day: (day ?? []) as MealPlan[] })
  }

  // ---- SUPPORT / OPTIONAL reroll → swap one ----
  const { week, allDishes, plans } = await loadWeek(plan_date)
  if (body.dish_id) {
    const d = allDishes.find(x => x.id === body.dish_id)
    if (!d) return Response.json({ error: 'dish not found' }, { status: 404 })
    const { data, error } = await supabase.from('meal_plans')
      .upsert({ plan_date, slot, dish_id: d.id, dish_name: d.name, locked: false, role: roleForSlot(slot), skipped: false },
        { onConflict: 'plan_date,slot' }).select(SELECT).single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ pick: data as MealPlan })
  }
  const { ctx, slotDishes } = buildSingleContext(plan_date, slot as Slot, allDishes, plans, week)
  const p = pickForSlot(slotDishes, ctx, rng)
  const { data, error } = await supabase.from('meal_plans')
    .upsert({ plan_date, slot, dish_id: p.dish_id, dish_name: p.dish_name, locked: false, role: roleForSlot(slot as Slot), skipped: false },
      { onConflict: 'plan_date,slot' }).select(SELECT).single()
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
  const { week, allDishes, plans } = await loadWeek(plan_date)
  const { ctx, slotDishes } = buildSingleContext(plan_date, slot, allDishes, plans, week)
  const pool = candidates(slotDishes, ctx)
    .map(d => ({ d, w: weightFor(d, ctx) }))
    .sort((a, b) => b.w - a.w)
    .slice(0, n)
    .map(({ d }) => ({ id: d.id, name: d.name }))
  return Response.json({ alternatives: pool })
}
```

- [ ] **Step 3: Smoke test both reroll shapes**

```bash
COOKIE='hs_session={"id":"00000000-0000-0000-0000-000000000000","name":"Test"}'
B=localhost:3000
# support swap
curl -s -X POST --cookie "$COOKIE" $B/api/meals/reroll -H 'content-type: application/json' -d '{"plan_date":"2026-08-10","slot":"sayuran"}' | head -c 160; echo
# main recompose
curl -s -X POST --cookie "$COOKIE" $B/api/meals/reroll -H 'content-type: application/json' -d '{"plan_date":"2026-08-10","slot":"utama"}' \
 | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const day=JSON.parse(s).day;console.log("day rows:",day.length,"main:",day.find(r=>r.role==="main")?.dish_name)})'
# alternatives
curl -s --cookie "$COOKIE" "$B/api/meals/reroll?plan_date=2026-08-10&slot=utama&alternatives=5" | head -c 200
```
Expected: support swap returns `{pick}`; main recompose returns `{day:[…]}` with a fresh plate; alternatives returns `{alternatives:[…]}`.

- [ ] **Step 4: Commit**

```bash
git add app/api/meals/reroll/route.ts
git commit -m "feat(meals): reroll re-composes on main, swaps one on support"
```

---

## Task 4: Hero plate Plan UI

**Files:**
- Modify: `app/meals/page.tsx`, `components/meals/PlanClient.tsx`

**Interfaces:**
- Consumes: reroll (`{day}` for main, `{pick}` for support), generate, week routes; `MealPlan` with `role`, `skipped`, `dishes` meta.

- [ ] **Step 1: Update the page fetch join**

In `app/meals/page.tsx`, change the select to include the new fields:
```ts
  const { data } = await supabase.from('meal_plans').select('*, dishes(tier, spicy, richness, provides_soup, recipe_image_url)')
    .gte('plan_date', days[0]).lte('plan_date', days[6])
```
Also change the `week` route (`app/api/meals/week/route.ts`) select identically so week navigation carries the same meta:
```ts
  const { data } = await supabase.from('meal_plans').select('*, dishes(tier, spicy, richness, provides_soup, recipe_image_url)')
    .gte('plan_date', days[0]).lte('plan_date', days[6])
```

- [ ] **Step 2: Rewrite PlanClient to hero plates**

Replace `components/meals/PlanClient.tsx` with the hero layout. Keep the week bar + Generate logic; replace the grid/`CellView` with `DayPlate` + `MainHero` + `SupportChip` + `DesertRow`. Full file:
```tsx
'use client'
import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Sparkles, Lock, Unlock, Shuffle, UtensilsCrossed } from 'lucide-react'
import { SLOT_LABELS, type MealPlan, type Slot, type Tier } from '@/lib/meals/types'
import { weekDates, currentMonday, shiftWeek } from '@/lib/meals/dates'

function label(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const TIER_STYLE: Record<Tier, string> = {
  everyday: 'bg-stone-100 text-stone-600', nice: 'bg-amber-100 text-amber-700', special: 'bg-orange-100 text-orange-700',
}

export default function PlanClient({ initialWeekStart, initialWeek }:
  { initialWeekStart: string; initialWeek: MealPlan[] }) {
  const [weekStart, setWeekStart] = useState(initialWeekStart)
  const [week, setWeek] = useState<MealPlan[]>(initialWeek)
  const [generating, setGenerating] = useState(false)
  const days = useMemo(() => weekDates(weekStart), [weekStart])

  function dayRows(date: string) { return week.filter(p => p.plan_date === date) }

  async function loadWeek(ws: string) {
    setWeekStart(ws)
    const res = await fetch(`/api/meals/week?weekStart=${ws}`)
    const { week } = await res.json(); setWeek(week ?? [])
  }
  async function generate() {
    setGenerating(true)
    try {
      const res = await fetch('/api/meals/generate', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ weekStart }),
      })
      const { week } = await res.json(); setWeek(week ?? [])
    } finally { setGenerating(false) }
  }

  // replace all rows for a day (main re-compose)
  function replaceDay(date: string, rows: MealPlan[]) {
    setWeek(w => [...w.filter(p => p.plan_date !== date), ...rows])
  }
  // replace a single cell (support swap / lock toggle)
  function replaceCell(row: MealPlan) {
    setWeek(w => {
      const i = w.findIndex(p => p.id === row.id || (p.plan_date === row.plan_date && p.slot === row.slot))
      if (i === -1) return [...w, row]
      const copy = [...w]; copy[i] = row; return copy
    })
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => loadWeek(shiftWeek(weekStart, -7))} className="p-2 rounded-lg hover:bg-stone-100 text-stone-600" aria-label="Previous week"><ChevronLeft size={18} /></button>
          <span className="text-sm font-medium text-stone-700 min-w-[9rem] text-center">{label(days[0])} – {label(days[6])}</span>
          <button onClick={() => loadWeek(shiftWeek(weekStart, 7))} className="p-2 rounded-lg hover:bg-stone-100 text-stone-600" aria-label="Next week"><ChevronRight size={18} /></button>
          <button onClick={() => loadWeek(currentMonday())} className="ml-1 text-sm text-stone-500 hover:text-stone-800 px-2 py-1">This week</button>
        </div>
        <button onClick={generate} disabled={generating}
          className="flex items-center gap-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors">
          <Sparkles size={16} /> {generating ? 'Generating…' : 'Generate Week'}
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {days.map((date, i) => (
          <DayPlate key={date} date={date} dayName={DAY_NAMES[i]} rows={dayRows(date)}
            onReplaceDay={replaceDay} onReplaceCell={replaceCell} />
        ))}
      </div>
    </div>
  )
}

function DayPlate({ date, dayName, rows, onReplaceDay, onReplaceCell }: {
  date: string; dayName: string; rows: MealPlan[]
  onReplaceDay: (date: string, rows: MealPlan[]) => void
  onReplaceCell: (row: MealPlan) => void
}) {
  const main = rows.find(r => r.role === 'main')
  const supports = rows.filter(r => r.role === 'support' && r.dish_id) // real support dishes
  const soupSkipped = rows.some(r => r.slot === 'kuah' && r.skipped)
  const desert = rows.find(r => r.role === 'optional')

  async function rerollMain(dishId?: string) {
    const res = await fetch('/api/meals/reroll', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan_date: date, slot: 'utama', ...(dishId ? { dish_id: dishId } : {}) }),
    })
    if (res.ok) { const { day } = await res.json(); onReplaceDay(date, day) }
  }

  return (
    <div className="bg-white border border-stone-200 rounded-2xl p-3 flex flex-col gap-3">
      <div className="text-xs font-semibold text-stone-500">{dayName} · <span className="text-stone-400">{label(date)}</span></div>
      {main
        ? <MainHero row={main} date={date} onReroll={rerollMain} onReplaceCell={onReplaceCell} />
        : <div className="aspect-video rounded-xl bg-stone-100 flex items-center justify-center text-stone-300"><UtensilsCrossed size={28} /></div>}

      <div className="flex gap-2 overflow-x-auto pb-1">
        {supports.map(s => <SupportChip key={s.id} row={s} date={date} onReplaceCell={onReplaceCell} />)}
        {soupSkipped && (
          <div className="shrink-0 text-[11px] text-stone-400 bg-stone-50 border border-stone-200 rounded-xl px-2.5 py-2 self-stretch flex items-center">
            🥣 broth from the main — no extra soup
          </div>
        )}
      </div>

      {desert && <DesertRow row={desert} date={date} onReplaceCell={onReplaceCell} />}
    </div>
  )
}

function useCellControls(date: string, row: MealPlan, onReplaceCell: (r: MealPlan) => void) {
  const [open, setOpen] = useState(false)
  const [alts, setAlts] = useState<{ id: string; name: string }[] | null>(null)
  async function toggleLock() {
    const next = !row.locked
    onReplaceCell({ ...row, locked: next })
    const res = await fetch(`/api/meals/plan/${row.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ locked: next }),
    })
    if (!res.ok) onReplaceCell({ ...row, locked: !next })
  }
  async function openAlts() {
    setOpen(true)
    if (alts) return
    const res = await fetch(`/api/meals/reroll?plan_date=${date}&slot=${row.slot}&alternatives=5`)
    const { alternatives } = await res.json(); setAlts(alternatives ?? [])
  }
  return { open, setOpen, alts, setAlts, toggleLock, openAlts }
}

function MainHero({ row, date, onReroll, onReplaceCell }: {
  row: MealPlan; date: string
  onReroll: (dishId?: string) => void
  onReplaceCell: (r: MealPlan) => void
}) {
  const { open, setOpen, alts, openAlts, toggleLock } = useCellControls(date, row, onReplaceCell)
  const tier = row.dishes?.tier; const spicy = row.dishes?.spicy
  const img = row.dishes?.recipe_image_url
  return (
    <div className={`relative rounded-xl overflow-hidden border ${tier === 'special' ? 'border-orange-300 ring-1 ring-orange-200' : 'border-stone-200'}`}>
      <div className="aspect-video w-full bg-gradient-to-br from-stone-100 to-orange-50 flex items-center justify-center">
        {img ? <img src={img} alt={row.dish_name ?? ''} className="w-full h-full object-cover" /> : <UtensilsCrossed size={30} className="text-orange-300" />}
      </div>
      <div className="absolute top-1.5 right-1.5 flex gap-1">
        <button onClick={toggleLock} title={row.locked ? 'Unlock' : 'Lock'}
          className={`p-1 rounded-lg bg-white/85 backdrop-blur ${row.locked ? 'text-orange-600' : 'text-stone-400 hover:text-stone-700'}`}>
          {row.locked ? <Lock size={14} /> : <Unlock size={14} />}
        </button>
        <button onClick={openAlts} title="Want something else?" className="p-1 rounded-lg bg-white/85 backdrop-blur text-stone-400 hover:text-stone-700"><Shuffle size={14} /></button>
      </div>
      <div className="p-2.5">
        <div className="text-stone-900 font-medium leading-snug" style={{ fontFamily: 'DM Serif Display, serif' }}>{row.dish_name ?? '—'}</div>
        <div className="flex items-center gap-1.5 mt-1">
          {tier && <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${TIER_STYLE[tier]}`}>{tier}</span>}
          {spicy && <span title="Spicy">🌶️</span>}
        </div>
      </div>
      {open && (
        <div className="absolute z-20 left-2 right-2 bottom-2 bg-white border border-stone-200 rounded-xl shadow-lg p-1">
          <button onClick={() => { setOpen(false); onReroll() }} className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-orange-50 text-orange-700 font-medium text-sm">🎲 Surprise me (new plate)</button>
          {alts?.map(a => (
            <button key={a.id} onClick={() => { setOpen(false); onReroll(a.id) }} className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-stone-50 text-stone-700 text-sm truncate">{a.name}</button>
          ))}
          <button onClick={() => setOpen(false)} className="w-full text-left px-2 py-1.5 rounded-lg text-stone-400 hover:bg-stone-50 text-sm">Cancel</button>
        </div>
      )}
    </div>
  )
}

function SupportChip({ row, date, onReplaceCell }: { row: MealPlan; date: string; onReplaceCell: (r: MealPlan) => void }) {
  const { open, setOpen, alts, openAlts, toggleLock } = useCellControls(date, row, onReplaceCell)
  const spicy = row.dishes?.spicy
  async function swap(dishId?: string) {
    const res = await fetch('/api/meals/reroll', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan_date: date, slot: row.slot, ...(dishId ? { dish_id: dishId } : {}) }),
    })
    if (res.ok) { const { pick } = await res.json(); onReplaceCell(pick) }
    setOpen(false)
  }
  return (
    <div className="relative shrink-0 w-32 bg-stone-50 border border-stone-200 rounded-xl px-2.5 py-2">
      <div className="flex items-center justify-between">
        <span className="text-[9px] uppercase tracking-wide text-stone-400">{SLOT_LABELS[row.slot]}</span>
        <div className="flex gap-0.5">
          <button onClick={toggleLock} className={`p-0.5 ${row.locked ? 'text-orange-600' : 'text-stone-300 hover:text-stone-600'}`}>{row.locked ? <Lock size={12} /> : <Unlock size={12} />}</button>
          <button onClick={openAlts} className="p-0.5 text-stone-300 hover:text-stone-600"><Shuffle size={12} /></button>
        </div>
      </div>
      <div className="text-xs text-stone-700 mt-0.5 leading-snug">{row.dish_name} {spicy && '🌶️'}</div>
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

function DesertRow({ row, date, onReplaceCell }: { row: MealPlan; date: string; onReplaceCell: (r: MealPlan) => void }) {
  const { open, setOpen, alts, openAlts, toggleLock } = useCellControls(date, row, onReplaceCell)
  async function swap(dishId?: string) {
    const res = await fetch('/api/meals/reroll', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan_date: date, slot: 'desert', ...(dishId ? { dish_id: dishId } : {}) }),
    })
    if (res.ok) { const { pick } = await res.json(); onReplaceCell(pick) }
    setOpen(false)
  }
  return (
    <div className="relative flex items-center justify-between text-xs text-stone-400 border-t border-stone-100 pt-2">
      <span className="truncate">· desert: <span className="text-stone-500">{row.dish_name}</span></span>
      <div className="flex gap-0.5">
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

- [ ] **Step 3: Manual check (desktop + mobile)**

Run dev; `/meals`. Generate Week. Verify:
- Each day is a plate: big main hero (placeholder gradient + glyph since no images), supports as small chips below, desert tiny at bottom.
- Heavy-main days show only a veg chip; medium/light show veg + side.
- A soup-providing main shows the "🥣 broth from the main" chip, no soup card.
- Main "Surprise me / pick" re-composes the whole day; support/desert reroll swaps just that one; lock persists across Generate.
- Special mains get the orange ring.
- Mobile (narrow): single column, hero big, support chips scroll horizontally.

- [ ] **Step 4: Commit**

```bash
git add app/meals/page.tsx app/api/meals/week/route.ts components/meals/PlanClient.tsx
git commit -m "feat(meals): hero-plate plan view (main + supports + desert)"
```

---

## Task 5: Verification + build

- [ ] **Step 1: Unit tests** — Run `npm test`; expected all green (dates, engine compose suite, shopping).
- [ ] **Step 2: Build** — Run `npm run build` (sandbox-disabled if the bundler needs a port); expected no type errors; `/meals`, generate/reroll routes present.
- [ ] **Step 3: End-to-end manual pass** — home → /meals; Generate composes plates; richness budgets correct (heavy=2 items, medium/light=3); soup-skip note where applicable; main reroll re-composes; support/desert reroll swaps one; lock survives Generate; week nav loads per-week; Dishes + Shopping tabs still work.
- [ ] **Step 4: Commit any fixes**
```bash
git add -A
git commit -m "fix(meals): resolve build/type issues from compose redesign verification"
```

---

## Self-Review Notes (for the planner, not a task)

- **Spec coverage:** compose algorithm + budgets + soup-skip + roles (T1); persistence delete-insert (T2); reroll recompose vs swap (T3); hero UI + soup note + desert de-emphasis (T4); adapted spicy floor + fried cap + specials (T1 tests); tests (T1). ✅
- **Type ripple:** `Pick`/`MealPlan` gaining `role`/`skipped` touches engine test helpers (updated in T1 Step 2) and the reroll/generate routes (T2/T3). Shopping builder reads only `dish_id`/`dish_name`/`ingredients` → unaffected by skipped rows (dish_id null is already ignored).
- **Locked handling:** `composeDay` never creates a row for a locked slot, so the delete-non-locked + insert cannot collide with the `unique(plan_date, slot)` constraint.
- **Consistency:** reroll returns `{ day }` for `slot==='utama'` and `{ pick }` otherwise; `PlanClient` calls the matching branch (`onReplaceDay` vs `onReplaceCell`). `SELECT` join is identical across generate/reroll/week/page so every `MealPlan.dishes` carries `richness`+`provides_soup`.
