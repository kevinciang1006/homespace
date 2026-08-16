# Meal Planner: Overview relocation, Cook tracking, Recipe links, Locking/Rerolling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relocate the Week Overview below the meal grid; add cook tracking, per-dish recipe links, and full per-slot/per-day locking + rerolling.

**Architecture:** Pure logic in `lib/meals/*` (unit-tested); Next.js route handlers under `app/api/meals/*` using `lib/supabase.ts`; client UI in `components/meals/*`. Session via `hs_session` cookie.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Tailwind v4, Supabase JS (anon), lucide-react, Vitest.

## Global Constraints

- Signal/status colors: green / stone / amber — **never red**.
- DM Serif Display headings via `style={{ fontFamily: 'DM Serif Display, serif' }}`.
- White cards `border border-stone-200 rounded-2xl`; orange accent `orange-600`. Mobile-first.
- All DB access through `lib/supabase.ts` (anon role). `hs_session` cookie is JSON `{id,name,phone}`.
- Read the relevant guide in `node_modules/next/dist/docs/` before writing route/handler code if unsure — this Next.js has breaking changes; `params`/`searchParams` are Promises.
- Do NOT drop the `pelengkap` column or delete dishes; generation already excludes it.
- Meals grid stays the first/primary element on the plan view.

---

### Task 1: Recipe-links plumbing (types, join SELECT, PATCH field, `detectSource`)

**Files:**
- Create: `lib/meals/recipeLinks.ts`
- Test: `lib/meals/recipeLinks.test.ts`
- Modify: `lib/meals/types.ts` (Dish + MealPlan.dishes)
- Modify: `app/meals/page.tsx`, `app/api/meals/week/route.ts`, `app/api/meals/generate/route.ts`, `app/api/meals/reroll/route.ts` (SELECT const) — add `recipe_links` to the dishes join
- Modify: `app/api/meals/dishes/[id]/route.ts` — add `recipe_links` to `FIELDS`

**Interfaces:**
- Produces: `type RecipeSource = 'youtube'|'instagram'|'tiktok'|'web'`; `type RecipeLink = { url: string; title?: string; source: RecipeSource }`; `detectSource(url: string): RecipeSource`.

- [ ] **Step 1: Write the failing test** `lib/meals/recipeLinks.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { detectSource } from './recipeLinks'

describe('detectSource', () => {
  it('detects youtube', () => {
    expect(detectSource('https://www.youtube.com/watch?v=abc')).toBe('youtube')
    expect(detectSource('https://youtu.be/abc')).toBe('youtube')
  })
  it('detects instagram', () => {
    expect(detectSource('https://www.instagram.com/reel/xyz/')).toBe('instagram')
  })
  it('detects tiktok', () => {
    expect(detectSource('https://www.tiktok.com/@user/video/123')).toBe('tiktok')
  })
  it('falls back to web for anything else', () => {
    expect(detectSource('https://cookpad.com/id/resep/123')).toBe('web')
    expect(detectSource('not a url')).toBe('web')
  })
})
```

- [ ] **Step 2: Run it to confirm it fails** — `npm test -- recipeLinks` → FAIL (module missing).

- [ ] **Step 3: Create `lib/meals/recipeLinks.ts`**

```ts
export type RecipeSource = 'youtube' | 'instagram' | 'tiktok' | 'web'
export type RecipeLink = { url: string; title?: string; source: RecipeSource }

export function detectSource(url: string): RecipeSource {
  let host = ''
  try { host = new URL(url).hostname.toLowerCase() } catch { return 'web' }
  if (host.includes('youtube.') || host === 'youtu.be' || host.endsWith('.youtu.be')) return 'youtube'
  if (host.includes('instagram.')) return 'instagram'
  if (host.includes('tiktok.')) return 'tiktok'
  return 'web'
}
```

- [ ] **Step 4: Run the test** — `npm test -- recipeLinks` → PASS.

- [ ] **Step 5: Add `recipe_links` to types** in `lib/meals/types.ts`:
  - Import type at top: `import type { RecipeLink } from './recipeLinks'`
  - In `Dish`, after `is_garnish: boolean`, add: `recipe_links: RecipeLink[] | null`
  - In `MealPlan.dishes` object type, add `; recipe_links: RecipeLink[] | null` before the closing `}`.

- [ ] **Step 6: Add `recipe_links` to every dishes-join SELECT.** In each of `app/meals/page.tsx`, `app/api/meals/week/route.ts`, `app/api/meals/generate/route.ts`, and the `SELECT` const in `app/api/meals/reroll/route.ts`, change the join list `dishes(tier, spicy, richness, provides_soup, recipe_image_url, protein, saltiness, difficulty, method)` to end with `..., method, recipe_links)`.

- [ ] **Step 7: Add `recipe_links` to the dishes PATCH.** In `app/api/meals/dishes/[id]/route.ts`, append `'recipe_links'` to the `FIELDS` array.

- [ ] **Step 8: Typecheck + commit** — `npx tsc --noEmit` clean, then:

```bash
git add lib/meals/recipeLinks.ts lib/meals/recipeLinks.test.ts lib/meals/types.ts app/meals/page.tsx app/api/meals/week/route.ts app/api/meals/generate/route.ts app/api/meals/reroll/route.ts app/api/meals/dishes/\[id\]/route.ts
git commit -m "feat(meals): add recipe_links plumbing (type, join, PATCH, detectSource)"
```

---

### Task 2: Relocate Week Overview below the grid as a collapsed accordion

**Files:**
- Modify: `components/meals/WeekOverview.tsx`
- Modify: `components/meals/PlanClient.tsx` (move `<WeekOverview>` below the grid)

- [ ] **Step 1: Make WeekOverview a collapsed-by-default accordion at all breakpoints.** In `components/meals/WeekOverview.tsx`, replace the header + grid so the grid is gated purely on `expanded` (drop `sm:grid`/`sm:hidden`), and label the header `📊 Week overview`:

```tsx
return (
  <div className="bg-white border border-stone-200 rounded-2xl p-4 mt-6">
    <button onClick={() => setExpanded(e => !e)} className="w-full flex items-center justify-between text-left">
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-stone-400">📊 Week overview</div>
        <div className="text-lg text-stone-900 leading-tight" style={{ fontFamily: 'DM Serif Display, serif' }}>{overview.verdict}</div>
        {!expanded && <div className="text-xs text-stone-500 mt-0.5 truncate">{overview.summary}</div>}
      </div>
      <span className="text-stone-400 shrink-0 ml-2">{expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</span>
    </button>
    <div className={`${expanded ? 'grid' : 'hidden'} grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-5 gap-y-2.5 mt-3 pt-3 border-t border-stone-100`}>
      {overview.signals.map(s => (
        <div key={s.label} className="flex items-start gap-2">
          <span className="text-base leading-none mt-0.5">{s.emoji}</span>
          <div className="min-w-0">
            <div className={`text-xs font-medium ${STATUS[s.status]}`}>{s.label}</div>
            <div className="text-[11px] text-stone-500 leading-snug">{s.detail}</div>
          </div>
        </div>
      ))}
    </div>
  </div>
)
```
  Also change the empty-state wrapper's `mb-4` to `mt-6` so it sits below the grid too.

- [ ] **Step 2: Move `<WeekOverview>` below the grid** in `components/meals/PlanClient.tsx`: delete the `<WeekOverview overview={overview} />` line currently above `<div className="grid ...">`, and add it immediately AFTER that grid's closing `</div>` (still inside the outer wrapper). The `useMemo` `overview` stays.

- [ ] **Step 3: Build check** — `npm run build` (with `dangerouslyDisableSandbox: true`) → clean.

- [ ] **Step 4: Commit**

```bash
git add components/meals/WeekOverview.tsx components/meals/PlanClient.tsx
git commit -m "feat(meals): move Week Overview below the grid as a collapsed accordion"
```

---

### Task 3: Recipe-links editor section in DishEditorPanel

**Files:**
- Modify: `components/meals/DishEditorPanel.tsx`

**Interfaces:**
- Consumes: `RecipeLink`, `detectSource` from `lib/meals/recipeLinks`; `onPatch(dish.id, { recipe_links })`.

- [ ] **Step 1: Add link state + helpers** near the other `useState` in `DishEditorPanel`:

```tsx
import { detectSource, type RecipeLink } from '@/lib/meals/recipeLinks'
// ...
const [links, setLinks] = useState<RecipeLink[]>(dish.recipe_links ?? [])
const [newUrl, setNewUrl] = useState('')
const [newTitle, setNewTitle] = useState('')
function saveLinks(next: RecipeLink[]) { setLinks(next); onPatch(dish.id, { recipe_links: next }) }
function addLink() {
  const url = newUrl.trim(); if (!url) return
  saveLinks([...links, { url, title: newTitle.trim() || undefined, source: detectSource(url) }])
  setNewUrl(''); setNewTitle('')
}
const removeLink = (i: number) => saveLinks(links.filter((_, idx) => idx !== i))
```

- [ ] **Step 2: Add the "Recipe links" `<section>`** after the Recipe steps section (near the end, before the panel's closing tags):

```tsx
<section>
  <h3 className="text-sm font-medium text-stone-600 mb-2">Recipe links</h3>
  {links.length === 0 && <p className="text-sm text-stone-400">No links yet.</p>}
  <div className="space-y-1.5">
    {links.map((l, i) => (
      <div key={i} className="flex items-center gap-2 text-sm">
        <span className="shrink-0">{SOURCE_EMOJI[l.source]}</span>
        <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-orange-700 hover:underline truncate min-w-0 flex-1">{l.title || l.url}</a>
        <button onClick={() => removeLink(i)} className="text-stone-300 hover:text-stone-600 shrink-0" aria-label="Remove link">✕</button>
      </div>
    ))}
  </div>
  <div className="mt-2 space-y-1.5">
    <input value={newUrl} onChange={e => setNewUrl(e.target.value)} placeholder="Paste a recipe URL (YouTube, IG, TikTok, web)"
      className="w-full border border-stone-200 rounded-lg px-2.5 py-1.5 text-sm" />
    <div className="flex gap-1.5">
      <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Title (optional)"
        className="flex-1 border border-stone-200 rounded-lg px-2.5 py-1.5 text-sm" />
      <button onClick={addLink} className="px-3 py-1.5 rounded-lg bg-orange-600 text-white text-sm">Add</button>
    </div>
  </div>
</section>
```
  And add a module-level const near the top of the file:

```tsx
const SOURCE_EMOJI: Record<string, string> = { youtube: '▶️', instagram: '📸', tiktok: '🎵', web: '🔗' }
```

- [ ] **Step 3: Build check** → clean. **Step 4: Commit**

```bash
git add components/meals/DishEditorPanel.tsx
git commit -m "feat(meals): recipe links editor in the dish editor panel"
```

---

### Task 4: Recipe-links display + quick-add on plan cards

**Files:**
- Create: `components/meals/RecipeLinkButton.tsx`
- Modify: `components/meals/PlanClient.tsx` (use it in MainHero, SupportChip, DesertRow; add quick-add PATCH helper)

**Interfaces:**
- Consumes: `RecipeLink`, `detectSource`; the joined `row.dishes.recipe_links`; `row.dish_id`.
- Produces: `<RecipeLinkButton row={row} onReplaceCell={fn} size={...} />`.

- [ ] **Step 1: Create `components/meals/RecipeLinkButton.tsx`** — a small icon button that opens link(s) and supports quick-add. It PATCHes `/api/meals/dishes/{dish_id}` with the merged array and calls `onReplaceCell` with updated joined meta:

```tsx
'use client'
import { useState } from 'react'
import { Link2, Plus } from 'lucide-react'
import { detectSource, type RecipeLink } from '@/lib/meals/recipeLinks'
import type { MealPlan } from '@/lib/meals/types'

export default function RecipeLinkButton({ row, onReplaceCell, iconSize = 11 }: {
  row: MealPlan; onReplaceCell: (r: MealPlan) => void; iconSize?: number
}) {
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [url, setUrl] = useState('')
  const links = row.dishes?.recipe_links ?? []
  if (!row.dish_id) return null

  async function save(next: RecipeLink[]) {
    onReplaceCell({ ...row, dishes: { ...(row.dishes as NonNullable<MealPlan['dishes']>), recipe_links: next } })
    await fetch(`/api/meals/dishes/${row.dish_id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recipe_links: next }),
    })
  }
  function add() {
    const u = url.trim(); if (!u) return
    save([...links, { url: u, source: detectSource(u) }]); setUrl(''); setAdding(false); setOpen(false)
  }
  function click() {
    if (links.length === 1) { window.open(links[0].url, '_blank', 'noopener'); return }
    setOpen(o => !o)
  }
  return (
    <div className="relative">
      <button onClick={click} aria-label="Recipe links"
        className={`p-0.5 rounded bg-white/85 backdrop-blur ${links.length ? 'text-orange-600' : 'text-stone-400 hover:text-stone-700'}`}>
        <Link2 size={iconSize} />
      </button>
      {open && (
        <div className="absolute z-30 right-0 top-full mt-1 w-44 bg-white border border-stone-200 rounded-xl shadow-lg p-1">
          {links.map((l, i) => (
            <a key={i} href={l.url} target="_blank" rel="noopener noreferrer"
              className="block px-2 py-1 rounded-lg hover:bg-stone-50 text-stone-700 text-xs truncate">{l.title || l.url}</a>
          ))}
          {adding
            ? <div className="flex gap-1 p-1">
                <input autoFocus value={url} onChange={e => setUrl(e.target.value)} placeholder="Paste URL"
                  className="flex-1 min-w-0 border border-stone-200 rounded px-1.5 py-1 text-xs" />
                <button onClick={add} className="px-2 rounded bg-orange-600 text-white text-xs">Add</button>
              </div>
            : <button onClick={() => setAdding(true)} className="w-full flex items-center gap-1 px-2 py-1 rounded-lg text-orange-700 text-xs hover:bg-orange-50"><Plus size={11} /> recipe</button>}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Wire into the three card components** in `PlanClient.tsx`. In `MainHero`, `SupportChip`, and `DesertRow`, add `<RecipeLinkButton row={row} onReplaceCell={onReplaceCell} />` inside the existing top-right control cluster (next to the lock/shuffle buttons). Import it at the top: `import RecipeLinkButton from './RecipeLinkButton'`.

- [ ] **Step 3: Build check** → clean. **Step 4: Commit**

```bash
git add components/meals/RecipeLinkButton.tsx components/meals/PlanClient.tsx
git commit -m "feat(meals): recipe link icon + quick-add on plan cards"
```

---

### Task 5: Fix per-slot reroll for support/soup/desert (the bug)

Use systematic-debugging: reproduce → confirm root cause → fix → verify.

**Files:**
- Modify: `components/meals/PlanClient.tsx` (SupportChip + DesertRow popover clipping)

- [ ] **Step 1: Reproduce.** Start dev server (`npm run dev`, `dangerouslyDisableSandbox: true`), open a planned week, click Shuffle on a sayuran/soup support. Confirm the alternatives popover does not appear (clipped). Confirm via `curl` that the endpoint itself returns a valid `{ pick }` (POST `/api/meals/reroll` with `{plan_date, slot:'sayuran'}` and the `hs_session` cookie) — proving the failure is UI-only.

- [ ] **Step 2: Root cause.** `SupportChip`'s root has `rounded-xl overflow-hidden`; its alternatives popover is `absolute ... top-full` (outside the card box) → clipped by `overflow-hidden`. Same pattern to check on `DesertRow`.

- [ ] **Step 3: Fix.** Remove `overflow-hidden` from the `SupportChip` (and `DesertRow` if present) root container, and instead apply the rounding/clipping only to the image (`DishImage` already takes a `rounded` prop / wrap the `<Link>`'s image area in a `rounded-t-xl overflow-hidden` element) so the popover can overflow. Keep the card's outer corners rounded via `rounded-xl` without clipping descendants.

- [ ] **Step 4: Verify.** Reload, click Shuffle on sayuran → popover shows "🎲 Surprise me" + alternatives; picking one swaps the dish (card updates). Repeat for soup (`kuah`) and desert. Confirm main reroll still works.

- [ ] **Step 5: Commit**

```bash
git add components/meals/PlanClient.tsx
git commit -m "fix(meals): support/soup/desert reroll popover was clipped by overflow-hidden"
```

---

### Task 6: Per-day reroll

**Files:**
- Modify: `app/api/meals/reroll/route.ts` (add `scope:'day'` branch)
- Modify: `components/meals/PlanClient.tsx` (DayPlate header shuffle button)

**Interfaces:**
- Consumes: `composeDay`, `deriveDays`, `loadWeek`, `roleForSlot`, `SELECT` (already in file).
- Produces: `POST /api/meals/reroll { plan_date, scope:'day' }` → `{ day: MealPlan[] }`.

- [ ] **Step 1: Add the `scope:'day'` branch** at the top of `POST` in `reroll/route.ts`, before the locked-cell existence check (which is slot-specific). It recomposes the whole day, keeping locked cells:

```ts
if (body.scope === 'day') {
  const { plan_date } = body
  if (!plan_date) return Response.json({ error: 'plan_date required' }, { status: 400 })
  const { week, allDishes, plans } = await loadWeek(plan_date)
  const dishById = new Map(allDishes.map(d => [d.id, d]))
  const weekSet = new Set(week)
  const { specialDays, hardDays } = deriveDays(week, plans, dishById)
  const dayLocked = plans.filter(p => p.plan_date === plan_date && p.locked)
  const lockedByCell = new Map(dayLocked.map(l => [`${l.plan_date}|${l.slot}`, l]))
  const runPicks = plans
    .filter(p => !(p.plan_date === plan_date && !p.locked))
    .map(p => ({ plan_date: p.plan_date, slot: p.slot as Slot, dish_id: p.dish_id, dish_name: p.dish_name,
      locked: p.locked, role: (p.role ?? 'support') as Role, skipped: p.skipped ?? false }))
  const priorPlans = plans.filter(p => !weekSet.has(p.plan_date))
  const dishesBySlot = Object.fromEntries(SLOTS.map(s => [s, allDishes.filter(d => d.slot === s)])) as Record<Slot, Dish[]>
  const created = composeDay({ date: plan_date, dishesBySlot, dishById, priorPlans, runPicks, lockedByCell, specialDays, hardDays, rng })
  await supabase.from('meal_plans').delete().eq('plan_date', plan_date).eq('locked', false)
  const toInsert = created.filter(p => !p.locked)
  if (toInsert.length) {
    const { error } = await supabase.from('meal_plans').insert(toInsert.map(p => ({
      plan_date: p.plan_date, slot: p.slot, dish_id: p.dish_id, dish_name: p.dish_name,
      locked: false, role: p.role, skipped: p.skipped })))
    if (error) return Response.json({ error: error.message }, { status: 500 })
  }
  const { data: day } = await supabase.from('meal_plans').select(SELECT).eq('plan_date', plan_date)
  return Response.json({ day: (day ?? []) as MealPlan[] })
}
```
  (Verify `composeDay`'s returned locked cells carry `locked:true`; the `.filter(p => !p.locked)` before insert avoids colliding with the surviving locked rows.)

- [ ] **Step 2: Add a per-day shuffle button** to the `DayPlate` header in `PlanClient.tsx`. Add a handler beside `rerollMain`:

```tsx
const [rerollingDay, setRerollingDay] = useState(false)
async function rerollDay() {
  setRerollingDay(true)
  try {
    const res = await fetch('/api/meals/reroll', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan_date: date, scope: 'day' }),
    })
    if (res.ok) { const { day } = await res.json(); onReplaceDay(date, day) }
  } finally { setRerollingDay(false) }
}
```
  Render a `<Shuffle>` icon button in the day header (hidden/disabled when the day is locked — see Task 7).

- [ ] **Step 3: Verify** — click per-day shuffle: all non-locked slots change, a locked slot stays, rest of week unaffected. **Step 4: Commit**

```bash
git add app/api/meals/reroll/route.ts components/meals/PlanClient.tsx
git commit -m "feat(meals): per-day reroll (scope:day) respecting slot locks"
```

---

### Task 7: Per-day lock

**Files:**
- Create: `app/api/meals/day-lock/route.ts`
- Modify: `components/meals/PlanClient.tsx` (DayPlate lock button + locked visual + optimistic state)

**Interfaces:**
- Produces: `POST /api/meals/day-lock { plan_date, locked }` → `{ success: true }`.

- [ ] **Step 1: Create the route** `app/api/meals/day-lock/route.ts`:

```ts
import { supabase } from '@/lib/supabase'

export async function POST(request: Request) {
  const { plan_date, locked } = await request.json()
  if (!plan_date || typeof locked !== 'boolean') {
    return Response.json({ error: 'plan_date and locked required' }, { status: 400 })
  }
  const { error } = await supabase.from('meal_plans').update({ locked }).eq('plan_date', plan_date)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
```

- [ ] **Step 2: Compute day-locked + add the lock button** in `DayPlate`. `const dayLocked = rows.length > 0 && rows.every(r => r.locked)`. Add a handler:

```tsx
async function toggleDayLock() {
  const next = !dayLocked
  onReplaceDay(date, rows.map(r => ({ ...r, locked: next })))  // optimistic
  const res = await fetch('/api/meals/day-lock', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ plan_date: date, locked: next }),
  })
  if (!res.ok) onReplaceDay(date, rows)  // revert
}
```
  Render a `<Lock>`/`<Unlock>` button in the day header next to the per-day shuffle. Disable/hide the per-day shuffle when `dayLocked`.

- [ ] **Step 3: Locked-day visual.** On the `DayPlate` root card, when `dayLocked` add `ring-2 ring-orange-300 bg-orange-50/40` (or an orange border) plus a small `🔒 Locked` badge in the header. Ensure it reads at a glance but stays within the design (orange, not red).

- [ ] **Step 4: Verify** — lock a day (all slots show locked, card tinted, badge shown, shuffle disabled). Hit Generate Week → the locked day is unchanged. Hit per-day reroll on another day → unaffected. Unlock → returns to normal. **Step 5: Commit**

```bash
git add app/api/meals/day-lock/route.ts components/meals/PlanClient.tsx
git commit -m "feat(meals): per-day lock with visible locked state; survives Generate/reroll"
```

---

### Task 8: Cook-log API route

**Files:**
- Create: `app/api/meals/cook-log/route.ts`

**Interfaces:**
- Produces:
  - `GET /api/meals/cook-log?weekStart=YYYY-MM-DD` → `{ entries: CookLogRow[] }`
  - `POST /api/meals/cook-log` body `{ cook_date, entries? }` → `{ entries: CookLogRow[] }`
  - `CookLogRow = { cook_date, slot, planned_dish_id, planned_dish_name, actual_dish_id, actual_dish_name, cooked, note, logged_by }`

- [ ] **Step 1: Create the route.** Uses `weekDates`/`mondayOf` for the GET range, reads `hs_session` for `logged_by`, derives "as planned" from `meal_plans` when no `entries` given, upserts on conflict `(cook_date, slot)`:

```ts
import { cookies } from 'next/headers'
import { supabase } from '@/lib/supabase'
import { weekDates } from '@/lib/meals/dates'

function loggedBy(raw?: string): string | null {
  if (!raw) return null
  try { return (JSON.parse(raw) as { name?: string }).name ?? null } catch { return null }
}

export async function GET(request: Request) {
  const weekStart = new URL(request.url).searchParams.get('weekStart')
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return Response.json({ error: 'weekStart required' }, { status: 400 })
  }
  const days = weekDates(weekStart)
  const { data, error } = await supabase.from('cook_log').select('*')
    .gte('cook_date', days[0]).lte('cook_date', days[6])
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ entries: data ?? [] })
}

export async function POST(request: Request) {
  const store = await cookies()
  const by = loggedBy(store.get('hs_session')?.value)
  const body = await request.json()
  const { cook_date } = body
  if (!cook_date || !/^\d{4}-\d{2}-\d{2}$/.test(cook_date)) {
    return Response.json({ error: 'cook_date required' }, { status: 400 })
  }

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
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ entries: data ?? [] })
}
```

- [ ] **Step 2: Verify with curl** (dev server + `hs_session` cookie): POST `{ "cook_date":"<a planned date>" }` → returns entries with `cooked:true`, `actual==planned`; GET `?weekStart=<that Monday>` → includes them. Confirm a second POST with explicit `entries` (one `cooked:false`) updates in place (no duplicates).

- [ ] **Step 3: Commit**

```bash
git add app/api/meals/cook-log/route.ts
git commit -m "feat(meals): cook-log API (log as-planned or edited actuals)"
```

---

### Task 9: Cook tracking UI (button + CookLogSheet + PlanClient wiring)

**Files:**
- Create: `components/meals/CookLogSheet.tsx`
- Modify: `components/meals/PlanClient.tsx` (fetch cook-log for the week; pass entries to DayPlate; add "✓ Cooked"/Edit footer + badge)

**Interfaces:**
- Consumes: `GET/POST /api/meals/cook-log`; the day's plan `rows`; alternatives GET for slot pools.
- Produces: `<CookLogSheet date rows entries onClose onSaved />`.

- [ ] **Step 1: Fetch cook-log in PlanClient.** Add state `const [cookLog, setCookLog] = useState<Record<string, CookRow[]>>({})` and a loader that runs on mount and inside `loadWeek`/after generate:

```tsx
async function loadCookLog(ws: string) {
  const res = await fetch(`/api/meals/cook-log?weekStart=${ws}`)
  if (res.ok) {
    const { entries } = await res.json()
    const map: Record<string, CookRow[]> = {}
    for (const e of entries) (map[e.cook_date] ||= []).push(e)
    setCookLog(map)
  }
}
```
  Call `loadCookLog(weekStart)` in the existing mount `useEffect` and after `loadWeek` sets a new week. Pass `entries={cookLog[date] ?? []}` and an `onCooked` callback to each `DayPlate`.

- [ ] **Step 2: DayPlate footer.** Add a `cooked` derived flag (`entries.some(e => e.cooked)`), a small ✓ badge near the day name when cooked, and a footer with two controls: **"✓ Cooked"** (one-tap → `POST { cook_date: date }` → refresh that day's entries via `onCooked`) and **"Edit"** (opens `CookLogSheet`). One-tap handler:

```tsx
async function markCooked() {
  const res = await fetch('/api/meals/cook-log', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cook_date: date }),
  })
  if (res.ok) { const { entries } = await res.json(); onCooked(date, entries) }
}
```

- [ ] **Step 3: Create `components/meals/CookLogSheet.tsx`** — a modal overlay listing one row per planned slot. Each row: planned dish label; a `<select>` of the slot pool (fetched per slot from `GET /api/meals/reroll?plan_date&slot&alternatives=8`, plus the planned + current-actual options) bound to `actual_dish_id`; a free-text field that sets `actual_dish_name` (used when no dish_id); and a "didn't cook / ate out" checkbox → `cooked:false`. Prefill from existing `entries`. Footer: Cancel / Save. Save builds the `entries` array and `POST`s, then calls `onSaved(date, returnedEntries)` and closes.

```tsx
'use client'
import { useEffect, useState } from 'react'
import type { MealPlan, Slot } from '@/lib/meals/types'

type Draft = { slot: Slot; planned_dish_id: string | null; planned_dish_name: string | null
  actual_dish_id: string | null; actual_dish_name: string | null; cooked: boolean }

export default function CookLogSheet({ date, rows, entries, onClose, onSaved }: {
  date: string; rows: MealPlan[]; entries: Draft[]
  onClose: () => void; onSaved: (date: string, entries: unknown[]) => void
}) {
  const planned = rows.filter(r => r.dish_id && !r.skipped)
  const [drafts, setDrafts] = useState<Draft[]>(() => planned.map(r => {
    const prev = entries.find(e => e.slot === r.slot)
    return {
      slot: r.slot, planned_dish_id: r.dish_id, planned_dish_name: r.dish_name,
      actual_dish_id: prev?.actual_dish_id ?? r.dish_id,
      actual_dish_name: prev?.actual_dish_name ?? r.dish_name,
      cooked: prev ? prev.cooked : true,
    }
  }))
  const [pools, setPools] = useState<Record<string, { id: string; name: string }[]>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    planned.forEach(async r => {
      const res = await fetch(`/api/meals/reroll?plan_date=${date}&slot=${r.slot}&alternatives=8`)
      if (res.ok) { const { alternatives } = await res.json(); setPools(p => ({ ...p, [r.slot]: alternatives })) }
    })
  }, [date]) // eslint-disable-line react-hooks/exhaustive-deps

  function set(i: number, patch: Partial<Draft>) { setDrafts(d => d.map((x, idx) => idx === i ? { ...x, ...patch } : x)) }
  async function save() {
    setSaving(true)
    const res = await fetch('/api/meals/cook-log', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cook_date: date, entries: drafts }),
    })
    if (res.ok) { const { entries: saved } = await res.json(); onSaved(date, saved) }
    setSaving(false); onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-4 max-h-[85vh] overflow-y-auto">
        <h3 className="text-lg text-stone-900 mb-3" style={{ fontFamily: 'DM Serif Display, serif' }}>What did you cook?</h3>
        <div className="space-y-3">
          {drafts.map((d, i) => {
            const pool = pools[d.slot] ?? []
            const options = [
              ...(d.planned_dish_id ? [{ id: d.planned_dish_id, name: (d.planned_dish_name ?? '') + ' (planned)' }] : []),
              ...pool.filter(o => o.id !== d.planned_dish_id),
            ]
            return (
              <div key={d.slot} className={`border border-stone-200 rounded-xl p-2.5 ${!d.cooked ? 'opacity-60' : ''}`}>
                <div className="text-[10px] uppercase tracking-wide text-stone-400">{d.slot}</div>
                <select value={d.actual_dish_id ?? ''} disabled={!d.cooked}
                  onChange={e => { const id = e.target.value || null; const name = options.find(o => o.id === id)?.name.replace(' (planned)', '') ?? null; set(i, { actual_dish_id: id, actual_dish_name: name }) }}
                  className="w-full border border-stone-200 rounded-lg px-2 py-1.5 text-sm mt-1">
                  {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  <option value="">Other / free text…</option>
                </select>
                {!d.actual_dish_id && d.cooked && (
                  <input value={d.actual_dish_name ?? ''} onChange={e => set(i, { actual_dish_name: e.target.value })}
                    placeholder="What did you actually cook?" className="w-full border border-stone-200 rounded-lg px-2 py-1.5 text-sm mt-1.5" />
                )}
                <label className="flex items-center gap-2 text-xs text-stone-500 mt-2">
                  <input type="checkbox" checked={!d.cooked} onChange={e => set(i, { cooked: !e.target.checked })} />
                  Didn&apos;t cook / ate out
                </label>
              </div>
            )
          })}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-stone-500">Cancel</button>
          <button onClick={save} disabled={saving} className="px-4 py-1.5 rounded-lg bg-orange-600 text-white text-sm disabled:opacity-60">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Build check** → clean.

- [ ] **Step 5: Verify live** — one-tap "✓ Cooked" logs the day (badge appears); Edit opens the sheet, change one slot's actual + mark another "didn't cook", Save; reopen shows persisted state; reload page keeps it.

- [ ] **Step 6: Commit**

```bash
git add components/meals/CookLogSheet.tsx components/meals/PlanClient.tsx
git commit -m "feat(meals): cook tracking UI — mark cooked + edit actuals per day"
```

---

## Self-Review

- **Spec coverage:** #1 → Task 2. #2 → Tasks 8, 9. #3 → Tasks 1, 3, 4. #4a → Task 5. #4b → Task 6. #4c → Task 7. #4d → Tasks 6+7 (delete only `locked=false`; generate unchanged). ✅
- **Placeholders:** none — all steps carry real code or exact edits.
- **Type consistency:** `RecipeLink`/`detectSource` (Task 1) reused in Tasks 3/4; `scope:'day'` returns `{ day }` consumed by existing `replaceDay` (Task 6); `day-lock` optimistic via `onReplaceDay` (Task 7); cook-log `entries` shape shared across Tasks 8/9.
- **Final gate:** after Task 9, run full `npm test` + `npm run build`, then finishing-a-development-branch.
