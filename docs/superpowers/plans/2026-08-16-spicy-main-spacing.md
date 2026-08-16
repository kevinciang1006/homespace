# Spicy-Main Spacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two spicy utama (main) dishes never land on adjacent days (incl. across the week boundary); relaxable late; validated + reported.

**Architecture:** Add a hard rule `spicyMainSpacingOk` + `relax.spicyMainSpacing` flag to the TDD'd engine, a small spread weight, a ladder entry, and a `validateWeek` check. Routes/UI unchanged.

**Tech Stack:** Next.js 16.2.4, TypeScript, Supabase JS (anon), Vitest.

## Global Constraints

- Engine pure; TDD. `relax` boolean `false` = ENFORCED.
- Only the `utama` slot's `spicy` counts.
- Never relax no-repeat below 2 days / protein rotation except the existing last-resort fallback.

---

## Task 1: spicyMainSpacingOk + relax flag + ladder + soft weight

**Files:** `lib/meals/engine.ts`, `lib/meals/engine.test.ts`, `app/api/meals/reroll/route.ts`

- [ ] **Step 1: Extend the relax type + ENFORCED**

In `PickContext.relax`, add `spicyMainSpacing: boolean`:
```ts
  relax: { spicy: boolean; fried: boolean; hardDay: boolean; hardSpacing: boolean; proteinClash: boolean; spicyMainSpacing: boolean; noRepeatFactor: number }
```
In `ENFORCED`, add `spicyMainSpacing: false`:
```ts
export const ENFORCED: PickContext['relax'] =
  { spicy: false, fried: false, hardDay: false, hardSpacing: false, proteinClash: false, spicyMainSpacing: false, noRepeatFactor: 1 }
```

- [ ] **Step 2: Update the test `ctx()` helper relax default**

In `engine.test.ts`, the `ctx()` helper's `relax` fallback → add `spicyMainSpacing: false`.
Also update any explicit `relax: { … }` literals in existing tests (spicyOk, difficultyOk) to include
`spicyMainSpacing: false` (the compiler will flag them; add the field).

- [ ] **Step 3: Write failing tests**

Append a describe block:
```ts
import { spicyMainSpacingOk } from './engine'

describe('spicyMainSpacingOk (no consecutive spicy mains)', () => {
  it('blocks a spicy main when the previous day main is spicy', () => {
    const d = dish({ id: 'm', slot: 'utama', spicy: true })
    const c = ctx({ date: '2026-08-14', slot: 'utama', dishes: [d], role: 'main',
      runPicks: [pick({ plan_date: '2026-08-13', slot: 'utama', dish_id: 'y', role: 'main' })] })
    c.dishById.set('y', dish({ id: 'y', slot: 'utama', spicy: true }))
    expect(spicyMainSpacingOk(d, c)).toBe(false)
  })
  it('blocks across the week boundary via priorPlans', () => {
    const d = dish({ id: 'm', slot: 'utama', spicy: true })
    const c = ctx({ date: '2026-08-17', slot: 'utama', dishes: [d], role: 'main',
      priorPlans: [plan({ plan_date: '2026-08-16', slot: 'utama', dish_id: 'y' })] })
    c.dishById.set('y', dish({ id: 'y', slot: 'utama', spicy: true }))
    expect(spicyMainSpacingOk(d, c)).toBe(false)
  })
  it('allows a spicy main next to a spicy SAYURAN (only mains count)', () => {
    const d = dish({ id: 'm', slot: 'utama', spicy: true })
    const c = ctx({ date: '2026-08-14', slot: 'utama', dishes: [d], role: 'main',
      runPicks: [pick({ plan_date: '2026-08-13', slot: 'sayuran', dish_id: 'v' })] })
    c.dishById.set('v', dish({ id: 'v', slot: 'sayuran', spicy: true }))
    expect(spicyMainSpacingOk(d, c)).toBe(true)
  })
  it('allows a non-spicy main, and any non-utama dish', () => {
    const nm = dish({ id: 'n', slot: 'utama', spicy: false })
    const side = dish({ id: 's', slot: 'sayuran', spicy: true })
    const c = ctx({ date: '2026-08-14', slot: 'utama', dishes: [nm, side], role: 'main',
      runPicks: [pick({ plan_date: '2026-08-13', slot: 'utama', dish_id: 'y' })] })
    c.dishById.set('y', dish({ id: 'y', slot: 'utama', spicy: true }))
    expect(spicyMainSpacingOk(nm, c)).toBe(true)
    expect(spicyMainSpacingOk(side, { ...c, slot: 'sayuran' })).toBe(true)
  })
  it('is relaxable via relax.spicyMainSpacing', () => {
    const d = dish({ id: 'm', slot: 'utama', spicy: true })
    const c = ctx({ date: '2026-08-14', slot: 'utama', dishes: [d], role: 'main',
      relax: { spicy: false, fried: false, hardDay: false, hardSpacing: false, proteinClash: false, spicyMainSpacing: true, noRepeatFactor: 1 },
      runPicks: [pick({ plan_date: '2026-08-13', slot: 'utama', dish_id: 'y' })] })
    c.dishById.set('y', dish({ id: 'y', slot: 'utama', spicy: true }))
    expect(spicyMainSpacingOk(d, c)).toBe(true)
  })
})
```

- [ ] **Step 4: Run → FAIL** (`npm test -- engine`).

- [ ] **Step 5: Implement the rule + wire into passesHardRules**

Add near `difficultyOk`:
```ts
export function spicyMainSpacingOk(dish: Dish, ctx: PickContext): boolean {
  if (ctx.relax.spicyMainSpacing) return true
  if (ctx.slot !== 'utama' || !dish.spicy) return true
  for (const ad of [prevDay(ctx.date), nextDay(ctx.date)]) {
    const adjSpicyMain = [...ctx.runPicks, ...ctx.priorPlans].some(
      p => p.plan_date === ad && p.slot === 'utama' && resolveDish(ctx, p.dish_id)?.spicy)
    if (adjSpicyMain) return false
  }
  return true
}
```
Add `spicyMainSpacingOk(dish, ctx) &&` to `passesHardRules` (after `difficultyOk`).

- [ ] **Step 6: Add the soft spread weight**

Add:
```ts
function spicySpreadFactor(dish: Dish, ctx: PickContext): number {
  if (ctx.role !== 'main' || !dish.spicy) return 1
  const neighborSpicy = [prevDay(ctx.date), nextDay(ctx.date)].some(ad =>
    [...ctx.runPicks, ...ctx.priorPlans].some(
      p => p.plan_date === ad && p.slot === 'utama' && resolveDish(ctx, p.dish_id)?.spicy))
  return neighborSpicy ? 0.5 : 1
}
```
And multiply it into `weightFor`:
```ts
export function weightFor(dish: Dish, ctx: PickContext): number {
  return dish.rating * dish.rating * freshnessFactor(dish, ctx) * saltMainFactor(dish, ctx) * spicySpreadFactor(dish, ctx)
}
```

- [ ] **Step 7: Add to the relaxation ladder + last-resort**

Rebuild `RELAX_LADDER` inserting `spicyMainSpacing` after `proteinClash`, before no-repeat:
```ts
const RELAX_LADDER: { relax: PickContext['relax']; note?: string }[] = [
  { relax: { ...ENFORCED } },
  { relax: { ...ENFORCED, hardSpacing: true }, note: 'relaxed: hard-day spacing' },
  { relax: { ...ENFORCED, hardSpacing: true, hardDay: true }, note: 'relaxed: hard-day restriction' },
  { relax: { ...ENFORCED, hardSpacing: true, hardDay: true, spicy: true }, note: 'relaxed: + spicy floor' },
  { relax: { ...ENFORCED, hardSpacing: true, hardDay: true, spicy: true, fried: true }, note: 'relaxed: + fried cap' },
  { relax: { ...ENFORCED, hardSpacing: true, hardDay: true, spicy: true, fried: true, proteinClash: true }, note: 'relaxed: + protein variety' },
  { relax: { ...ENFORCED, hardSpacing: true, hardDay: true, spicy: true, fried: true, proteinClash: true, spicyMainSpacing: true }, note: 'relaxed: + spicy-main spacing' },
  { relax: { spicy: true, fried: true, hardDay: true, hardSpacing: true, proteinClash: true, spicyMainSpacing: true, noRepeatFactor: 0.5 }, note: 'relaxed: + short no-repeat' },
]
```
Update the `pickForSlot` last-resort `lastCtx.relax` literal to include `spicyMainSpacing: true`.

- [ ] **Step 8: Update the reroll route relax literal**

In `app/api/meals/reroll/route.ts` `buildSingleContext`, add `spicyMainSpacing: false` to the inline
`relax` object.

- [ ] **Step 9: Run → PASS** (`npm test -- engine`, then `npm test`).

- [ ] **Step 10: Commit**

```bash
git add lib/meals/engine.ts lib/meals/engine.test.ts app/api/meals/reroll/route.ts
git commit -m "feat(meals): no consecutive spicy mains (hard rule, late-relaxable, spread weight)"
```

---

## Task 2: validateWeek — adjacent spicy mains

**Files:** `lib/meals/engine.ts`, `lib/meals/engine.test.ts`

- [ ] **Step 1: Failing test**

Append to the `validateWeek` describe:
```ts
  it('flags two spicy mains on adjacent days', () => {
    const byId = new Map<string, Dish>([
      ['a', dish({ id: 'a', slot: 'utama', name: 'Ayam pedas', spicy: true })],
      ['b', dish({ id: 'b', slot: 'utama', name: 'Ikan cabe', spicy: true })],
    ])
    const rows = [
      { plan_date: '2026-08-13', dish_id: 'a' },
      { plan_date: '2026-08-14', dish_id: 'b' },
    ]
    const report = validateWeek(rows, byId)
    expect(report.some(v => v.includes('spicy mains adjacent'))).toBe(true)
  })
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Extend validateWeek**

After the per-day loop, before/after the hard/special adjacency block, add:
```ts
  const spicyMainDates = dates.filter(date => byDate.get(date)!.some(d => d.slot === 'utama' && d.spicy))
  for (let i = 0; i < spicyMainDates.length; i++) {
    for (let j = i + 1; j < spicyMainDates.length; j++) {
      if (Math.abs(daysBetween(spicyMainDates[i], spicyMainDates[j])) === 1) {
        viol.push(`⚠️ ${spicyMainDates[i]}-${spicyMainDates[j]}: two spicy mains adjacent — pool constraint`)
      }
    }
  }
```

- [ ] **Step 4: Run → PASS** (`npm test`).

- [ ] **Step 5: Commit**

```bash
git add lib/meals/engine.ts lib/meals/engine.test.ts
git commit -m "feat(meals): validateWeek flags adjacent spicy mains"
```

---

## Task 3: Verification + build + report

- [ ] **Step 1: Unit tests** — `npm test`; all green.
- [ ] **Step 2: Build** — `npm run build`; no type errors.
- [ ] **Step 3: Validation report** — start dev; generate several fresh weeks; capture the `[meal-gen]`
  dev log. Expect `validation: clean ✓` (or, on a genuinely spicy-constrained week, only the adjacent
  spicy-mains pool-constraint warning). Independently DB-scan a week: confirm no two adjacent days both
  have a spicy utama (or the relaxation is the sole documented reason).
- [ ] **Step 4: Commit any fixes.**

---

## Self-Review Notes (for the planner, not a task)

- **Spec coverage:** rule (T1 S5), relax flag + ladder placement (T1 S1/S7), soft weight (T1 S6),
  cross-boundary via priorPlans (T1 S5), validateWeek (T2), report (T3). ✅
- **Relax literal churn:** the new `spicyMainSpacing` field must be added at ENFORCED, ladder (spread
  levels auto-inherit; explicit last two get it), last-resort, reroll `buildSingleContext`, test `ctx()`
  helper, and explicit test relax literals — compiler-guided.
- **Soft-vs-hard overlap:** the hard rule blocks true adjacency; the ×0.5 spread weight mostly matters as
  a tiebreaker under relaxation. Kept intentionally light per the spec.
