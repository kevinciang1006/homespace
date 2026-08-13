# Meal Shopping List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-week Shopping List tab under `/meals`, generated from that week's meal plan, that persists as an editable document per week.

**Architecture:** A pure, framework-free builder (`lib/meals/shopping.ts`) aggregates dish ingredients into a shopping list and is unit-tested with Vitest. Next.js route handlers own Supabase reads/writes and call the builder. A server page seeds a `'use client'` component that does optimistic mutations — the established Homespace pattern. Shared week-date helpers are extracted into `lib/meals/dates.ts` to DRY across the plan and shopping views.

**Tech Stack:** Next.js 16.2.4 (App Router), TypeScript (strict), Tailwind v4, Supabase JS (anon key, `lib/supabase.ts`), lucide-react, Vitest.

## Global Constraints

- **Read the bundled Next.js docs before writing route/page code** (`node_modules/next/dist/docs/`). Per `AGENTS.md`, this Next.js differs from training data.
- **Supabase:** use the shared `supabase` client from `@/lib/supabase` in route handlers only. Anon key, no RLS changes.
- **Route handler dynamic params are async:** `{ params }: { params: Promise<{ id: string }> }` then `const { id } = await params`.
- **Path alias:** `@/lib/...`, `@/components/...`.
- **User session:** `hs_session` cookie via `await cookies()` in server components; JSON `{ id, name }`, wrap `JSON.parse` in try/catch.
- **Dates:** `YYYY-MM-DD` strings, parsed as **local** (`new Date(y, m-1, d)`), never `new Date(str)`.
- **Design system:** stone palette, orange accent (`orange-500`/`orange-600`), DM Serif Display headings (`style={{ fontFamily: 'DM Serif Display, serif' }}`), white cards `border border-stone-200 rounded-2xl`, lucide icons. Match `components/shopping/ShoppingClient.tsx` and `components/meals/PlanClient.tsx`.
- **Mobile-first:** single-column stacked cards; controls always visible (no hover-only).
- **This feature is independent** of the existing `shopping_groups`/`shopping_items` (WhatsApp) list.
- **`category='dish'`** is a marker value for dish-placeholder rows, deliberately outside the 4 display buckets; excluded from progress counts.

---

## File Structure

**Create:**
- `lib/meals/shopping.ts` — pure builder + types.
- `lib/meals/shopping.test.ts` — Vitest tests.
- `app/meals/shopping/page.tsx` — server page.
- `app/api/meals/shopping/generate/route.ts` — POST full-replace generate.
- `app/api/meals/shopping/route.ts` — GET week list+items.
- `app/api/meals/shopping/items/route.ts` — POST manual item.
- `app/api/meals/shopping/items/[id]/route.ts` — PATCH + DELETE.
- `components/meals/ShoppingListClient.tsx` — list UI.

**Modify:**
- `lib/meals/dates.ts` — add `currentMonday`, `shiftWeek`, `mondayOf`.
- `lib/meals/dates.test.ts` — add tests for the new helpers.
- `lib/meals/types.ts` — add shopping row types (`MealShoppingList`, `MealShoppingItem`).
- `components/meals/MealsTabs.tsx` — add third tab.
- `components/meals/PlanClient.tsx` — use extracted date helpers (remove inlined copies).
- `app/api/meals/reroll/route.ts` — use extracted `mondayOf` (remove inlined copy).

---

## Task 1: Extract shared week-date helpers into dates.ts

**Files:**
- Modify: `lib/meals/dates.ts`, `lib/meals/dates.test.ts`
- Refactor consumers: `components/meals/PlanClient.tsx`, `app/api/meals/reroll/route.ts`

**Interfaces:**
- Produces: `currentMonday(): string`, `shiftWeek(weekStart: string, deltaDays: number): string`, `mondayOf(dateStr: string): string`.

- [ ] **Step 1: Write failing tests for the new helpers**

Append to `lib/meals/dates.test.ts`:
```ts
import { currentMonday, shiftWeek, mondayOf } from './dates'

describe('week helpers', () => {
  it('shiftWeek adds days across a month boundary', () => {
    expect(shiftWeek('2026-08-31', 7)).toBe('2026-09-07')
    expect(shiftWeek('2026-09-07', -7)).toBe('2026-08-31')
  })
  it('mondayOf maps any weekday to that week Monday', () => {
    expect(mondayOf('2026-08-13')).toBe('2026-08-10') // Thu -> Mon
    expect(mondayOf('2026-08-10')).toBe('2026-08-10') // Mon -> Mon
    expect(mondayOf('2026-08-16')).toBe('2026-08-10') // Sun -> Mon
  })
  it('currentMonday returns a Monday (getDay === 1)', () => {
    const [y, m, d] = currentMonday().split('-').map(Number)
    expect(new Date(y, m - 1, d).getDay()).toBe(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- dates`
Expected: FAIL — `currentMonday`/`shiftWeek`/`mondayOf` not exported.

- [ ] **Step 3: Add the helpers to dates.ts**

Append to `lib/meals/dates.ts`:
```ts
export function currentMonday(): string {
  const now = new Date()
  const dow = (now.getDay() + 6) % 7
  now.setDate(now.getDate() - dow)
  return isoDate(now)
}

export function shiftWeek(weekStart: string, deltaDays: number): string {
  const [y, m, d] = weekStart.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + deltaDays)
  return isoDate(dt)
}

export function mondayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const dow = (dt.getDay() + 6) % 7 // Mon=0
  dt.setDate(dt.getDate() - dow)
  return isoDate(dt)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- dates`
Expected: PASS.

- [ ] **Step 5: Refactor PlanClient to use the shared helpers**

In `components/meals/PlanClient.tsx`: delete the local `shiftWeek` and `currentMonday` function definitions. Update the import from `@/lib/meals/dates` to include them:
```ts
import { weekDates, currentMonday, shiftWeek } from '@/lib/meals/dates'
```
(Leave the local `label(dateStr)` helper as-is — it is display-only and not being extracted.)

- [ ] **Step 6: Refactor the reroll route to use shared mondayOf**

In `app/api/meals/reroll/route.ts`: delete the local `mondayOf` function and import it:
```ts
import { weekDates, mondayOf } from '@/lib/meals/dates'
```

- [ ] **Step 7: Verify tests + typecheck-lite**

Run: `npm test`
Expected: all prior tests still PASS (26 + 3 new = 29).

- [ ] **Step 8: Commit**

```bash
git add lib/meals/dates.ts lib/meals/dates.test.ts components/meals/PlanClient.tsx app/api/meals/reroll/route.ts
git commit -m "refactor(meals): extract shared week-date helpers into dates.ts"
```

---

## Task 2: Shopping types + pure builder

**Files:**
- Create: `lib/meals/shopping.ts`, `lib/meals/shopping.test.ts`
- Modify: `lib/meals/types.ts`

**Interfaces:**
- Produces (in `shopping.ts`): `DishIngredient`, `SHOP_CATEGORIES`, `ShopCategory`, `BuiltIngredient`, `BuiltList`, `normalizeCategory(c)`, `buildShoppingList(plans, dishById)`.
- Produces (in `types.ts`): `MealShoppingList`, `MealShoppingItem`.

- [ ] **Step 1: Add row types to types.ts**

Append to `lib/meals/types.ts`:
```ts
export type MealShoppingList = {
  id: string
  week_start: string
  generated_at: string | null
  archived: boolean
}

export type MealShoppingItem = {
  id: string
  list_id: string
  ingredient: string
  quantity: string | null
  category: string // 'protein' | 'vegetable' | 'pantry' | 'other' | 'dish'
  already_have: boolean
  checked: boolean
  from_dishes: { dish: string; quantity?: string | null }[] | null
  created_at: string
}
```

- [ ] **Step 2: Write failing builder tests**

```ts
// lib/meals/shopping.test.ts
import { describe, it, expect } from 'vitest'
import { buildShoppingList, normalizeCategory, type DishIngredient } from './shopping'

type D = { name: string; ingredients: DishIngredient[] | null }
function map(dishes: (D & { id: string })[]): Map<string, D> {
  return new Map(dishes.map(d => [d.id, { name: d.name, ingredients: d.ingredients }]))
}

describe('normalizeCategory', () => {
  it('passes through known buckets, lowercased', () => {
    expect(normalizeCategory('Protein')).toBe('protein')
    expect(normalizeCategory('vegetable')).toBe('vegetable')
  })
  it('maps unknown/empty to other', () => {
    expect(normalizeCategory('spice')).toBe('other')
    expect(normalizeCategory(null)).toBe('other')
    expect(normalizeCategory(undefined)).toBe('other')
  })
})

describe('buildShoppingList', () => {
  it('collects dishes with no ingredients into dishesWithoutIngredients (deduped)', () => {
    const dishById = map([
      { id: 'a', name: 'Nasi Goreng', ingredients: null },
      { id: 'b', name: 'Sop Ayam', ingredients: [] },
    ])
    const plans = [
      { dish_id: 'a', dish_name: 'Nasi Goreng' },
      { dish_id: 'b', dish_name: 'Sop Ayam' },
      { dish_id: 'a', dish_name: 'Nasi Goreng' }, // repeat same dish
    ]
    const out = buildShoppingList(plans, dishById)
    expect(out.ingredients).toEqual([])
    expect(out.dishesWithoutIngredients).toEqual(['Nasi Goreng', 'Sop Ayam'])
  })

  it('aggregates same ingredient across dishes, joining distinct quantities and recording from_dishes', () => {
    const dishById = map([
      { id: 'a', name: 'Dish A', ingredients: [
        { name: 'Garlic', quantity: '3 cloves', category: 'vegetable' },
        { name: 'Chicken', quantity: '200g', category: 'protein' },
      ] },
      { id: 'b', name: 'Dish B', ingredients: [
        { name: 'garlic', quantity: '2 cloves', category: 'vegetable' }, // case-insensitive match
        { name: 'Chicken', quantity: '200g', category: 'protein' },       // duplicate quantity -> not repeated
      ] },
    ])
    const plans = [
      { dish_id: 'a', dish_name: 'Dish A' },
      { dish_id: 'b', dish_name: 'Dish B' },
    ]
    const out = buildShoppingList(plans, dishById)
    expect(out.dishesWithoutIngredients).toEqual([])

    const garlic = out.ingredients.find(i => i.ingredient.toLowerCase() === 'garlic')!
    expect(garlic.quantity).toBe('3 cloves + 2 cloves')
    expect(garlic.category).toBe('vegetable')
    expect(garlic.from_dishes).toEqual([
      { dish: 'Dish A', quantity: '3 cloves' },
      { dish: 'Dish B', quantity: '2 cloves' },
    ])

    const chicken = out.ingredients.find(i => i.ingredient === 'Chicken')!
    expect(chicken.quantity).toBe('200g') // duplicate quantity deduped
    expect(chicken.from_dishes.length).toBe(2)
  })

  it('sorts ingredients by category order then name; unknown category -> other', () => {
    const dishById = map([
      { id: 'a', name: 'D', ingredients: [
        { name: 'Sugar', quantity: null, category: 'pantry' },
        { name: 'Zucchini', quantity: null, category: 'vegetable' },
        { name: 'Beef', quantity: null, category: 'protein' },
        { name: 'Ginger', quantity: null, category: 'spice' }, // -> other
      ] },
    ])
    const out = buildShoppingList([{ dish_id: 'a', dish_name: 'D' }], dishById)
    expect(out.ingredients.map(i => [i.category, i.ingredient])).toEqual([
      ['protein', 'Beef'], ['vegetable', 'Zucchini'], ['pantry', 'Sugar'], ['other', 'Ginger'],
    ])
  })

  it('ignores cells with no dish_id', () => {
    const out = buildShoppingList([{ dish_id: null, dish_name: null }], map([]))
    expect(out.ingredients).toEqual([])
    expect(out.dishesWithoutIngredients).toEqual([])
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -- shopping`
Expected: FAIL — cannot find `./shopping`.

- [ ] **Step 4: Implement shopping.ts**

```ts
// lib/meals/shopping.ts
export type DishIngredient = { name: string; quantity?: string | null; category?: string | null }

export const SHOP_CATEGORIES = ['protein', 'vegetable', 'pantry', 'other'] as const
export type ShopCategory = (typeof SHOP_CATEGORIES)[number]

export type BuiltIngredient = {
  ingredient: string
  quantity: string | null
  category: ShopCategory
  from_dishes: { dish: string; quantity?: string | null }[]
}
export type BuiltList = {
  ingredients: BuiltIngredient[]
  dishesWithoutIngredients: string[]
}

export function normalizeCategory(c: string | null | undefined): ShopCategory {
  const lower = (c ?? '').trim().toLowerCase()
  return (SHOP_CATEGORIES as readonly string[]).includes(lower) ? (lower as ShopCategory) : 'other'
}

export function buildShoppingList(
  plans: { dish_id: string | null; dish_name: string | null }[],
  dishById: Map<string, { name: string; ingredients: DishIngredient[] | null }>,
): BuiltList {
  const agg = new Map<string, BuiltIngredient & { _quantities: string[] }>()
  const noIng: string[] = []
  const noIngSeen = new Set<string>()

  for (const p of plans) {
    if (!p.dish_id) continue
    const dish = dishById.get(p.dish_id)
    if (!dish) continue
    const name = dish.name
    const ingredients = dish.ingredients ?? []

    if (ingredients.length === 0) {
      if (!noIngSeen.has(name)) { noIngSeen.add(name); noIng.push(name) }
      continue
    }

    for (const ing of ingredients) {
      const key = ing.name.trim().toLowerCase()
      if (!key) continue
      let row = agg.get(key)
      if (!row) {
        row = {
          ingredient: ing.name.trim(),
          quantity: null,
          category: normalizeCategory(ing.category),
          from_dishes: [],
          _quantities: [],
        }
        agg.set(key, row)
      }
      row.from_dishes.push({ dish: name, quantity: ing.quantity ?? null })
      const q = (ing.quantity ?? '').trim()
      if (q && !row._quantities.includes(q)) row._quantities.push(q)
    }
  }

  const catOrder = (c: ShopCategory) => SHOP_CATEGORIES.indexOf(c)
  const ingredients: BuiltIngredient[] = [...agg.values()]
    .map(({ _quantities, ...r }) => ({ ...r, quantity: _quantities.length ? _quantities.join(' + ') : null }))
    .sort((a, b) => catOrder(a.category) - catOrder(b.category) || a.ingredient.localeCompare(b.ingredient))

  return { ingredients, dishesWithoutIngredients: noIng }
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npm test -- shopping`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/meals/shopping.ts lib/meals/shopping.test.ts lib/meals/types.ts
git commit -m "feat(meals): add shopping-list builder and row types with tests"
```

---

## Task 3: Generate + week-read API routes

**Files:**
- Create: `app/api/meals/shopping/generate/route.ts`, `app/api/meals/shopping/route.ts`

**Interfaces:**
- Consumes: `buildShoppingList` from `@/lib/meals/shopping`, `weekDates` from `@/lib/meals/dates`, `supabase`, `MealShoppingList`, `MealShoppingItem`.
- Produces:
  - `POST /api/meals/shopping/generate` `{ weekStart }` → `{ list: MealShoppingList, items: MealShoppingItem[] }`.
  - `GET /api/meals/shopping?weekStart=` → `{ list: MealShoppingList | null, items: MealShoppingItem[] }`.

- [ ] **Step 1: Read the route-handler doc**

Skim `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` (GET/POST signatures, `Response.json`, query params via `new URL(request.url).searchParams`).

- [ ] **Step 2: Implement the generate route**

```ts
// app/api/meals/shopping/generate/route.ts
import { supabase } from '@/lib/supabase'
import { weekDates } from '@/lib/meals/dates'
import { buildShoppingList, type DishIngredient } from '@/lib/meals/shopping'
import type { MealShoppingList, MealShoppingItem } from '@/lib/meals/types'

export async function POST(request: Request) {
  const { weekStart } = await request.json()
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return Response.json({ error: 'weekStart (YYYY-MM-DD) required' }, { status: 400 })
  }
  const days = weekDates(weekStart)

  const [{ data: plansRaw }, { data: dishesRaw }] = await Promise.all([
    supabase.from('meal_plans').select('dish_id, dish_name').gte('plan_date', days[0]).lte('plan_date', days[6]),
    supabase.from('dishes').select('id, name, ingredients'),
  ])

  const dishById = new Map<string, { name: string; ingredients: DishIngredient[] | null }>(
    (dishesRaw ?? []).map((d: { id: string; name: string; ingredients: DishIngredient[] | null }) =>
      [d.id, { name: d.name, ingredients: d.ingredients }]),
  )
  const built = buildShoppingList((plansRaw ?? []) as { dish_id: string | null; dish_name: string | null }[], dishById)

  // upsert the list row for the week
  const { data: list, error: listErr } = await supabase.from('meal_shopping_lists')
    .upsert({ week_start: weekStart, generated_at: new Date().toISOString(), archived: false }, { onConflict: 'week_start' })
    .select().single()
  if (listErr || !list) return Response.json({ error: listErr?.message ?? 'list upsert failed' }, { status: 500 })

  // full replace: delete all existing items, then insert fresh
  await supabase.from('meal_shopping_items').delete().eq('list_id', list.id)

  const rows = [
    ...built.ingredients.map(i => ({
      list_id: list.id, ingredient: i.ingredient, quantity: i.quantity, category: i.category,
      already_have: false, checked: false, from_dishes: i.from_dishes,
    })),
    ...built.dishesWithoutIngredients.map(name => ({
      list_id: list.id, ingredient: name, quantity: null, category: 'dish',
      already_have: false, checked: false, from_dishes: [{ dish: name }],
    })),
  ]
  let items: MealShoppingItem[] = []
  if (rows.length) {
    const { data, error } = await supabase.from('meal_shopping_items').insert(rows).select()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    items = (data ?? []) as MealShoppingItem[]
  }

  return Response.json({ list: list as MealShoppingList, items })
}
```

- [ ] **Step 3: Implement the week-read route**

```ts
// app/api/meals/shopping/route.ts
import { supabase } from '@/lib/supabase'
import type { MealShoppingList, MealShoppingItem } from '@/lib/meals/types'

export async function GET(request: Request) {
  const weekStart = new URL(request.url).searchParams.get('weekStart')
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return Response.json({ error: 'weekStart required' }, { status: 400 })
  }
  const { data: list } = await supabase.from('meal_shopping_lists')
    .select('*').eq('week_start', weekStart).maybeSingle()
  if (!list) return Response.json({ list: null, items: [] })

  const { data: items } = await supabase.from('meal_shopping_items')
    .select('*').eq('list_id', list.id).order('created_at', { ascending: true })
  return Response.json({ list: list as MealShoppingList, items: (items ?? []) as MealShoppingItem[] })
}
```

- [ ] **Step 4: Manual smoke test**

Start dev (`npm run dev`; if the sandbox blocks the port, run it with the sandbox disabled), then with a session cookie:
```bash
COOKIE='hs_session={"id":"00000000-0000-0000-0000-000000000000","name":"Test"}'
curl -s -X POST --cookie "$COOKIE" localhost:3000/api/meals/shopping/generate -H 'content-type: application/json' -d '{"weekStart":"2026-08-10"}' | head -c 400
echo
curl -s --cookie "$COOKIE" "localhost:3000/api/meals/shopping?weekStart=2026-08-10" | head -c 400
```
Expected: generate returns `{ list, items }`; since no dish has ingredients yet, `items` are all `category:"dish"` placeholders (one per distinct planned dish). GET returns the same list.

- [ ] **Step 5: Commit**

```bash
git add app/api/meals/shopping/generate/route.ts app/api/meals/shopping/route.ts
git commit -m "feat(meals): add shopping-list generate and week-read routes"
```

---

## Task 4: Item CRUD API routes

**Files:**
- Create: `app/api/meals/shopping/items/route.ts`, `app/api/meals/shopping/items/[id]/route.ts`

**Interfaces:**
- Produces:
  - `POST /api/meals/shopping/items` — `{ list_id, ingredient, quantity?, category }` → inserted `MealShoppingItem` (`from_dishes` null).
  - `PATCH /api/meals/shopping/items/[id]` — partial `{ ingredient, quantity, category, already_have, checked }` → updated row.
  - `DELETE /api/meals/shopping/items/[id]` → `{ success: true }`.

- [ ] **Step 1: Implement items POST**

```ts
// app/api/meals/shopping/items/route.ts
import { supabase } from '@/lib/supabase'

const CATEGORIES = ['protein', 'vegetable', 'pantry', 'other']

export async function POST(request: Request) {
  const body = await request.json()
  if (!body.list_id || !body.ingredient?.trim()) {
    return Response.json({ error: 'list_id and ingredient required' }, { status: 400 })
  }
  const category = CATEGORIES.includes(body.category) ? body.category : 'other'
  const { data, error } = await supabase.from('meal_shopping_items').insert({
    list_id: body.list_id, ingredient: body.ingredient.trim(),
    quantity: body.quantity?.trim() || null, category,
    already_have: false, checked: false, from_dishes: null,
  }).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}
```

- [ ] **Step 2: Implement items PATCH + DELETE**

```ts
// app/api/meals/shopping/items/[id]/route.ts
import { supabase } from '@/lib/supabase'

const FIELDS = ['ingredient', 'quantity', 'category', 'already_have', 'checked']

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json()
  const patch = Object.fromEntries(Object.entries(body).filter(([k]) => FIELDS.includes(k)))
  const { data, error } = await supabase.from('meal_shopping_items').update(patch).eq('id', id).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await supabase.from('meal_shopping_items').delete().eq('id', id)
  return Response.json({ success: true })
}
```

- [ ] **Step 3: Manual smoke test**

```bash
COOKIE='hs_session={"id":"00000000-0000-0000-0000-000000000000","name":"Test"}'
LID=$(curl -s --cookie "$COOKIE" "localhost:3000/api/meals/shopping?weekStart=2026-08-10" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).list.id))')
ITEM=$(curl -s -X POST --cookie "$COOKIE" localhost:3000/api/meals/shopping/items -H 'content-type: application/json' -d "{\"list_id\":\"$LID\",\"ingredient\":\"Test salt\",\"category\":\"pantry\"}")
echo "$ITEM" | head -c 200
IID=$(echo "$ITEM" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).id))')
curl -s -X PATCH --cookie "$COOKIE" localhost:3000/api/meals/shopping/items/$IID -H 'content-type: application/json' -d '{"checked":true}' -w "\nPATCH %{http_code}\n" | head -c 120
curl -s -X DELETE --cookie "$COOKIE" localhost:3000/api/meals/shopping/items/$IID -w "\nDELETE %{http_code}\n"
```
Expected: POST returns a row with `from_dishes:null`; PATCH sets `checked:true` (200); DELETE returns `{success:true}` (200).

- [ ] **Step 4: Commit**

```bash
git add app/api/meals/shopping/items
git commit -m "feat(meals): add shopping-list item CRUD routes"
```

---

## Task 5: Shopping List tab + server page

**Files:**
- Modify: `components/meals/MealsTabs.tsx`
- Create: `app/meals/shopping/page.tsx`

**Interfaces:**
- Consumes: `supabase`, `currentMonday`, `MealShoppingList`, `MealShoppingItem`.
- Produces: `ShoppingListClient` receives `{ initialWeekStart, initialList, initialItems }` (built in Task 6; page references it).

- [ ] **Step 1: Add the third tab**

In `components/meals/MealsTabs.tsx`, extend the `tabs` array:
```ts
const tabs = [
  { href: '/meals', label: 'Plan' },
  { href: '/meals/dishes', label: 'Dishes' },
  { href: '/meals/shopping', label: 'Shopping List' },
]
```

- [ ] **Step 2: Create the server page**

```tsx
// app/meals/shopping/page.tsx
export const dynamic = 'force-dynamic'

import { supabase } from '@/lib/supabase'
import { currentMonday } from '@/lib/meals/dates'
import type { MealShoppingList, MealShoppingItem } from '@/lib/meals/types'
import ShoppingListClient from '@/components/meals/ShoppingListClient'

export default async function MealShoppingPage() {
  const weekStart = currentMonday()
  const { data: list } = await supabase.from('meal_shopping_lists')
    .select('*').eq('week_start', weekStart).maybeSingle()
  let items: MealShoppingItem[] = []
  if (list) {
    const { data } = await supabase.from('meal_shopping_items')
      .select('*').eq('list_id', list.id).order('created_at', { ascending: true })
    items = (data ?? []) as MealShoppingItem[]
  }
  return (
    <ShoppingListClient
      initialWeekStart={weekStart}
      initialList={(list ?? null) as MealShoppingList | null}
      initialItems={items}
    />
  )
}
```

- [ ] **Step 3: Add a temporary placeholder client so the page compiles**

Create `components/meals/ShoppingListClient.tsx` with a minimal stub (replaced fully in Task 6) so Task 5 is independently testable:
```tsx
'use client'
import type { MealShoppingList, MealShoppingItem } from '@/lib/meals/types'

export default function ShoppingListClient({ initialWeekStart }: {
  initialWeekStart: string
  initialList: MealShoppingList | null
  initialItems: MealShoppingItem[]
}) {
  return <div className="text-stone-500">Shopping list for week of {initialWeekStart}</div>
}
```

- [ ] **Step 4: Manual check**

Run dev; open `/meals/shopping`. Confirm: the "Shopping List" tab appears and is active (orange), the placeholder text renders, and Plan/Dishes tabs still work.

- [ ] **Step 5: Commit**

```bash
git add components/meals/MealsTabs.tsx app/meals/shopping/page.tsx components/meals/ShoppingListClient.tsx
git commit -m "feat(meals): add Shopping List tab and server page"
```

---

## Task 6: ShoppingListClient — full list UI

**Files:**
- Modify: `components/meals/ShoppingListClient.tsx` (replace the stub)

**Interfaces:**
- Consumes: shopping API routes; `SHOP_CATEGORIES` from `@/lib/meals/shopping`; `currentMonday`, `shiftWeek`, `weekDates` from `@/lib/meals/dates`; `MealShoppingList`, `MealShoppingItem` from `@/lib/meals/types`.

Behavior contract:
- Week bar (prev/next/This week) fetches `GET /api/meals/shopping?weekStart=` and swaps `list`+`items`.
- Generate button POSTs `/api/meals/shopping/generate`; **if a list already exists for the week, confirm first** with `window.confirm('Regenerate? This clears manually-added items and your ✓ marks.')`.
- Progress: `total` = items with `category!=='dish'` && `!already_have`; `remaining` = those && `!checked`. Show `"{remaining} of {total} to buy"`.
- Category groups protein→vegetable→pantry→other; within a group `already_have` items sink to bottom and render greyed. `category==='dish'` items render in a separate bottom "Dishes this week" section, excluded from progress.
- Item row controls (always visible): checked checkbox (strikethrough when checked), inline-edit ingredient + quantity (blur → PATCH), category badge, "Already have ✓" toggle, delete. `from_dishes` → "for: A, B" caption.
- Add-item inline form (name, quantity optional, category select) → POST; disabled if no `list` yet.

- [ ] **Step 1: Implement the full component**

```tsx
// components/meals/ShoppingListClient.tsx
'use client'
import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, ListChecks, Trash2, Plus } from 'lucide-react'
import { SHOP_CATEGORIES, type ShopCategory } from '@/lib/meals/shopping'
import { currentMonday, shiftWeek, weekDates } from '@/lib/meals/dates'
import type { MealShoppingList, MealShoppingItem } from '@/lib/meals/types'

const CAT_LABEL: Record<string, string> = {
  protein: 'Protein', vegetable: 'Vegetable', pantry: 'Pantry', other: 'Other', dish: 'Dishes this week',
}
const CAT_BADGE: Record<string, string> = {
  protein: 'bg-rose-100 text-rose-700', vegetable: 'bg-green-100 text-green-700',
  pantry: 'bg-amber-100 text-amber-700', other: 'bg-stone-100 text-stone-600', dish: 'bg-stone-100 text-stone-500',
}
function label(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function ShoppingListClient({ initialWeekStart, initialList, initialItems }: {
  initialWeekStart: string
  initialList: MealShoppingList | null
  initialItems: MealShoppingItem[]
}) {
  const [weekStart, setWeekStart] = useState(initialWeekStart)
  const [list, setList] = useState<MealShoppingList | null>(initialList)
  const [items, setItems] = useState<MealShoppingItem[]>(initialItems)
  const [busy, setBusy] = useState(false)
  const days = useMemo(() => weekDates(weekStart), [weekStart])

  async function loadWeek(ws: string) {
    setWeekStart(ws)
    const res = await fetch(`/api/meals/shopping?weekStart=${ws}`)
    const { list, items } = await res.json()
    setList(list ?? null); setItems(items ?? [])
  }

  async function generate() {
    if (list && !window.confirm('Regenerate? This clears manually-added items and your ✓ marks.')) return
    setBusy(true)
    try {
      const res = await fetch('/api/meals/shopping/generate', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ weekStart }),
      })
      const { list, items } = await res.json()
      setList(list ?? null); setItems(items ?? [])
    } finally { setBusy(false) }
  }

  function patchItem(id: string, fields: Partial<MealShoppingItem>) {
    const prev = items.find(i => i.id === id)
    setItems(is => is.map(i => i.id === id ? { ...i, ...fields } : i)) // optimistic
    fetch(`/api/meals/shopping/items/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fields),
    }).then(res => { if (!res.ok && prev) setItems(is => is.map(i => i.id === id ? prev : i)) })
  }
  async function deleteItem(id: string) {
    const prev = items
    setItems(is => is.filter(i => i.id !== id)) // optimistic
    const res = await fetch(`/api/meals/shopping/items/${id}`, { method: 'DELETE' })
    if (!res.ok) setItems(prev)
  }
  async function addItem(ingredient: string, quantity: string, category: ShopCategory) {
    if (!list || !ingredient.trim()) return
    const res = await fetch('/api/meals/shopping/items', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ list_id: list.id, ingredient, quantity, category }),
    })
    if (res.ok) { const row = await res.json(); setItems(is => [...is, row as MealShoppingItem]) }
  }

  const buyable = items.filter(i => i.category !== 'dish' && !i.already_have)
  const remaining = buyable.filter(i => !i.checked).length
  const dishRows = items.filter(i => i.category === 'dish')

  return (
    <div>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => loadWeek(shiftWeek(weekStart, -7))} className="p-2 rounded-lg hover:bg-stone-100 text-stone-600" aria-label="Previous week"><ChevronLeft size={18} /></button>
          <span className="text-sm font-medium text-stone-700 min-w-[9rem] text-center">{label(days[0])} – {label(days[6])}</span>
          <button onClick={() => loadWeek(shiftWeek(weekStart, 7))} className="p-2 rounded-lg hover:bg-stone-100 text-stone-600" aria-label="Next week"><ChevronRight size={18} /></button>
          <button onClick={() => loadWeek(currentMonday())} className="ml-1 text-sm text-stone-500 hover:text-stone-800 px-2 py-1">This week</button>
        </div>
        <div className="flex items-center gap-3">
          {list && <span className="text-sm text-stone-500">{remaining} of {buyable.length} to buy</span>}
          <button onClick={generate} disabled={busy}
            className="flex items-center gap-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors">
            <ListChecks size={16} /> {busy ? 'Working…' : list ? 'Regenerate' : 'Generate shopping list'}
          </button>
        </div>
      </div>

      {!list && (
        <div className="bg-white border border-stone-200 rounded-2xl p-8 text-center text-stone-500">
          No shopping list for this week yet.<br />
          <span className="text-sm">Generate one from this week&apos;s meal plan.</span>
        </div>
      )}

      {list && SHOP_CATEGORIES.map(cat => {
        const rows = items.filter(i => i.category === cat)
          .sort((a, b) => Number(a.already_have) - Number(b.already_have))
        if (rows.length === 0) return null
        return (
          <section key={cat} className="mb-5">
            <h2 className="text-sm font-semibold text-stone-500 mb-2">{CAT_LABEL[cat]}</h2>
            <div className="bg-white border border-stone-200 rounded-2xl divide-y divide-stone-100">
              {rows.map(item => <ItemRow key={item.id} item={item} onPatch={patchItem} onDelete={deleteItem} />)}
            </div>
          </section>
        )
      })}

      {list && <AddItem onAdd={addItem} />}

      {dishRows.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-stone-500 mb-1">Dishes this week</h2>
          <p className="text-xs text-stone-400 mb-2">These dishes have no ingredients yet — add what to buy manually above.</p>
          <div className="bg-white border border-stone-200 rounded-2xl divide-y divide-stone-100">
            {dishRows.map(item => (
              <div key={item.id} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-stone-700">{item.ingredient}</span>
                <button onClick={() => deleteItem(item.id)} className="text-stone-300 hover:text-stone-600" aria-label="Delete"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function ItemRow({ item, onPatch, onDelete }: {
  item: MealShoppingItem
  onPatch: (id: string, f: Partial<MealShoppingItem>) => void
  onDelete: (id: string) => void
}) {
  const [name, setName] = useState(item.ingredient)
  const [qty, setQty] = useState(item.quantity ?? '')
  const dishes = (item.from_dishes ?? []).map(f => f.dish).filter(Boolean)
  return (
    <div className={`flex items-center gap-2.5 px-4 py-2.5 ${item.already_have ? 'opacity-50' : ''}`}>
      <button onClick={() => onPatch(item.id, { checked: !item.checked })} aria-label="Bought"
        className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${
          item.checked ? 'border-green-400 bg-green-400' : 'border-stone-300 hover:border-stone-400'}`}>
        {item.checked && <span className="text-white text-xs">✓</span>}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <input value={name} onChange={e => setName(e.target.value)}
            onBlur={() => name.trim() && name !== item.ingredient && onPatch(item.id, { ingredient: name.trim() })}
            className={`bg-transparent focus:outline-none focus:bg-stone-50 rounded px-1 ${item.checked ? 'line-through text-stone-400' : 'text-stone-800'}`} />
          <input value={qty} onChange={e => setQty(e.target.value)} placeholder="qty"
            onBlur={() => (qty.trim() || null) !== item.quantity && onPatch(item.id, { quantity: qty.trim() || null })}
            className="bg-transparent focus:outline-none focus:bg-stone-50 rounded px-1 text-sm text-stone-500 w-24" />
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${CAT_BADGE[item.category]}`}>{CAT_LABEL[item.category]}</span>
        </div>
        {dishes.length > 0 && <div className="text-[11px] text-stone-400 mt-0.5 truncate">for: {dishes.join(', ')}</div>}
      </div>
      <button onClick={() => onPatch(item.id, { already_have: !item.already_have })}
        className={`text-xs px-2 py-1 rounded-lg whitespace-nowrap ${item.already_have ? 'text-green-600 bg-green-50' : 'text-stone-400 hover:text-stone-700'}`}>
        Already have ✓
      </button>
      <button onClick={() => onDelete(item.id)} className="text-stone-300 hover:text-stone-600" aria-label="Delete"><Trash2 size={15} /></button>
    </div>
  )
}

function AddItem({ onAdd }: { onAdd: (ingredient: string, quantity: string, category: ShopCategory) => void }) {
  const [name, setName] = useState('')
  const [qty, setQty] = useState('')
  const [cat, setCat] = useState<ShopCategory>('other')
  function submit() { if (name.trim()) { onAdd(name.trim(), qty.trim(), cat); setName(''); setQty('') } }
  return (
    <div className="flex items-center gap-2 flex-wrap bg-white border border-stone-200 rounded-2xl px-3 py-2 mt-2">
      <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()}
        placeholder="Add an item…" className="flex-1 min-w-[8rem] bg-transparent focus:outline-none text-sm text-stone-800 px-1" />
      <input value={qty} onChange={e => setQty(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()}
        placeholder="qty" className="w-20 bg-transparent focus:outline-none text-sm text-stone-500 px-1" />
      <select value={cat} onChange={e => setCat(e.target.value as ShopCategory)} className="text-sm text-stone-600 bg-transparent focus:outline-none">
        {SHOP_CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
      </select>
      <button onClick={submit} className="flex items-center gap-1 text-sm text-orange-600 hover:text-orange-700"><Plus size={15} /> Add</button>
    </div>
  )
}
```

- [ ] **Step 2: Manual check (desktop + mobile)**

Run dev; `/meals/shopping`:
- Generate → dish placeholders appear under "Dishes this week" (since no ingredients seeded).
- Add a manual item (e.g. "Beras 5kg / pantry") → appears in Pantry group; progress shows "1 of 1 to buy".
- Check it → strikethrough, progress "0 of 1".
- "Already have ✓" → greys, sinks to bottom, drops out of progress denominator.
- Inline-edit name/quantity → persists after reload.
- Delete → row removed.
- Prev/next week → different (likely empty) week; "This week" returns.
- Regenerate with an existing list → confirm dialog appears.
- Narrow viewport → single-column, controls visible.

- [ ] **Step 3: Commit**

```bash
git add components/meals/ShoppingListClient.tsx
git commit -m "feat(meals): implement shopping list UI with week nav and progress"
```

---

## Task 7: Verification + build

**Files:** none (verification only).

- [ ] **Step 1: Unit tests**

Run: `npm test`
Expected: all pass (dates: 6, engine: 26, shopping: new — every suite green).

- [ ] **Step 2: Build / typecheck**

Run: `npm run build` (use sandbox-disabled run if the bundler needs a port)
Expected: build succeeds, no type errors. New routes `/api/meals/shopping*` and page `/meals/shopping` appear in the route list.

- [ ] **Step 3: End-to-end manual pass**

With dev running and a session cookie / logged in:
- All three tabs (Plan, Dishes, Shopping List) navigate and highlight correctly.
- Generate builds the week list; regenerate confirms then full-replaces.
- Manual add / edit / check / already-have / delete all persist across reload.
- Progress count matches (excludes already_have and dish rows).
- Week nav loads per-week lists; a past week with a saved list still shows it.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix(meals): resolve build/type issues from shopping-list verification"
```

---

## Self-Review Notes (for the planner, not a task)

- **Spec coverage:** tab (T5), generate full-replace (T3), builder aggregation + dishes-without-ingredients (T2), grouped UI with badges/toggles/progress (T6), manual add/edit/delete (T4/T6), week history nav (T6), confirm-on-regenerate (T6), tests (T1/T2). ✅
- **DRY refactor:** T1 extracts week helpers and updates both existing consumers (PlanClient, reroll) — must keep their behavior identical (verified by the still-green plan tests + manual plan check).
- **Category note:** `'dish'` is a marker outside `SHOP_CATEGORIES`; progress and the 4-bucket loop both exclude it; only the dedicated "Dishes this week" section renders it.
- **Type consistency:** `MealShoppingItem.from_dishes` is `{dish, quantity?}[] | null` across builder output, routes, and UI; manual items set it `null`; the UI reads `.dish` for the caption.
