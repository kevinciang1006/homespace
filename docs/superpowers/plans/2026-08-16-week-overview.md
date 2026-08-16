# Week Overview Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A friendly collapsible "Week Overview" panel at the top of the plan view summarizing the displayed week's balance, computed client-side.

**Architecture:** A pure `lib/meals/overview.ts` (unit-tested) turns the week's `MealPlan` rows into human signals + a verdict; a `WeekOverview` component renders it; PlanClient computes it via `useMemo(week)`. The dish join gains 3 fields.

**Tech Stack:** Next.js 16.2.4, TypeScript, Tailwind v4, lucide-react, Vitest.

## Global Constraints

- Informative, never error-styled: green/stone/amber only — **no red**.
- Pure computation module (no React/Supabase imports); component presentational.
- No new API calls — read PlanClient's existing `week` state.
- Match design (stone/orange, DM Serif headings, rounded-2xl). Mobile-first collapsible.

---

## Task 1: Data wiring (join + type)

**Files:** `lib/meals/types.ts`, `app/meals/page.tsx`, `app/api/meals/week/route.ts`, `app/api/meals/generate/route.ts`, `app/api/meals/reroll/route.ts`

- [ ] **Step 1: Extend the type**

In `lib/meals/types.ts`, `MealPlan.dishes`:
```ts
  dishes?: { tier: Tier; spicy: boolean; richness: Richness; provides_soup: boolean; recipe_image_url: string | null; protein: string; saltiness: Saltiness; difficulty: Difficulty; method: string | null } | null
```

- [ ] **Step 2: Extend all four joins**

Change `dishes(tier, spicy, richness, provides_soup, recipe_image_url, protein)` →
`dishes(tier, spicy, richness, provides_soup, recipe_image_url, protein, saltiness, difficulty, method)`
in: `app/meals/page.tsx`, `app/api/meals/week/route.ts`, `app/api/meals/generate/route.ts` (final select),
and the `SELECT` const in `app/api/meals/reroll/route.ts`.

- [ ] **Step 3: Typecheck**

Run: `npm run build` → compiles.

- [ ] **Step 4: Commit**

```bash
git add lib/meals/types.ts app/meals/page.tsx app/api/meals/week/route.ts app/api/meals/generate/route.ts app/api/meals/reroll/route.ts
git commit -m "feat(meals): join saltiness/difficulty/method for the week overview"
```

---

## Task 2: overview.ts + tests

**Files:** `lib/meals/overview.ts`, `lib/meals/overview.test.ts`

**Interfaces:** `SignalStatus`, `Signal`, `WeekOverview`, `computeWeekOverview(rows: MealPlan[]): WeekOverview`.

- [ ] **Step 1: Write failing tests**

```ts
// lib/meals/overview.test.ts
import { describe, it, expect } from 'vitest'
import type { MealPlan } from './types'
import { computeWeekOverview } from './overview'

type DishMeta = NonNullable<MealPlan['dishes']>
function meta(o: Partial<DishMeta> = {}): DishMeta {
  return { tier: 'everyday', spicy: false, richness: 'medium', provides_soup: false,
    recipe_image_url: null, protein: 'chicken', saltiness: 'normal', difficulty: 'medium', method: null, ...o }
}
function row(o: Partial<MealPlan> & { plan_date: string; slot: MealPlan['slot'] }): MealPlan {
  return { id: 'r-' + Math.random(), dish_id: 'd-' + Math.random(), dish_name: 'X',
    locked: false, role: 'support', skipped: false, dishes: meta(), ...o } as MealPlan
}
function mainRow(date: string, o: Partial<DishMeta>): MealPlan {
  return row({ plan_date: date, slot: 'utama', role: 'main', dishes: meta(o) })
}
const D = ['2026-08-10','2026-08-11','2026-08-12','2026-08-13','2026-08-14','2026-08-15','2026-08-16']

describe('computeWeekOverview', () => {
  it('reports no plan for an empty week', () => {
    const o = computeWeekOverview([])
    expect(o.hasPlan).toBe(false)
    expect(o.verdict).toMatch(/No plan/i)
    expect(o.signals).toEqual([])
  })
  it('flags spicy mains on adjacent days as heads-up', () => {
    const rows = [mainRow('2026-08-13', { spicy: true }), mainRow('2026-08-14', { spicy: true, protein: 'fish' })]
    const o = computeWeekOverview(rows)
    const spicy = o.signals.find(s => s.emoji === '🌶️')!
    expect(spicy.status).toBe('headsup')
  })
  it('marks two special mains as good', () => {
    const rows = [mainRow('2026-08-11', { tier: 'special' }), mainRow('2026-08-14', { tier: 'special', protein: 'fish' })]
    const o = computeWeekOverview(rows)
    expect(o.signals.find(s => s.emoji === '⭐')!.status).toBe('good')
  })
  it('flags a day with two salty dishes', () => {
    const rows = [mainRow('2026-08-11', { saltiness: 'salty' }), row({ plan_date: '2026-08-11', slot: 'sayuran', dishes: meta({ saltiness: 'very_salty', protein: 'none' }) })]
    const o = computeWeekOverview(rows)
    expect(o.signals.find(s => s.emoji === '🧂')!.status).toBe('headsup')
  })
  it('flags two same-protein mains on consecutive days', () => {
    const rows = [mainRow('2026-08-15', { protein: 'fish' }), mainRow('2026-08-16', { protein: 'fish' })]
    const o = computeWeekOverview(rows)
    expect(o.signals.find(s => s.emoji === '🥩')!.status).toBe('headsup')
  })
  it('always includes the calories placeholder', () => {
    const o = computeWeekOverview([mainRow('2026-08-11', {})])
    expect(o.signals.find(s => s.emoji === '🍚')!.detail).toMatch(/coming soon/i)
  })
  it('calls a spicy-heavy week a Spicy week', () => {
    const rows = ['2026-08-10','2026-08-12','2026-08-14'].map((d, i) => mainRow(d, { spicy: true, protein: ['fish','beef','chicken'][i] }))
    expect(computeWeekOverview(rows).verdict).toMatch(/Spicy week/)
  })
  it('calls a mild easy week a Light & easy week', () => {
    const rows = D.slice(0, 5).map((d, i) => mainRow(d, { difficulty: 'easy', spicy: false, protein: ['fish','beef','chicken','egg','duck'][i] }))
    expect(computeWeekOverview(rows).verdict).toMatch(/Light & easy/)
  })
})
```

- [ ] **Step 2: Run → FAIL** (no `./overview`).

- [ ] **Step 3: Implement overview.ts**

```ts
// lib/meals/overview.ts
import type { MealPlan } from './types'
import { daysBetween } from './dates'

export type SignalStatus = 'good' | 'neutral' | 'headsup'
export type Signal = { emoji: string; label: string; detail: string; status: SignalStatus }
export type WeekOverview = { hasPlan: boolean; verdict: string; summary: string; signals: Signal[] }

function dayName(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short' })
}
function anyAdjacent(dates: string[]): boolean {
  const s = [...dates].sort()
  return s.some((a, i) => s.some((b, j) => i < j && Math.abs(daysBetween(a, b)) === 1))
}
function list(dates: string[]): string { return dates.map(dayName).join(' & ') }

export function computeWeekOverview(rows: MealPlan[]): WeekOverview {
  const planned = rows.filter(r => r.dish_id && !r.skipped)
  if (planned.length === 0) {
    return { hasPlan: false, verdict: 'No plan yet', summary: 'Hit Generate Week to fill this week.', signals: [] }
  }
  const mains = planned.filter(r => r.role === 'main')
  const dates = [...new Set(planned.map(r => r.plan_date))].sort()

  // 1. Spicy mains
  const spicyDates = mains.filter(m => m.dishes?.spicy).map(m => m.plan_date)
  const spicyAdj = anyAdjacent(spicyDates)
  const spicy: Signal = {
    emoji: '🌶️', label: 'Spicy days',
    detail: spicyDates.length === 0 ? 'No spicy mains this week'
      : spicyAdj ? `${spicyDates.length} spicy mains — back-to-back (${list(spicyDates)})`
      : `${spicyDates.length} spicy main${spicyDates.length > 1 ? 's' : ''}, nicely spread (${list(spicyDates)})`,
    status: spicyAdj ? 'headsup' : spicyDates.length >= 3 ? 'neutral' : 'good',
  }

  // 2. Specials
  const specialDates = mains.filter(m => m.dishes?.tier === 'special').map(m => m.plan_date)
  const special: Signal = {
    emoji: '⭐', label: 'Special meals',
    detail: specialDates.length === 0 ? 'No special meals' : `${specialDates.length} special meal${specialDates.length > 1 ? 's' : ''} — ${list(specialDates)}${specialDates.length === 2 ? ' 👌' : ''}`,
    status: specialDates.length === 2 ? 'good' : 'neutral',
  }

  // 3. Difficulty
  const hardDates = dates.filter(d => planned.some(r => r.plan_date === d && r.dishes?.difficulty === 'hard'))
  const difficulty: Signal = {
    emoji: '🔥', label: 'Difficulty',
    detail: hardDates.length === 0 ? 'Easy week — no hard cooks'
      : `${hardDates.length} hard cook${hardDates.length > 1 ? 's' : ''}${hardDates.length > 1 && !anyAdjacent(hardDates) ? ', spread out' : ''} (${list(hardDates)})`,
    status: 'good',
  }

  // 4. Saltiness
  const saltyByDay = dates.map(d => planned.filter(r => r.plan_date === d && r.dishes && r.dishes.saltiness !== 'normal').length)
  const doubleSalty = dates.filter((d, i) => saltyByDay[i] >= 2)
  const saltiness: Signal = {
    emoji: '🧂', label: 'Saltiness',
    detail: doubleSalty.length ? `${dayName(doubleSalty[0])} has ${saltyByDay[dates.indexOf(doubleSalty[0])]} salty dishes` : 'Saltiness balanced',
    status: doubleSalty.length ? 'headsup' : 'good',
  }

  // 5. Fried
  const friedTotal = planned.filter(r => r.dishes?.method === 'fried').length
  const heavyFriedDay = dates.find(d => planned.filter(r => r.plan_date === d && r.dishes?.method === 'fried').length >= 2)
  const fried: Signal = {
    emoji: '🍳', label: 'Fried',
    detail: `${friedTotal} fried dish${friedTotal === 1 ? '' : 'es'} this week${heavyFriedDay ? ` — ${dayName(heavyFriedDay)} is a bit fry-heavy` : ''}`,
    status: heavyFriedDay ? 'headsup' : 'neutral',
  }

  // 6. Protein variety (mains)
  const mainByDate = dates.map(d => mains.find(m => m.plan_date === d)?.dishes?.protein).filter(Boolean) as string[]
  const distinct = new Set(mainByDate).size
  const sortedMainDates = mains.map(m => m.plan_date).sort()
  const clashPair = sortedMainDates.find((d, i) => i > 0 && Math.abs(daysBetween(sortedMainDates[i - 1], d)) === 1 &&
    mains.find(m => m.plan_date === d)?.dishes?.protein === mains.find(m => m.plan_date === sortedMainDates[i - 1])?.dishes?.protein &&
    mains.find(m => m.plan_date === d)?.dishes?.protein)
  const protein: Signal = {
    emoji: '🥩', label: 'Protein variety',
    detail: clashPair
      ? `${mains.find(m => m.plan_date === clashPair)?.dishes?.protein} two days running`
      : `${distinct} different protein${distinct > 1 ? 's' : ''} — great variety`,
    status: clashPair ? 'headsup' : 'good',
  }

  // 7. Soup coverage
  const soupDates = dates.filter(d => planned.some(r => r.plan_date === d && ((r.slot === 'kuah' && r.dish_id) || (r.role === 'main' && r.dishes?.provides_soup))))
  const soup: Signal = {
    emoji: '🥣', label: 'Soup coverage',
    detail: `${soupDates.length} of ${dates.length} days have soup`,
    status: 'neutral',
  }

  // 8. Placeholder
  const calories: Signal = { emoji: '🍚', label: 'Portions & calories', detail: 'coming soon', status: 'neutral' }

  // Verdict
  const spicyDays = spicyDates.length, specialCount = specialDates.length, hardCount = hardDates.length
  let verdict: string
  if (spicyDays >= 3) verdict = 'Spicy week 🌶️'
  else if ((specialCount >= 2 && (hardCount >= 2 || friedTotal >= 6)) || friedTotal >= 7) verdict = 'Hearty week 🍖'
  else if (hardCount <= 1 && friedTotal <= 3 && spicyDays <= 1) verdict = 'Light & easy week 🥗'
  else verdict = 'Balanced week 🌿'

  const bits: string[] = []
  if (specialCount) bits.push(`${specialCount} special`)
  if (hardCount) bits.push(`${hardCount} hard cook${hardCount > 1 ? 's' : ''}`)
  if (spicyDays) bits.push(`${spicyDays} spicy`)
  const summary = bits.length ? bits.join(' · ') : 'An easy, mild week'

  return { hasPlan: true, verdict, summary, signals: [spicy, special, difficulty, saltiness, fried, protein, soup, calories] }
}
```

- [ ] **Step 4: Run → PASS** (`npm test -- overview`, then `npm test`).

- [ ] **Step 5: Commit**

```bash
git add lib/meals/overview.ts lib/meals/overview.test.ts
git commit -m "feat(meals): add computeWeekOverview (week balance signals + verdict)"
```

---

## Task 3: WeekOverview component + wire into PlanClient

**Files:** `components/meals/WeekOverview.tsx`, `components/meals/PlanClient.tsx`

- [ ] **Step 1: Create the component**

```tsx
// components/meals/WeekOverview.tsx
'use client'
import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { WeekOverview as Overview, SignalStatus } from '@/lib/meals/overview'

const DOT: Record<SignalStatus, string> = { good: 'text-green-600', neutral: 'text-stone-400', headsup: 'text-amber-600' }

export default function WeekOverview({ overview }: { overview: Overview }) {
  const [expanded, setExpanded] = useState(false)

  if (!overview.hasPlan) {
    return (
      <div className="bg-white border border-stone-200 rounded-2xl px-4 py-3 mb-4 text-sm text-stone-500">
        {overview.verdict} — {overview.summary}
      </div>
    )
  }

  return (
    <div className="bg-white border border-stone-200 rounded-2xl p-4 mb-4">
      <button onClick={() => setExpanded(e => !e)} className="w-full flex items-center justify-between sm:cursor-default text-left">
        <div className="min-w-0">
          <div className="text-lg text-stone-900 leading-tight" style={{ fontFamily: 'DM Serif Display, serif' }}>{overview.verdict}</div>
          <div className="text-xs text-stone-500 mt-0.5 truncate">{overview.summary}</div>
        </div>
        <span className="sm:hidden text-stone-400 shrink-0 ml-2">{expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</span>
      </button>

      <div className={`${expanded ? 'grid' : 'hidden'} sm:grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-5 gap-y-2.5 mt-3 pt-3 border-t border-stone-100`}>
        {overview.signals.map(s => (
          <div key={s.label} className="flex items-start gap-2">
            <span className="text-base leading-none mt-0.5">{s.emoji}</span>
            <div className="min-w-0">
              <div className={`text-xs font-medium ${DOT[s.status]}`}>{s.label}</div>
              <div className="text-[11px] text-stone-500 leading-snug">{s.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire into PlanClient**

In `components/meals/PlanClient.tsx`:
- import: `import WeekOverview from './WeekOverview'` and `import { computeWeekOverview } from '@/lib/meals/overview'`.
- add `const overview = useMemo(() => computeWeekOverview(week), [week])` (near `days`).
- render `<WeekOverview overview={overview} />` immediately before the `<div className="grid grid-cols-1 gap-4 …">`.

- [ ] **Step 3: Build**

Run: `npm run build` → compiles.

- [ ] **Step 4: Commit**

```bash
git add components/meals/WeekOverview.tsx components/meals/PlanClient.tsx
git commit -m "feat(meals): add Week Overview panel to the plan view"
```

---

## Task 4: Verify (desktop + mobile)

- [ ] **Step 1: Unit tests** — `npm test`; all green.
- [ ] **Step 2: Visual** — dev; `/meals`. Verify: panel between week bar and day cards shows a verdict +
  signals; colors are green/stone/amber (no red); switching weeks / regenerating updates it; an unplanned
  week shows "No plan yet — hit Generate Week". Mobile (narrow): collapsed shows verdict + summary + chevron;
  tap expands the signals.
- [ ] **Step 3: Commit any fixes.**

---

## Self-Review Notes (for the planner, not a task)

- **Spec coverage:** wiring (T1), 8 signals + verdict (T2), collapsible panel + PlanClient hook (T3), verify (T4). ✅
- **Pure module** — no React/Supabase in `overview.ts`; component is presentational; recompute via `useMemo(week)`.
- **Never red** — DOT map uses green/stone/amber only.
- **Recompute triggers:** `week` state changes on loadWeek/generate/reroll → `useMemo` re-runs.
