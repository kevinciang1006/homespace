# Prep-First Day Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Invert `/meals/day/[date]` to lead with a checkable, persisted prep checklist (derived from the plan via `prep_tasks`), with today's finished meals moved below as smaller secondary reference.

**Architecture:** A new pure module (`lib/meals/prepTasks.ts`) derives what `prep_tasks` rows a week needs from its planned dishes' `prep_type`/`prep_lead_days`/`prep_note`. Two call sites persist these via an insert-only dedup (never touching an existing row, so a checked `done` is never reset): `POST /api/meals/generate` (proactive, on every full-week generate) and the day page's server component (a lazy backfill for weeks that predate this feature). The day page itself is restructured so the prep checklist renders first.

**Tech Stack:** Next.js App Router, Supabase, vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-prep-first-day-page-design.md`

## Global Constraints

- No migration needed — `prep_tasks`, `dishes.prep_type`, and
  `dishes.shop_ingredients` already exist in the DB.
- `lib/meals/prep.ts` (the existing `groupPrepByDate`/`prepPhrase` module
  used by the WA cron route's `buildPrepBatches`) is **not touched** —
  per the spec's non-goals, WhatsApp integration is Batch 4 and that
  code is already shipped and tested.
- Reroll does **not** reconcile `prep_tasks` in this batch (per the
  approved design) — only `POST /api/meals/generate` and the day page's
  lazy backfill create prep tasks.
- `dishes.needs_thaw`/`needs_marinate` are not read by any new code in
  this plan — `prep_type` is the sole driver.
- Day-name formatting must be deterministic (fixed `'en-US'` locale, not
  `undefined`), since one of the new functions needs to be pure/testable.

---

### Task 1: `lib/meals/dates.ts` — shared `dayNameShort` helper

**Files:**
- Modify: `lib/meals/dates.ts`
- Modify: `lib/meals/dates.test.ts`

**Interfaces:**
- Produces: `dayNameShort(dateStr: string): string` — e.g. `dayNameShort('2026-08-24')` → `'Mon'`. Consumed by Task 4 (`lib/meals/prepTasks.ts`) and Task 7 (the day page, replacing its local duplicate).

- [ ] **Step 1: Write the failing test**

Add to `lib/meals/dates.test.ts`:
```ts
describe('dayNameShort', () => {
  it('formats a date as a short English weekday name', () => {
    expect(dayNameShort('2026-08-24')).toBe('Mon')
    expect(dayNameShort('2026-08-30')).toBe('Sun')
  })
})
```
And add `dayNameShort` to the existing import line at the top of the file:
```ts
import { isoDate, weekDates, daysBetween, currentMonday, shiftWeek, mondayOf, prepDateFor, dayNameShort } from './dates'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/meals/dates.test.ts`
Expected: FAIL — `dayNameShort` is not exported.

- [ ] **Step 3: Add the export**

In `lib/meals/dates.ts`, add after `prepDateFor`:
```ts
// Fixed locale (not `undefined`) so this is deterministic across dev,
// CI, and production regardless of the runtime's default locale.
export function dayNameShort(dateStr: string): string {
  return parseLocal(dateStr).toLocaleDateString('en-US', { weekday: 'short' })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/meals/dates.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/meals/dates.ts lib/meals/dates.test.ts
git commit -m "feat(meals): add a shared, deterministic dayNameShort helper

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Types — `prep_type`, `shop_ingredients`, `PrepTask`

**Files:**
- Modify: `lib/meals/types.ts`

**Interfaces:**
- Produces: `Dish.prep_type: string | null`; `Dish.shop_ingredients: DishIngredient[] | null`; `MealPlan['dishes'].prep_type?`/`.shop_ingredients?`; new `PrepTask` type.

- [ ] **Step 1: Extend `Dish`**

Change:
```ts
  veg_portions: number
  fruit_portions: number
  fruit_context: string | null
}
```
to:
```ts
  veg_portions: number
  fruit_portions: number
  fruit_context: string | null
  prep_type: string | null
  shop_ingredients: DishIngredient[] | null
}
```

- [ ] **Step 2: Extend `MealPlan['dishes']`**

Change:
```ts
    needs_thaw?: boolean; needs_marinate?: boolean; prep_lead_days?: number | null; prep_note?: string | null
    bumbu_packet?: string | null; fruit_context?: string | null
  } | null
}
```
to:
```ts
    needs_thaw?: boolean; needs_marinate?: boolean; prep_lead_days?: number | null; prep_note?: string | null
    bumbu_packet?: string | null; fruit_context?: string | null
    prep_type?: string | null; shop_ingredients?: DishIngredient[] | null
  } | null
}
```

- [ ] **Step 3: Add `PrepTask`**

Append after `DessertWeekItem`:
```ts
export type PrepTask = {
  id: string
  cook_date: string
  prep_date: string
  dish_id: string | null
  dish_name: string | null
  prep_type: string | null
  instruction: string | null
  assigned_to: string | null
  done: boolean
  done_at: string | null
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/meals/types.ts
git commit -m "feat(meals): add prep_type, shop_ingredients, and PrepTask types

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `lib/meals/prepTasks.ts` — pure derivation logic

**Files:**
- Create: `lib/meals/prepTasks.ts`
- Test: `lib/meals/prepTasks.test.ts`

**Interfaces:**
- Consumes: `dayNameShort`, `prepDateFor`, `mondayOf`, `shiftWeek` from `./dates`.
- Produces: `PlannedDish` type, `PrepTaskDraft` type, `deriveDishTasks(planned: PlannedDish[]): PrepTaskDraft[]`, `deriveWeekendBatch(weekStart: string, planned: PlannedDish[]): PrepTaskDraft | null`, `deriveWeekPrepTasks(weekStart: string, planned: PlannedDish[]): PrepTaskDraft[]`. Consumed by Task 5 (generate route) and Task 7 (day page backfill).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { deriveDishTasks, deriveWeekendBatch, deriveWeekPrepTasks, type PlannedDish } from './prepTasks'

function dish(over: Partial<PlannedDish> & Pick<PlannedDish, 'cook_date' | 'dish_id' | 'dish_name'>): PlannedDish {
  return { prep_type: null, prep_lead_days: null, prep_note: null, protein: 'chicken', ...over }
}

describe('deriveDishTasks', () => {
  it('templates a marinate task', () => {
    const tasks = deriveDishTasks([dish({ dish_id: '1', dish_name: 'Ayam bumbu bakar', cook_date: '2026-08-25', prep_type: 'marinate', prep_lead_days: 1 })])
    expect(tasks).toEqual([{
      cook_date: '2026-08-25', prep_date: '2026-08-24', dish_id: '1', dish_name: 'Ayam bumbu bakar',
      prep_type: 'marinate', instruction: 'Marinate Ayam bumbu bakar', assigned_to: 'Wife',
    }])
  })
  it('templates a cook_overnight task', () => {
    const tasks = deriveDishTasks([dish({ dish_id: '2', dish_name: 'Rendang ayam', cook_date: '2026-08-25', prep_type: 'cook_overnight', prep_lead_days: 1 })])
    expect(tasks[0].instruction).toBe('Masak Rendang ayam malam ini (untuk besok)')
  })
  it('templates cut and portion tasks', () => {
    const cut = deriveDishTasks([dish({ dish_id: '3', dish_name: 'Sayur asem', cook_date: '2026-08-25', prep_type: 'cut', prep_lead_days: 1 })])
    expect(cut[0].instruction).toBe('Potong Sayur asem')
    const portion = deriveDishTasks([dish({ dish_id: '4', dish_name: 'Kacang ijo', cook_date: '2026-08-25', prep_type: 'portion', prep_lead_days: 1 })])
    expect(portion[0].instruction).toBe('Porsi Kacang ijo')
  })
  it('prep_note overrides the template', () => {
    const tasks = deriveDishTasks([dish({ dish_id: '5', dish_name: 'Iga bumbu bakar', cook_date: '2026-08-25', prep_type: 'marinate', prep_lead_days: 1, prep_note: 'rendam bumbu semalaman' })])
    expect(tasks[0].instruction).toBe('rendam bumbu semalaman')
  })
  it('emits only the marinate half of thaw_marinate — no separate thaw entry', () => {
    const tasks = deriveDishTasks([dish({ dish_id: '6', dish_name: 'Udang kecap', cook_date: '2026-08-25', prep_type: 'thaw_marinate', prep_lead_days: 1 })])
    expect(tasks).toHaveLength(1)
    expect(tasks[0].prep_type).toBe('marinate')
    expect(tasks[0].instruction).toBe('Marinate Udang kecap')
  })
  it('emits nothing for a plain thaw dish (handled by the weekend batch instead)', () => {
    const tasks = deriveDishTasks([dish({ dish_id: '7', dish_name: 'Ayam frozen', cook_date: '2026-08-25', prep_type: 'thaw', prep_lead_days: 1 })])
    expect(tasks).toEqual([])
  })
  it('skips dishes with no prep_type', () => {
    const tasks = deriveDishTasks([dish({ dish_id: '8', dish_name: 'Nasi', cook_date: '2026-08-25' })])
    expect(tasks).toEqual([])
  })
})

describe('deriveWeekendBatch', () => {
  it('returns null when no dish needs thawing', () => {
    const planned = [dish({ dish_id: '1', dish_name: 'Nasi', cook_date: '2026-08-25' })]
    expect(deriveWeekendBatch('2026-08-24', planned)).toBeNull()
  })
  it('consolidates thaw and thaw_marinate dishes into one Sunday-dated task', () => {
    const planned = [
      dish({ dish_id: '1', dish_name: 'Ayam frozen', cook_date: '2026-08-25', prep_type: 'thaw', protein: 'ayam' }),
      dish({ dish_id: '2', dish_name: 'Udang kecap', cook_date: '2026-08-27', prep_type: 'thaw_marinate', protein: 'udang' }),
      dish({ dish_id: '3', dish_name: 'Nasi', cook_date: '2026-08-25' }), // not thaw-related, excluded
    ]
    const batch = deriveWeekendBatch('2026-08-24', planned)
    expect(batch).not.toBeNull()
    expect(batch!.prep_date).toBe('2026-08-23') // Sunday before Monday 2026-08-24
    expect(batch!.dish_id).toBeNull()
    expect(batch!.prep_type).toBe('thaw_batch')
    expect(batch!.instruction).toBe('Pindah ke chiller: ayam (Tue), udang (Thu)')
  })
})

describe('deriveWeekPrepTasks', () => {
  it('combines per-dish tasks and the weekend batch', () => {
    const planned = [
      dish({ dish_id: '1', dish_name: 'Ayam frozen', cook_date: '2026-08-25', prep_type: 'thaw', protein: 'ayam' }),
      dish({ dish_id: '2', dish_name: 'Ayam bumbu bakar', cook_date: '2026-08-26', prep_type: 'marinate', prep_lead_days: 1 }),
    ]
    const all = deriveWeekPrepTasks('2026-08-24', planned)
    expect(all).toHaveLength(2)
    expect(all.some(t => t.prep_type === 'thaw_batch')).toBe(true)
    expect(all.some(t => t.prep_type === 'marinate')).toBe(true)
  })
  it('omits the batch entirely when nothing needs thawing', () => {
    const planned = [dish({ dish_id: '1', dish_name: 'Ayam bumbu bakar', cook_date: '2026-08-26', prep_type: 'marinate', prep_lead_days: 1 })]
    expect(deriveWeekPrepTasks('2026-08-24', planned)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/meals/prepTasks.test.ts`
Expected: FAIL — `Cannot find module './prepTasks'`.

- [ ] **Step 3: Write the implementation**

```ts
import { prepDateFor, mondayOf, shiftWeek, dayNameShort } from './dates'

export type PlannedDish = {
  cook_date: string
  dish_id: string
  dish_name: string
  prep_type: string | null
  prep_lead_days: number | null
  prep_note: string | null
  protein: string
}

export type PrepTaskDraft = {
  cook_date: string
  prep_date: string
  dish_id: string | null
  dish_name: string | null
  prep_type: string
  instruction: string
  assigned_to: string
}

function templateFor(prepType: string, dishName: string): string {
  switch (prepType) {
    case 'marinate': return `Marinate ${dishName}`
    case 'cook_overnight': return `Masak ${dishName} malam ini (untuk besok)`
    case 'cut': return `Potong ${dishName}`
    case 'portion': return `Porsi ${dishName}`
    default: return `Siapkan ${dishName}`
  }
}

// Per-dish tasks: marinate, cook_overnight, cut, portion, and the
// marinate half of thaw_marinate. A plain 'thaw' emits nothing here — see
// deriveWeekendBatch, which consolidates all thawing into one weekend task.
export function deriveDishTasks(planned: PlannedDish[]): PrepTaskDraft[] {
  const drafts: PrepTaskDraft[] = []
  for (const d of planned) {
    if (!d.prep_type) continue
    const effectiveType = d.prep_type === 'thaw_marinate' ? 'marinate' : d.prep_type
    if (effectiveType === 'thaw') continue
    const prep_date = prepDateFor(d.cook_date, d.prep_lead_days)
    const instruction = d.prep_note?.trim() || templateFor(effectiveType, d.dish_name)
    drafts.push({
      cook_date: d.cook_date, prep_date, dish_id: d.dish_id, dish_name: d.dish_name,
      prep_type: effectiveType, instruction, assigned_to: 'Wife',
    })
  }
  return drafts
}

// One task covering every 'thaw'/'thaw_marinate' dish planned for the
// week, dated the Sunday immediately before the week starts (weekStart is
// always a Monday, per mondayOf/weekDates convention).
export function deriveWeekendBatch(weekStart: string, planned: PlannedDish[]): PrepTaskDraft | null {
  const thawDishes = planned.filter(d => d.prep_type === 'thaw' || d.prep_type === 'thaw_marinate')
  if (thawDishes.length === 0) return null
  const prep_date = shiftWeek(mondayOf(weekStart), -1)
  const parts = thawDishes.map(d => `${d.protein || d.dish_name} (${dayNameShort(d.cook_date)})`)
  return {
    cook_date: weekStart, prep_date, dish_id: null, dish_name: null,
    prep_type: 'thaw_batch', instruction: `Pindah ke chiller: ${parts.join(', ')}`, assigned_to: 'Wife',
  }
}

export function deriveWeekPrepTasks(weekStart: string, planned: PlannedDish[]): PrepTaskDraft[] {
  const batch = deriveWeekendBatch(weekStart, planned)
  return [...deriveDishTasks(planned), ...(batch ? [batch] : [])]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/meals/prepTasks.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add lib/meals/prepTasks.ts lib/meals/prepTasks.test.ts
git commit -m "feat(meals): add pure prep-task derivation (per-dish + weekend batch)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `POST /api/meals/generate` persists prep tasks

**Files:**
- Modify: `app/api/meals/generate/route.ts`

**Interfaces:**
- Consumes: `deriveWeekPrepTasks`, `PlannedDish`, `PrepTaskDraft` from `@/lib/meals/prepTasks`.
- Produces: after a successful generate, `prep_tasks` has any newly-needed rows for the week (inserted, never updated) so the day page can read them back immediately without a lazy backfill.

- [ ] **Step 1: Add the import and the sync helper**

At the top of `app/api/meals/generate/route.ts`, add:
```ts
import { deriveWeekPrepTasks, type PlannedDish, type PrepTaskDraft } from '@/lib/meals/prepTasks'
```

Add this function above `POST`:
```ts
// Insert-only: never updates or deletes an existing row, so a checked
// `done` is never reset when the same week is generated again.
async function syncPrepTasks(drafts: PrepTaskDraft[]) {
  if (drafts.length === 0) return
  const prepDates = [...new Set(drafts.map(d => d.prep_date))]
  const { data: existingRaw } = await supabase.from('prep_tasks')
    .select('cook_date, dish_id, prep_type, prep_date').in('prep_date', prepDates)
  const existing = (existingRaw ?? []) as { cook_date: string; dish_id: string | null; prep_type: string | null; prep_date: string }[]
  const existsAlready = (d: PrepTaskDraft) => existing.some(e =>
    d.prep_type === 'thaw_batch'
      ? e.prep_type === 'thaw_batch' && e.prep_date === d.prep_date
      : e.cook_date === d.cook_date && e.dish_id === d.dish_id && e.prep_type === d.prep_type)
  const toInsert = drafts.filter(d => !existsAlready(d))
  if (toInsert.length) {
    await supabase.from('prep_tasks').insert(toInsert.map(d => ({
      cook_date: d.cook_date, prep_date: d.prep_date, dish_id: d.dish_id, dish_name: d.dish_name,
      prep_type: d.prep_type, instruction: d.instruction, assigned_to: d.assigned_to,
    })))
  }
}
```

- [ ] **Step 2: Build `PlannedDish[]` from the generated picks and call it**

After the existing dessert-batch persistence block (the code that inserts
into `dessert_week_items`) and before the `const rows = picks.filter(...)`
line, add:
```ts
  // Persist any newly-needed prep tasks (marinate/cook-overnight/cut/portion
  // per dish, plus one consolidated weekend thaw task) for this week.
  const plannedForPrep: PlannedDish[] = picks
    .filter(p => p.dish_id && !p.skipped && dishById.get(p.dish_id)?.prep_type)
    .map(p => {
      const d = dishById.get(p.dish_id as string)!
      return {
        cook_date: p.plan_date, dish_id: p.dish_id as string, dish_name: p.dish_name ?? d.name,
        prep_type: d.prep_type, prep_lead_days: d.prep_lead_days, prep_note: d.prep_note, protein: d.protein,
      }
    })
  await syncPrepTasks(deriveWeekPrepTasks(weekStart, plannedForPrep))
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Verify against the live database**

With the dev server running, generate a week that includes at least one
`prep_type`-tagged dish (e.g. one with `'marinate'` — 9 exist today), then:
```sql
select cook_date, prep_date, dish_name, prep_type, instruction, assigned_to, done
from prep_tasks where prep_date between '<a few days before the week>' and '<week end>' order by prep_date;
```
Expected: one row per marinate/cook_overnight dish at the right
`prep_date`, `assigned_to = 'Wife'`, `done = false`. Generate the **same**
week again — confirm no duplicate rows appear (row count unchanged).

- [ ] **Step 5: Commit**

```bash
git add app/api/meals/generate/route.ts
git commit -m "feat(meals): persist derived prep tasks when a week is generated

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: `PATCH /api/meals/prep-tasks/[id]` — toggle done

**Files:**
- Create: `app/api/meals/prep-tasks/[id]/route.ts`

**Interfaces:**
- Produces: `PATCH { done: boolean }` → updates `done` and `done_at` (now() when `true`, `null` when `false`), returns the updated row. Consumed by Task 8 (`DayView.tsx`'s checklist).

- [ ] **Step 1: Write the route**

```ts
import { supabase } from '@/lib/supabase'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json()
  if (typeof body.done !== 'boolean') {
    return Response.json({ error: 'done (boolean) required' }, { status: 400 })
  }
  const { data, error } = await supabase.from('prep_tasks')
    .update({ done: body.done, done_at: body.done ? new Date().toISOString() : null })
    .eq('id', id).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Verify against the live database**

With the dev server running and at least one `prep_tasks` row present
(from Task 4's verification):
```bash
curl -s -X PATCH "http://localhost:3001/api/meals/prep-tasks/<a real id>" \
  -H 'Content-Type: application/json' -d '{"done":true}' | python3 -m json.tool
```
Expected: `done: true` and a non-null `done_at` in the response. Repeat
with `{"done":false}` — expect `done_at: null`.

- [ ] **Step 4: Commit**

```bash
git add app/api/meals/prep-tasks/[id]/route.ts
git commit -m "feat(meals): add PATCH endpoint to toggle a prep task's done state

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: `components/meals/DishesClient.tsx` + PATCH whitelist — `prep_type` editor

**Files:**
- Modify: `components/meals/DishesClient.tsx`
- Modify: `app/api/meals/dishes/[id]/route.ts`

**Interfaces:**
- Produces: a `prep_type` dropdown in the dishes table, shown for every slot (unlike `fruit_context`, prep applies to any dish). `PATCH` FIELDS whitelist gains `prep_type`.

- [ ] **Step 1: Whitelist the field server-side**

In `app/api/meals/dishes/[id]/route.ts`, change:
```ts
const FIELDS = ['name', 'slot', 'protein', 'tier', 'method', 'spicy', 'rating', 'active', 'no_repeat_days', 'ingredients', 'recipe_steps', 'recipe_image_url', 'saltiness', 'difficulty', 'is_garnish', 'provides_soup', 'recipe_links', 'qty_amount', 'qty_unit', 'qty_note', 'fruit_context']
```
to:
```ts
const FIELDS = ['name', 'slot', 'protein', 'tier', 'method', 'spicy', 'rating', 'active', 'no_repeat_days', 'ingredients', 'recipe_steps', 'recipe_image_url', 'saltiness', 'difficulty', 'is_garnish', 'provides_soup', 'recipe_links', 'qty_amount', 'qty_unit', 'qty_note', 'fruit_context', 'prep_type']
```

- [ ] **Step 2: Add the selector in `DishesClient.tsx`**

Add a constant near `FRUIT_CONTEXTS`:
```ts
const PREP_TYPES = ['', 'thaw', 'marinate', 'cook_overnight', 'cut', 'portion', 'thaw_marinate']
```

Add a new `<th>` right after "Fruit context":
```tsx
                    <th className="px-3 py-2 font-medium">Prep type</th>
```

Add the corresponding `<td>` in `DishRow`, right after the `fruit_context` cell (this one has no slot restriction, unlike fruit context):
```tsx
      <td className="px-3 py-1.5">
        <select value={dish.prep_type ?? ''} onChange={e => onPatch(dish.id, { prep_type: e.target.value || null })}
          className="bg-transparent text-stone-600 focus:outline-none">
          {PREP_TYPES.map(p => <option key={p} value={p}>{p || '—'}</option>)}
        </select>
      </td>
```

Update the "No dishes" empty-state row's `colSpan` from `15` to `16`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Verify in the browser**

Visit `/meals/dishes`, confirm the new "Prep type" column shows `marinate`
for the 9 already-tagged dishes and `cook_overnight` for the 2 others,
`—` for the rest, and is editable for any slot.

- [ ] **Step 5: Commit**

```bash
git add components/meals/DishesClient.tsx app/api/meals/dishes/[id]/route.ts
git commit -m "feat(meals): make prep_type editable in the dishes editor

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: `app/meals/day/[date]/page.tsx` — fetch prep tasks + lazy backfill

**Files:**
- Modify: `app/meals/day/[date]/page.tsx`

**Interfaces:**
- Consumes: `deriveWeekPrepTasks`, `PlannedDish` from `@/lib/meals/prepTasks`; `dayNameShort` from `@/lib/meals/dates` (replacing the file's local `shortDayName`).
- Produces: passes a new `prepTasks: PrepTask[]` prop to `DayView` (replacing `todayPrep`/`upcomingPrep`), plus `rawIngredients` data for the optional glance section (Task 8).

- [ ] **Step 1: Replace the old prep computation with a prep_tasks fetch + backfill**

Replace the whole file's body (keeping the invalid-date guard and imports
that are still needed) with:
```ts
export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { shiftWeek, mondayOf, dayNameShort } from '@/lib/meals/dates'
import { deriveWeekPrepTasks, type PlannedDish } from '@/lib/meals/prepTasks'
import { reconcileSoup } from '@/lib/meals/reconcile'
import type { MealPlan, PrepTask } from '@/lib/meals/types'
import DayView from '@/components/meals/DayView'

const DISHES_SELECT = 'tier, spicy, richness, provides_soup, recipe_image_url, protein, saltiness, difficulty, method, ' +
  'slot, recipe_links, qty_amount, qty_unit, qty_note, veg_portions, fruit_portions, ' +
  'needs_thaw, needs_marinate, prep_lead_days, prep_note, bumbu_packet, prep_type, shop_ingredients'

function longDayName(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

// Ensures this week's prep_tasks exist (backfills weeks generated before
// this feature shipped). A no-op once the week has any prep_tasks rows —
// never re-derives or overwrites an already-generated week.
async function ensurePrepTasksExist(weekStart: string) {
  const weekEnd = shiftWeek(weekStart, 6)
  const weekendBefore = shiftWeek(weekStart, -1)
  const { data: existing } = await supabase.from('prep_tasks').select('id')
    .gte('prep_date', weekendBefore).lte('prep_date', weekEnd).limit(1)
  if (existing && existing.length > 0) return

  const { data: weekPlans } = await supabase.from('meal_plans')
    .select(`plan_date, dish_id, dish_name, skipped, dishes(prep_type, prep_lead_days, prep_note, protein, name)`)
    .gte('plan_date', weekStart).lte('plan_date', weekEnd).eq('skipped', false).not('dish_id', 'is', null)
  type Row = { plan_date: string; dish_id: string; dish_name: string | null
    dishes: { prep_type: string | null; prep_lead_days: number | null; prep_note: string | null; protein: string; name: string } | null }
  const planned: PlannedDish[] = ((weekPlans ?? []) as unknown as Row[])
    .filter(r => r.dishes?.prep_type)
    .map(r => ({
      cook_date: r.plan_date, dish_id: r.dish_id, dish_name: r.dish_name ?? r.dishes!.name,
      prep_type: r.dishes!.prep_type, prep_lead_days: r.dishes!.prep_lead_days,
      prep_note: r.dishes!.prep_note, protein: r.dishes!.protein,
    }))
  const drafts = deriveWeekPrepTasks(weekStart, planned)
  if (drafts.length) {
    await supabase.from('prep_tasks').insert(drafts.map(d => ({
      cook_date: d.cook_date, prep_date: d.prep_date, dish_id: d.dish_id, dish_name: d.dish_name,
      prep_type: d.prep_type, instruction: d.instruction, assigned_to: d.assigned_to,
    })))
  }
}

export default async function DayPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return (
      <div className="text-center py-16">
        <p className="text-stone-500">Invalid date.</p>
        <Link href="/meals" className="text-orange-600 hover:text-orange-700 text-sm mt-2 inline-block">← Back to plan</Link>
      </div>
    )
  }

  await ensurePrepTasksExist(mondayOf(date))

  const [{ data: dayRows }, { data: prepRows }] = await Promise.all([
    supabase.from('meal_plans').select(`*, dishes(${DISHES_SELECT})`).eq('plan_date', date),
    supabase.from('prep_tasks').select('*').eq('prep_date', date).order('created_at'),
  ])

  const rows = await reconcileSoup((dayRows ?? []) as MealPlan[])
  const prepTasks = (prepRows ?? []) as PrepTask[]

  return (
    <DayView
      date={date} dayName={longDayName(date)} rows={rows} prepTasks={prepTasks}
      prevDate={shiftWeek(date, -1)} nextDate={shiftWeek(date, 1)}
      backToWeekHref={`/meals?week=${mondayOf(date)}`}
    />
  )
}
```

Note: `PREP_LOOKAHEAD_DAYS`, `groupPrepByDate`, `prepPhrase`, `PrepCandidate`,
`shortDayName`, `todayPrep`/`upcomingPrep` are all removed from this file —
the new checklist reads directly from `prep_tasks` instead of computing a
recap on the fly. `lib/meals/prep.ts` itself is untouched (still used by
the WA cron route).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors in `components/meals/DayView.tsx` (still expects the old
`todayPrep`/`upcomingPrep` props) — expected; fixed in Task 8.

- [ ] **Step 3: Commit**

Hold this commit — Task 8 fixes `DayView.tsx`'s now-mismatched props in
the same logical change, so commit both together at the end of Task 8 to
keep the tree buildable at every commit. Skip committing here.

---

### Task 8: `components/meals/DayView.tsx` — prep-first redesign

**Files:**
- Modify: `components/meals/DayView.tsx`

**Interfaces:**
- Consumes: `PrepTask` from `@/lib/meals/types`.
- Produces: prep checklist (top, interactive, `PATCH`es `/api/meals/prep-tasks/[id]`), optional raw-ingredients glance, compacted meals section (bottom).

- [ ] **Step 1: Rewrite the file**

```tsx
'use client'
import { useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Check } from 'lucide-react'
import { SLOT_LABELS, type MealPlan, type PrepTask } from '@/lib/meals/types'
import { dayNameShort } from '@/lib/meals/dates'
import { qtyDisplay } from '@/lib/meals/qty'
import DishImage from './DishImage'
import ViewToggle from './ViewToggle'

const PREP_ICON: Record<string, string> = {
  thaw_batch: '🧊', marinate: '🫙', cook_overnight: '🍲', cut: '🔪', portion: '📦',
}

function DishLinks({ dishes }: { dishes: MealPlan['dishes'] }) {
  const links = dishes?.recipe_links ?? []
  if (links.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5 mt-1">
      {links.map((l, i) => (
        <a key={i} href={l.url} target="_blank" rel="noopener noreferrer"
          className="text-[11px] text-orange-600 hover:text-orange-700 underline underline-offset-2">
          {l.title || l.url}
        </a>
      ))}
    </div>
  )
}

// Compact reference card — smaller than the old hero style, since meals
// are now secondary to the prep checklist above them.
function DishCard({ row }: { row: MealPlan }) {
  const qty = qtyDisplay(row.dishes)
  return (
    <Link href={row.dish_id ? `/meals/dish/${row.dish_id}` : '#'}
      className="flex items-center gap-2.5 bg-white border border-stone-200 rounded-xl overflow-hidden hover:border-stone-300 transition-colors p-1.5">
      <DishImage imageUrl={row.dishes?.recipe_image_url ?? null} protein={row.dishes?.protein ?? 'none'} name={row.dish_name ?? undefined}
        className="w-12 h-12 shrink-0" rounded="rounded-lg" iconSize={20} />
      <div className="min-w-0 flex-1 py-0.5">
        <div className="text-[10px] uppercase tracking-wide text-stone-400">
          {row.dishes?.slot ? SLOT_LABELS[row.dishes.slot] : ''}
        </div>
        <div className="text-sm text-stone-800 truncate">{row.dish_name ?? '—'}</div>
        {qty && <div className="text-xs text-stone-500 mt-0.5">{qty}</div>}
        {row.dishes?.bumbu_packet && (
          <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700">
            {row.dishes.bumbu_packet}
          </span>
        )}
        <DishLinks dishes={row.dishes} />
      </div>
    </Link>
  )
}

function PrepChecklist({ date, tasks }: { date: string; tasks: PrepTask[] }) {
  const [items, setItems] = useState(tasks)
  async function toggle(id: string, done: boolean) {
    setItems(list => list.map(t => t.id === id ? { ...t, done } : t)) // optimistic
    const res = await fetch(`/api/meals/prep-tasks/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ done }),
    })
    if (!res.ok) setItems(list => list.map(t => t.id === id ? { ...t, done: !done } : t)) // revert
  }
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-4">
      <h2 className="text-base text-stone-800 mb-3 flex items-center gap-1.5" style={{ fontFamily: 'DM Serif Display, serif' }}>
        🔪 Persiapan hari ini
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-stone-500">Tidak ada persiapan khusus hari ini 👍</p>
      ) : (
        <ul className="space-y-2">
          {items.map(t => (
            <li key={t.id} className={`flex items-start gap-3 bg-white border border-amber-100 rounded-xl p-3 ${t.done ? 'opacity-60' : ''}`}>
              <button onClick={() => toggle(t.id, !t.done)} aria-label={t.done ? 'Mark not done' : 'Mark done'}
                className={`shrink-0 w-7 h-7 rounded-lg border-2 flex items-center justify-center mt-0.5 ${t.done ? 'bg-orange-600 border-orange-600' : 'border-stone-300'}`}>
                {t.done && <Check size={16} className="text-white" />}
              </button>
              <div className="min-w-0">
                <div className={`text-sm text-stone-800 ${t.done ? 'line-through' : ''}`}>
                  <span className="mr-1.5">{PREP_ICON[t.prep_type ?? ''] ?? '📋'}</span>
                  {t.instruction}
                </div>
                {t.prep_type !== 'thaw_batch' && t.cook_date !== date && (
                  <div className="text-xs text-stone-400 mt-0.5">untuk {dayNameShort(t.cook_date)}</div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RawIngredientsGlance({ rows }: { rows: MealPlan[] }) {
  const withIngredients = rows.filter(r => r.dish_id && !r.skipped && (r.dishes?.shop_ingredients?.length ?? 0) > 0)
  if (withIngredients.length === 0) return null
  return (
    <div className="bg-white border border-stone-200 rounded-2xl p-4 mb-4">
      <h3 className="text-xs font-medium text-stone-500 mb-2">🧺 Bahan mentah hari ini</h3>
      <div className="space-y-2">
        {withIngredients.map(r => (
          <div key={r.id}>
            <div className="text-xs text-stone-600 mb-1">{r.dish_name}</div>
            <div className="flex flex-wrap gap-1.5">
              {(r.dishes?.shop_ingredients ?? []).map((ing, i) => (
                <span key={i} className="px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 text-[11px]">
                  {ing.name}{ing.quantity ? ` · ${ing.quantity}` : ''}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function DayView({
  date, dayName, rows, prepTasks, prevDate, nextDate, backToWeekHref,
}: {
  date: string
  dayName: string
  rows: MealPlan[]
  prepTasks: PrepTask[]
  prevDate: string
  nextDate: string
  backToWeekHref: string
}) {
  const breakfast = rows.find(r => r.slot === 'breakfast' && r.dish_id && !r.skipped)
  const breakfastFruit = rows.find(r => r.slot === 'fruit' && r.role === 'breakfast' && r.dish_id && !r.skipped)
  const main = rows.find(r => r.role === 'main' && r.dish_id && !r.skipped)
  const supports = rows.filter(r => r.role === 'support' && r.dish_id && !r.skipped)
  const dessertFruit = rows.find(r => r.slot === 'fruit' && r.role === 'optional' && r.dish_id && !r.skipped)
  const desert = rows.find(r => r.slot === 'desert' && r.dish_id && !r.skipped)
  const hasPlan = !!(breakfast || main || supports.length || dessertFruit || desert)

  return (
    <div className="max-w-md mx-auto">
      <div className="mb-4">
        <ViewToggle weekHref={backToWeekHref} dayHref={`/meals/day/${date}`} />
      </div>

      <div className="flex items-center justify-between mb-4">
        <Link href={`/meals/day/${prevDate}`} className="p-2 rounded-lg hover:bg-stone-100 text-stone-600" aria-label="Previous day">
          <ChevronLeft size={18} />
        </Link>
        <h1 className="text-xl text-stone-900" style={{ fontFamily: 'DM Serif Display, serif' }}>{dayName}</h1>
        <Link href={`/meals/day/${nextDate}`} className="p-2 rounded-lg hover:bg-stone-100 text-stone-600" aria-label="Next day">
          <ChevronRight size={18} />
        </Link>
      </div>

      <PrepChecklist date={date} tasks={prepTasks} />
      <RawIngredientsGlance rows={rows} />

      <div>
        <h3 className="text-xs font-medium text-stone-400 mb-2">🍽️ Makan hari ini</h3>
        {!hasPlan ? (
          <p className="text-sm text-stone-400 bg-white border border-stone-200 rounded-2xl p-5 text-center">
            Nothing planned for this day yet.
          </p>
        ) : (
          <div className="space-y-2">
            {breakfast && <DishCard row={breakfast} />}
            {breakfastFruit && <DishCard row={breakfastFruit} />}
            {main && <DishCard row={main} />}
            {supports.map(s => <DishCard key={s.id} row={s} />)}
            {dessertFruit && <DishCard row={dessertFruit} />}
            {desert && <DishCard row={desert} />}
          </div>
        )}
      </div>
    </div>
  )
}
```

Note: `TodayPrepItem`/`UpcomingPrepItem` types are removed (no longer
exported) — nothing else in the codebase imports them (only the day
page did, which Task 7 already updated).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: all passing (this task touches no `lib/meals/*` logic, only
components).

- [ ] **Step 4: Verify in the browser**

With the dev server running: generate a week that includes at least one
`marinate`-tagged dish, open that dish's cook date's `/meals/day/[date]`
page at a phone-width viewport (≈390px). Confirm:
- The amber prep checklist renders first, above the meals.
- Checking a task shows the checkmark immediately and persists across a
  page reload.
- The meals section below is visibly more compact than before (small
  image-left rows, not large hero cards).
- A day with no prep tasks shows "Tidak ada persiapan khusus hari ini 👍".

- [ ] **Step 5: Commit** (Task 7 + 8 together)

```bash
git add app/meals/day/\[date\]/page.tsx components/meals/DayView.tsx
git commit -m "feat(meals): redesign the day page to lead with a checkable prep list

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Final verification

- [ ] **Step 1: Full test suite + typecheck**

```bash
npx vitest run
npx tsc --noEmit
```
Expected: all `lib/meals/*.test.ts` pass (baseline + every new case from
Tasks 1 and 3), no type errors.

- [ ] **Step 2: End-to-end walkthrough**

With the dev server running:
1. Generate a week that includes at least one `marinate` dish, one
   `cook_overnight` dish, and (temporarily, via the Dishes editor) tag one
   dish `thaw` or `thaw_marinate` to exercise the weekend batch.
2. Confirm in the DB that `prep_tasks` has: the per-dish marinate/
   cook_overnight rows at the right `prep_date`, and exactly one
   `thaw_batch` row dated the Sunday before the week, listing every
   thaw-tagged dish.
3. Open the day page for a day with prep tasks — confirm the checklist
   renders first, checking a task persists after reload, and the meals
   below are compact/secondary.
4. Open a day with NO prep tasks — confirm the friendly empty state.
5. Pick an OLDER week (already generated before this batch, e.g. the
   real current week) and open its day page for the first time since this
   shipped — confirm the lazy backfill fires (check `prep_tasks` gains
   rows for that week) and the day renders its prep list correctly.
6. Regenerate the same week a second time — confirm no duplicate
   `prep_tasks` rows, and a previously-checked task stays checked.

- [ ] **Step 3: Report to Kevin**

Confirm: the day page leads with a checkable prep list, finished dishes
are secondary/smaller, checking a prep task persists (`done=true`), and
prep tasks are auto-derived from the plan (marinate/cook-overnight at the
right lead time, thaw consolidated into one weekend task) — matching the
user's "After building" ask verbatim.
