# Saltiness + Difficulty Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `saltiness` and `difficulty` dish attributes, edit them in the Dishes editor, and use them in generation: a per-day saltiness cap + mild-main preference, and a per-week hard-dish quota coordinated with the special-tier quota.

**Architecture:** Pure engine changes (new hard rules + a weight bias + a hard-day preassignment) added to the existing TDD'd `lib/meals/engine.ts`; routes pass the fields through unchanged (`select('*')`); the editor gains two inline controls.

**Tech Stack:** Next.js 16.2.4, TypeScript (strict), Supabase JS (anon, `lib/supabase.ts`), lucide-react, Vitest.

## Global Constraints

- **Engine stays pure** (no Supabase/Next imports). All new rules are unit-tested.
- **`relax` boolean semantics:** `false` = rule ENFORCED, `true` = relaxed (matches existing `spicy`/`fried`).
- **Never relax** no-repeat below 2 days or protein rotation (except the existing last-resort fallback).
- **Supabase** via shared `supabase`; anon key; no migration (columns already exist). Design system unchanged.

---

## File Structure

**Modify:**
- `lib/meals/types.ts` — `Saltiness`, `Difficulty`; `Dish` += both.
- `lib/meals/engine.ts` — `PickContext` (`hardDays` + relax flags), `saltinessOk`, `difficultyOk`, `weightFor` bias, `preassignHardDays`, `RELAX_LADDER`, `composeDay`/`generateWeek` wiring, `ENFORCED` constant, `nextDay`.
- `lib/meals/engine.test.ts` — fixture defaults + new tests.
- `app/api/meals/dishes/route.ts` — POST defaults.
- `app/api/meals/dishes/[id]/route.ts` — PATCH `FIELDS`.
- `app/api/meals/reroll/route.ts` — derive `hardDays` for single reroll + recompose.
- `components/meals/DishesClient.tsx` — Saltiness + Difficulty columns.

---

## Task 1: Types + test fixtures

**Files:** `lib/meals/types.ts`, `lib/meals/engine.test.ts`

- [ ] **Step 1: Add types**

In `lib/meals/types.ts`, after `Richness`:
```ts
export type Saltiness = 'normal' | 'salty' | 'very_salty'
export type Difficulty = 'easy' | 'medium' | 'hard'
```
In `Dish`, add:
```ts
  saltiness: Saltiness
  difficulty: Difficulty
```

- [ ] **Step 2: Update the engine test `dish()` fixture so existing tests still compile**

In `lib/meals/engine.test.ts`, add the two fields to the `dish()` helper defaults:
```ts
    ingredients: null, recipe_steps: null, recipe_image_url: null,
    richness: 'medium', provides_soup: false,
    saltiness: 'normal', difficulty: 'medium', ...over,
```

- [ ] **Step 3: Run tests to confirm the suite still compiles/passes**

Run: `npm test -- engine`
Expected: PASS (no behavior change yet).

- [ ] **Step 4: Commit**

```bash
git add lib/meals/types.ts lib/meals/engine.test.ts
git commit -m "feat(meals): add saltiness/difficulty to Dish type"
```

---

## Task 2: Engine rules

**Files:** `lib/meals/engine.ts`, `lib/meals/engine.test.ts`

**Interfaces:**
- Produces: `saltinessOk`, `difficultyOk`, `preassignHardDays`, `ENFORCED`; `weightFor` bias; `PickContext.hardDays` + relax flags `saltyCap`/`hardDay`/`hardSpacing`; `composeDay` gains a `hardDays` input.

- [ ] **Step 1: Write failing tests**

Append to `lib/meals/engine.test.ts` (the `ctx()` helper must supply the new fields — update it too):

Update the `ctx()` helper's returned object to include:
```ts
    hardDays: over.hardDays ?? new Set<string>(),
    relax: over.relax ?? { spicy: false, fried: false, saltyCap: false, hardDay: false, hardSpacing: false, noRepeatFactor: 1 },
```
(Add `hardDays?: Set<string>` handling via the `Partial<PickContext>` the helper already spreads.)

New tests:
```ts
import { saltinessOk, difficultyOk, preassignHardDays } from './engine'

describe('saltinessOk (max 1 non-normal per day)', () => {
  it('allows a normal dish always', () => {
    const d = dish({ id: 'n', slot: 'utama', saltiness: 'normal' })
    expect(saltinessOk(d, ctx({ date: '2026-08-13', slot: 'utama', dishes: [d] }))).toBe(true)
  })
  it('rejects a 2nd non-normal dish on the same day', () => {
    const salty = dish({ id: 's', slot: 'pelengkap', saltiness: 'salty' })
    const c = ctx({ date: '2026-08-13', slot: 'pelengkap', dishes: [salty],
      runPicks: [pick({ plan_date: '2026-08-13', slot: 'utama', dish_id: 'v' })] })
    c.dishById.set('v', dish({ id: 'v', slot: 'utama', saltiness: 'very_salty' }))
    expect(saltinessOk(salty, c)).toBe(false)
  })
  it('is relaxable via relax.saltyCap', () => {
    const salty = dish({ id: 's', slot: 'pelengkap', saltiness: 'salty' })
    const c = ctx({ date: '2026-08-13', slot: 'pelengkap', dishes: [salty],
      relax: { spicy: false, fried: false, saltyCap: true, hardDay: false, hardSpacing: false, noRepeatFactor: 1 },
      runPicks: [pick({ plan_date: '2026-08-13', slot: 'utama', dish_id: 'v' })] })
    c.dishById.set('v', dish({ id: 'v', slot: 'utama', saltiness: 'very_salty' }))
    expect(saltinessOk(salty, c)).toBe(true)
  })
})

describe('difficultyOk (hard: hard-days only, <=1/day, non-adjacent)', () => {
  it('non-hard dishes always pass', () => {
    const d = dish({ id: 'e', slot: 'utama', difficulty: 'easy' })
    expect(difficultyOk(d, ctx({ date: '2026-08-13', slot: 'utama', dishes: [d] }))).toBe(true)
  })
  it('rejects a hard dish off a hard-day', () => {
    const d = dish({ id: 'h', slot: 'utama', difficulty: 'hard' })
    const c = ctx({ date: '2026-08-13', slot: 'utama', dishes: [d], hardDays: new Set(['2026-08-11']) })
    expect(difficultyOk(d, c)).toBe(false)
  })
  it('allows a hard dish on a hard-day with no prior hard', () => {
    const d = dish({ id: 'h', slot: 'utama', difficulty: 'hard' })
    const c = ctx({ date: '2026-08-13', slot: 'utama', dishes: [d], hardDays: new Set(['2026-08-13']) })
    expect(difficultyOk(d, c)).toBe(true)
  })
  it('rejects a 2nd hard dish on the same day', () => {
    const d = dish({ id: 'h2', slot: 'pelengkap', difficulty: 'hard' })
    const c = ctx({ date: '2026-08-13', slot: 'pelengkap', dishes: [d], hardDays: new Set(['2026-08-13']),
      runPicks: [pick({ plan_date: '2026-08-13', slot: 'utama', dish_id: 'h1' })] })
    c.dishById.set('h1', dish({ id: 'h1', slot: 'utama', difficulty: 'hard' }))
    expect(difficultyOk(d, c)).toBe(false)
  })
  it('is relaxable via relax.hardDay', () => {
    const d = dish({ id: 'h', slot: 'utama', difficulty: 'hard' })
    const c = ctx({ date: '2026-08-13', slot: 'utama', dishes: [d], hardDays: new Set(),
      relax: { spicy: false, fried: false, saltyCap: false, hardDay: true, hardSpacing: true, noRepeatFactor: 1 } })
    expect(difficultyOk(d, c)).toBe(true)
  })
})

describe('preassignHardDays', () => {
  const WEEK2 = ['2026-08-10','2026-08-11','2026-08-12','2026-08-13','2026-08-14','2026-08-15','2026-08-16']
  it('includes the special days and tops up to 2 non-adjacent', () => {
    const hd = preassignHardDays(WEEK2, new Set(['2026-08-12']), seq([0.1,0.5,0.9,0.3,0.7,0.2]))
    expect(hd.has('2026-08-12')).toBe(true)
    expect(hd.size).toBe(2)
    const idx = [...hd].map(d => WEEK2.indexOf(d)).sort((a,b)=>a-b)
    expect(idx[1] - idx[0]).toBeGreaterThanOrEqual(2)
  })
  it('keeps 2 special days as-is', () => {
    const hd = preassignHardDays(WEEK2, new Set(['2026-08-10','2026-08-13']), seq([0.5]))
    expect([...hd].sort()).toEqual(['2026-08-10','2026-08-13'])
  })
})

describe('weightFor mild-main bias', () => {
  it('favors a normal-saltiness main over a very_salty one (equal rating)', () => {
    const normal = dish({ id: 'n', slot: 'utama', saltiness: 'normal', rating: 3 })
    const vs = dish({ id: 'v', slot: 'utama', saltiness: 'very_salty', rating: 3 })
    const c = ctx({ date: '2026-08-13', slot: 'utama', dishes: [normal, vs], role: 'main' })
    expect(weightFor(normal, c)).toBeGreaterThan(weightFor(vs, c))
  })
  it('does not bias non-main slots', () => {
    const normal = dish({ id: 'n', slot: 'pelengkap', saltiness: 'normal', rating: 3 })
    const vs = dish({ id: 'v', slot: 'pelengkap', saltiness: 'very_salty', rating: 3 })
    const c = ctx({ date: '2026-08-13', slot: 'pelengkap', dishes: [normal, vs], role: 'support' })
    expect(weightFor(normal, c)).toBe(weightFor(vs, c))
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- engine`
Expected: FAIL — new exports undefined; `PickContext` missing fields.

- [ ] **Step 3: Extend PickContext + add ENFORCED**

In `lib/meals/engine.ts`, change `PickContext`:
```ts
export type PickContext = {
  date: string
  slot: Slot
  priorPlans: MealPlan[]
  runPicks: Pick[]
  dishById: Map<string, Dish>
  specialDays: Set<string>
  hardDays: Set<string>
  relax: { spicy: boolean; fried: boolean; saltyCap: boolean; hardDay: boolean; hardSpacing: boolean; noRepeatFactor: number }
  role: Role
  spicyFloor: number
  plannedRemaining: number
}

export const ENFORCED: PickContext['relax'] =
  { spicy: false, fried: false, saltyCap: false, hardDay: false, hardSpacing: false, noRepeatFactor: 1 }
```

- [ ] **Step 4: Add saltinessOk, difficultyOk, nextDay; wire into passesHardRules**

```ts
export function saltinessOk(dish: Dish, ctx: PickContext): boolean {
  if (ctx.relax.saltyCap) return true
  if (dish.saltiness === 'normal') return true
  const dayHasNonNormal = picksForDate(ctx, ctx.date).some(p => {
    const d = resolveDish(ctx, p.dish_id)
    return !!d && d.saltiness !== 'normal'
  })
  return !dayHasNonNormal
}

export function difficultyOk(dish: Dish, ctx: PickContext): boolean {
  if (dish.difficulty !== 'hard') return true
  if (!ctx.relax.hardDay) {
    if (!ctx.hardDays.has(ctx.date)) return false
    const dayHasHard = picksForDate(ctx, ctx.date).some(p => resolveDish(ctx, p.dish_id)?.difficulty === 'hard')
    if (dayHasHard) return false
  }
  if (!ctx.relax.hardSpacing) {
    for (const ad of [prevDay(ctx.date), nextDay(ctx.date)]) {
      const hardAdj = [...ctx.runPicks, ...ctx.priorPlans].some(
        p => p.plan_date === ad && resolveDish(ctx, p.dish_id)?.difficulty === 'hard')
      if (hardAdj) return false
    }
  }
  return true
}
```
Add `nextDay` next to `prevDay`:
```ts
function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() + 1)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
```
Add both to `passesHardRules`:
```ts
export function passesHardRules(dish: Dish, ctx: PickContext): boolean {
  return (
    dish.active &&
    dish.slot === ctx.slot &&
    noRepeatOk(dish, ctx) &&
    proteinOk(dish, ctx) &&
    specialOk(dish, ctx) &&
    friedOk(dish, ctx) &&
    spicyOk(dish, ctx) &&
    saltinessOk(dish, ctx) &&
    difficultyOk(dish, ctx)
  )
}
```

- [ ] **Step 5: Add the mild-main weight bias**

```ts
function saltMainFactor(dish: Dish, ctx: PickContext): number {
  if (ctx.role !== 'main') return 1
  return dish.saltiness === 'normal' ? 1.4 : dish.saltiness === 'very_salty' ? 0.5 : 1
}

export function weightFor(dish: Dish, ctx: PickContext): number {
  return dish.rating * dish.rating * freshnessFactor(dish, ctx) * saltMainFactor(dish, ctx)
}
```

- [ ] **Step 6: Add preassignHardDays**

```ts
export function preassignHardDays(days: string[], specialDays: Set<string>, rng: Rng): Set<string> {
  const result = new Set<string>(specialDays)
  const isAdjacent = (d: string) => [...result].some(r => Math.abs(days.indexOf(r) - days.indexOf(d)) < 2)
  for (const d of shuffle(days.filter(x => !result.has(x)), rng)) {
    if (result.size >= 2) break
    if (!isAdjacent(d)) result.add(d)
  }
  return result
}
```

- [ ] **Step 7: Rebuild RELAX_LADDER (drop-first cumulative order) + last resort + pickForSlot**

```ts
const RELAX_LADDER: { relax: PickContext['relax']; note?: string }[] = [
  { relax: { ...ENFORCED } },
  { relax: { ...ENFORCED, hardSpacing: true }, note: 'relaxed: hard-day spacing' },
  { relax: { ...ENFORCED, hardSpacing: true, hardDay: true }, note: 'relaxed: hard-day restriction' },
  { relax: { ...ENFORCED, hardSpacing: true, hardDay: true, saltyCap: true }, note: 'relaxed: saltiness cap' },
  { relax: { ...ENFORCED, hardSpacing: true, hardDay: true, saltyCap: true, spicy: true }, note: 'relaxed: + spicy floor' },
  { relax: { ...ENFORCED, hardSpacing: true, hardDay: true, saltyCap: true, spicy: true, fried: true }, note: 'relaxed: + fried cap' },
  { relax: { spicy: true, fried: true, saltyCap: true, hardDay: true, hardSpacing: true, noRepeatFactor: 0.5 }, note: 'relaxed: + short no-repeat' },
]
```
In `pickForSlot`, change the last-resort `lastCtx.relax` to the fully-relaxed object:
```ts
  const lastCtx: PickContext = { ...ctx, relax: { spicy: true, fried: true, saltyCap: true, hardDay: true, hardSpacing: true, noRepeatFactor: 0.5 } }
```

- [ ] **Step 8: Thread hardDays through composeDay + generateWeek**

In `composeDay`'s input type, add `hardDays: Set<string>`; destructure it; and update `mkCtx` to include `hardDays` and the full relax object:
```ts
export function composeDay(input: {
  date: string; dishesBySlot: Record<Slot, Dish[]>; dishById: Map<string, Dish>
  priorPlans: MealPlan[]; runPicks: Pick[]; lockedByCell: Map<string, MealPlan>
  specialDays: Set<string>; hardDays: Set<string>; rng: Rng
}): Pick[] {
  const { date, dishesBySlot, dishById, priorPlans, runPicks, lockedByCell, specialDays, hardDays, rng } = input
  const created: Pick[] = []
  const mkCtx = (slot: Slot, role: Role, plannedRemaining: number): PickContext => ({
    date, slot, priorPlans, runPicks, dishById, specialDays, hardDays,
    relax: { ...ENFORCED },
    role, spicyFloor: 1, plannedRemaining,
  })
  // …rest unchanged…
```
In `generateWeek`, compute and pass `hardDays`:
```ts
  const specialDays = preassignSpecialDays(days, lockedCells, dishById, rng)
  const hardDays = preassignHardDays(days, specialDays, rng)
  // …
  for (const date of days) {
    composeDay({ date, dishesBySlot, dishById, priorPlans, runPicks, lockedByCell, specialDays, hardDays, rng })
  }
```

- [ ] **Step 9: Add the generateWeek integration test**

Append:
```ts
describe('generateWeek (saltiness + difficulty)', () => {
  it('keeps <=2 hard/week on special, non-adjacent days and <=1 salty accent/day', () => {
    const mk = (slot: Slot, n: number, over: (i: number) => Partial<Dish> = () => ({})) =>
      Array.from({ length: n }, (_, i) => dish({ id: `${slot}-${i}`, slot, ...over(i),
        protein: slot === 'utama' ? ['beef','chicken','fish','egg','tofu_tempe','shrimp','duck'][i % 7] : 'none' }))
    const dishesBySlot = {
      utama: mk('utama', 12, i => ({ tier: i < 3 ? 'special' : 'everyday', difficulty: i < 4 ? 'hard' : 'medium' })),
      kuah: mk('kuah', 8, i => ({ difficulty: i === 0 ? 'hard' : 'easy', saltiness: i === 1 ? 'salty' : 'normal' })),
      pelengkap: mk('pelengkap', 9, i => ({ saltiness: i < 3 ? 'very_salty' : 'normal' })),
      sayuran: mk('sayuran', 8), desert: mk('desert', 8),
    }
    const all = Object.values(dishesBySlot).flat()
    const byId = new Map(all.map(d => [d.id, d]))
    const picks = generateWeek({ weekStart: '2026-08-10', days: WEEK, dishesBySlot, allDishes: all,
      priorPlans: [], lockedCells: [], rng: seq([0.3,0.6,0.1,0.8,0.5,0.2,0.9,0.4,0.7,0.05]) })
    // <=1 non-normal saltiness per day
    for (const date of WEEK) {
      const nonNormal = picks.filter(p => p.plan_date === date && !p.skipped && byId.get(p.dish_id ?? '')?.saltiness && byId.get(p.dish_id!)!.saltiness !== 'normal')
      expect(nonNormal.length).toBeLessThanOrEqual(1)
    }
    // hard dishes: <=2, non-adjacent, on special-main days
    const hardDates = [...new Set(picks.filter(p => byId.get(p.dish_id ?? '')?.difficulty === 'hard').map(p => WEEK.indexOf(p.plan_date)))].sort((a,b)=>a-b)
    expect(hardDates.length).toBeLessThanOrEqual(2)
    if (hardDates.length === 2) expect(hardDates[1] - hardDates[0]).toBeGreaterThanOrEqual(2)
  })
})
```
(`WEEK` and `seq` already exist in the file.)

- [ ] **Step 10: Run the full suite**

Run: `npm test`
Expected: all green (existing + new).

- [ ] **Step 11: Commit**

```bash
git add lib/meals/engine.ts lib/meals/engine.test.ts
git commit -m "feat(meals): saltiness cap + mild-main bias and hard-dish weekly quota"
```

---

## Task 3: Routes — defaults, PATCH fields, reroll hardDays

**Files:** `app/api/meals/dishes/route.ts`, `app/api/meals/dishes/[id]/route.ts`, `app/api/meals/reroll/route.ts`

- [ ] **Step 1: POST defaults**

In `app/api/meals/dishes/route.ts`, add to the `insert({...})`:
```ts
    saltiness: body.saltiness ?? 'normal', difficulty: body.difficulty ?? 'medium',
```

- [ ] **Step 2: PATCH FIELDS**

In `app/api/meals/dishes/[id]/route.ts`, extend `FIELDS`:
```ts
const FIELDS = ['name', 'slot', 'protein', 'tier', 'method', 'spicy', 'rating', 'active', 'no_repeat_days', 'ingredients', 'recipe_steps', 'recipe_image_url', 'saltiness', 'difficulty']
```

- [ ] **Step 3: Reroll — derive hardDays + full relax + specialDays for both paths**

In `app/api/meals/reroll/route.ts`:
- Import `ENFORCED` and `preassignSpecialDays` is not needed; derive from week rows.
- Add a helper right after `loadWeek`:
```ts
function deriveDays(week: string[], plans: MealPlan[], dishById: Map<string, Dish>) {
  const weekSet = new Set(week)
  const specialDays = new Set(week.filter(d => plans.some(p =>
    p.plan_date === d && p.slot === 'utama' && dishById.get(p.dish_id ?? '')?.tier === 'special')))
  const hardDays = new Set<string>(specialDays)
  for (const p of plans) if (weekSet.has(p.plan_date) && dishById.get(p.dish_id ?? '')?.difficulty === 'hard') hardDays.add(p.plan_date)
  return { specialDays, hardDays }
}
```
- In `buildSingleContext`, replace the inline `specialDays` computation with `deriveDays`, add `hardDays`, and use the full relax object:
```ts
  const { specialDays, hardDays } = deriveDays(week, plans, dishById)
  const ctx: PickContext = {
    date: plan_date, slot, priorPlans, runPicks, dishById, specialDays, hardDays,
    relax: { spicy: false, fried: false, saltyCap: false, hardDay: false, hardSpacing: false, noRepeatFactor: 1 },
    role: roleForSlot(slot), spicyFloor: 1, plannedRemaining: 5,
  }
```
- In the **main recompose** branch, replace the inline `specialDays` with `deriveDays(...)` and pass `hardDays` to `composeDay`:
```ts
    const { specialDays, hardDays } = deriveDays(week, plans, dishById)
    // …
    const created = composeDay({ date: plan_date, dishesBySlot, dishById, priorPlans, runPicks, lockedByCell, specialDays, hardDays, rng })
```

- [ ] **Step 4: Smoke test**

Start dev; with a session cookie:
```bash
COOKIE='hs_session={"id":"00000000-0000-0000-0000-000000000000","name":"Test"}'
curl -s -X POST --cookie "$COOKIE" localhost:3000/api/meals/generate -H 'content-type: application/json' -d '{"weekStart":"2026-08-10"}' \
 | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const w=JSON.parse(s).week;console.log("rows",w.length,"ok")})'
```
Expected: 200, week generated (no crash). Deeper rule verification is covered by unit tests.

- [ ] **Step 5: Commit**

```bash
git add app/api/meals/dishes/route.ts app/api/meals/dishes/[id]/route.ts app/api/meals/reroll/route.ts
git commit -m "feat(meals): pass saltiness/difficulty through routes; reroll hard-days"
```

---

## Task 4: Dishes editor columns

**Files:** `components/meals/DishesClient.tsx`

- [ ] **Step 1: Add column headers**

Add two `<th>`s (after Method, before Spicy is fine — keep near the other attributes). E.g. after the `Method` header add:
```tsx
                    <th className="px-3 py-2 font-medium">Salt</th>
                    <th className="px-3 py-2 font-medium">Difficulty</th>
```
Bump the empty-state `colSpan` from 9 to 11.

- [ ] **Step 2: Add the constants + row cells**

Near the other constants at the top of the file:
```ts
const SALTINESS: { value: string; label: string }[] = [
  { value: 'normal', label: 'normal' }, { value: 'salty', label: 'salty' }, { value: 'very_salty', label: 'very salty' },
]
const DIFFICULTY = ['easy', 'medium', 'hard'] as const
const DIFF_LEVEL: Record<string, number> = { easy: 1, medium: 2, hard: 3 }
const DIFF_COLOR: Record<string, string> = { easy: 'bg-green-400', medium: 'bg-amber-400', hard: 'bg-red-400' }
```
In `DishRow`, add two `<td>`s (place them right after the Method `<td>`):
```tsx
      <td className="px-3 py-1.5">
        <select value={dish.saltiness} onChange={e => onPatch(dish.id, { saltiness: e.target.value as Dish['saltiness'] })}
          className="bg-transparent text-stone-600 focus:outline-none">
          {SALTINESS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </td>
      <td className="px-3 py-1.5">
        <div className="flex items-center gap-1" role="group" aria-label="Difficulty">
          {DIFFICULTY.map((lvl, i) => (
            <button key={lvl} onClick={() => onPatch(dish.id, { difficulty: lvl })} aria-label={lvl}
              title={lvl}
              className={`w-2.5 h-2.5 rounded-full transition-colors ${
                DIFF_LEVEL[dish.difficulty] >= i + 1 ? DIFF_COLOR[dish.difficulty] : 'bg-stone-200'}`} />
          ))}
        </div>
      </td>
```
Ensure `Dish` is imported (it already is).

- [ ] **Step 3: Manual check**

Run dev; `/meals/dishes`. Verify: Salt select changes + persists; Difficulty pips show 1/2/3 filled (green/amber/red), clicking a pip sets easy/medium/hard and persists (reload to confirm). Columns align; horizontal scroll still fine.

- [ ] **Step 4: Commit**

```bash
git add components/meals/DishesClient.tsx
git commit -m "feat(meals): add saltiness + difficulty controls to dishes editor"
```

---

## Task 5: Verification + build

- [ ] **Step 1: Unit tests** — `npm test`; all green.
- [ ] **Step 2: Build** — `npm run build`; no type errors.
- [ ] **Step 3: E2E** — generate a week (200, no crash); spot-check a generated week has ≤2 hard dates (non-adjacent, on special days) and ≤1 salty accent/day via a quick node query; edit saltiness/difficulty in the editor and confirm persistence.
- [ ] **Step 4: Commit any fixes**
```bash
git add -A && git commit -m "fix(meals): resolve issues from saltiness/difficulty verification"
```

---

## Self-Review Notes (for the planner, not a task)

- **Spec coverage:** types (T1); saltiness cap + mild-main bias, hard quota + preassignHardDays + relaxation order (T2); route pass-through + reroll hard-days (T3); editor controls (T4); tests (T2). ✅
- **Relax object churn:** every `PickContext.relax` literal now needs all 6 fields — covered at `mkCtx` (T2 S8), `buildSingleContext` (T3), the ladder + last-resort (T2 S7), and the test `ctx()` helper (T2 S1). `ENFORCED` reduces mistakes.
- **Coordination correctness:** `preassignHardDays` seeds from `specialDays`, so hard nights ⊆ (specials ∪ ≤ topped-up), non-adjacent; `difficultyOk` caps ≤1 hard/day → ≤2/week; the special quota is unchanged, so no 4-heavy-night risk.
- **Type consistency:** `Dish.saltiness/difficulty` unions used in editor casts and engine rules; `PickContext.hardDays` present at all construction sites (composeDay, reroll single + recompose, tests).
