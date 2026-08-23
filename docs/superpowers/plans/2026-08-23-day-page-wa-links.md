# Per-Day Meal Page + WhatsApp Deep Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only per-day meal page at `/meals/day/[date]` with a "Preparation" section, and updated WhatsApp messages (flat shopping list, deep links to the shopping page / the new day page) that link into it.

**Architecture:** One new pure lib module (`lib/meals/prep.ts`) becomes the shared prep-grouping/phrasing logic used by both the new day page and the (refactored, behavior-unchanged) WA cron route. Everything else is additive: a new route + component, two tiny URL helpers, and targeted edits to the two already-tested message composer functions.

**Tech Stack:** Next.js App Router (Server Components), `@supabase/supabase-js`, vitest, Tailwind (matching existing `components/meals/*` styling).

**Spec:** `docs/superpowers/specs/2026-08-23-day-page-wa-links-design.md`

## Global Constraints

- The day page (`/meals/day/[date]`) is read-only — no lock/reroll/mark-cooked
  controls. It lives under `app/meals/` so it inherits the existing
  `app/meals/layout.tsx` header/nav and the existing session-auth
  protection — no `proxy.ts` changes.
- Cron scheduling, dedupe, `wa_settings`, and test-mode mechanics are
  unchanged — only the two message bodies' text/links, plus one internal
  refactor (`buildPrepBatches` → `groupPrepByDate`).
- The exact shopping-message wording (from Kevin's example) must match:
  `🛒 Belanja minggu ini:` / `Makasih ya 🧡` — a flat list, no
  `*Protein*`/`*Sayur*`/`*Bumbu*` headers, still internally sorted
  protein → veg → bumbu → other.
- `composeDailyReminderMessage`/`composePrepThawMessage` content is
  otherwise unchanged — only their trailing link changes.
- `lib/wa/messages.ts` and `lib/wa/schedule.ts` are both covered by
  `vitest.config.ts`'s `lib/**/*.test.ts` glob and must keep passing.
  Route/page files are verified manually (curl + DB reads + typecheck),
  matching this repo's existing convention.

---

### Task 1: Move `prepDateFor` from `lib/wa/schedule.ts` to `lib/meals/dates.ts`

**Files:**
- Modify: `lib/meals/dates.ts`
- Modify: `lib/meals/dates.test.ts`
- Modify: `lib/wa/schedule.ts`
- Modify: `lib/wa/schedule.test.ts`
- Modify: `app/api/wa/cron/route.ts`

**Interfaces:**
- Produces: `prepDateFor(cookDate: string, prepLeadDays: number | null): string` now lives in `lib/meals/dates.ts` (same signature/behavior as before — it's a pure relocation).

- [ ] **Step 1: Add `prepDateFor` to `lib/meals/dates.ts`**

Append to the end of the file:

```ts
// A thaw/marinate dish always gets at least one evening's notice.
export function prepDateFor(cookDate: string, prepLeadDays: number | null): string {
  const lead = Math.max(prepLeadDays ?? 1, 1)
  return shiftWeek(cookDate, -lead)
}
```

- [ ] **Step 2: Move its tests to `lib/meals/dates.test.ts`**

Append to the end of the file (add `prepDateFor` to the existing `import` line at the top too):

```ts
describe('prepDateFor', () => {
  it('subtracts the given lead days', () => {
    expect(prepDateFor('2026-08-27', 3)).toBe('2026-08-24')
  })
  it('floors a null lead to 1 day', () => {
    expect(prepDateFor('2026-08-27', null)).toBe('2026-08-26')
  })
  it('floors a 0 lead to 1 day', () => {
    expect(prepDateFor('2026-08-27', 0)).toBe('2026-08-26')
  })
})
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx vitest run lib/meals/dates.test.ts`
Expected: PASS (all cases, including the 3 new ones).

- [ ] **Step 4: Remove `prepDateFor` from `lib/wa/schedule.ts`**

Delete this function (nothing else in the file calls it):

```ts
// A thaw/marinate dish always gets at least one evening's notice.
export function prepDateFor(cookDate: string, prepLeadDays: number | null): string {
  const lead = Math.max(prepLeadDays ?? 1, 1)
  return shiftWeek(cookDate, -lead)
}
```

- [ ] **Step 5: Remove its tests from `lib/wa/schedule.test.ts`**

Delete the `prepDateFor` import from the top `import { ... } from './schedule'` line, and delete this block:

```ts
describe('prepDateFor', () => {
  it('subtracts the given lead days', () => {
    expect(prepDateFor('2026-08-27', 3)).toBe('2026-08-24')
  })
  it('floors a null lead to 1 day', () => {
    expect(prepDateFor('2026-08-27', null)).toBe('2026-08-26')
  })
  it('floors a 0 lead to 1 day', () => {
    expect(prepDateFor('2026-08-27', 0)).toBe('2026-08-26')
  })
})
```

- [ ] **Step 6: Run tests to verify `lib/wa/schedule.test.ts` still passes**

Run: `npx vitest run lib/wa/schedule.test.ts`
Expected: PASS (10 remaining cases — the 3 `prepDateFor` cases are gone, now covered by Step 3 instead).

- [ ] **Step 7: Fix the now-broken import in the cron route**

In `app/api/wa/cron/route.ts`, change:

```ts
import {
  jakartaToday, upcomingSaturday, targetWeekStart, tomorrowOf, prepDateFor, jakartaDateTimeToUtcIso,
} from '@/lib/wa/schedule'
```

to:

```ts
import {
  jakartaToday, upcomingSaturday, targetWeekStart, tomorrowOf, jakartaDateTimeToUtcIso,
} from '@/lib/wa/schedule'
import { prepDateFor } from '@/lib/meals/dates'
```

(`buildPrepBatches`'s call to `prepDateFor(row.plan_date, dish.prep_lead_days)` is unchanged — only the import source moves. Task 9 later removes this import entirely once `buildPrepBatches` is refactored to use `groupPrepByDate`.)

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add lib/meals/dates.ts lib/meals/dates.test.ts lib/wa/schedule.ts lib/wa/schedule.test.ts app/api/wa/cron/route.ts
git commit -m "refactor(wa): move prepDateFor into lib/meals/dates (meal-domain math)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `lib/meals/prep.ts` — shared prep grouping + phrasing

**Files:**
- Create: `lib/meals/prep.ts`
- Test: `lib/meals/prep.test.ts`

**Interfaces:**
- Consumes: `prepDateFor(cookDate: string, prepLeadDays: number | null): string` from `./dates`.
- Produces: types `PrepCandidate`, `PrepItem`; functions `groupPrepByDate(rows: PrepCandidate[]): Map<string, PrepItem[]>`, `prepPhrase(item: { needs_thaw: boolean; needs_marinate: boolean; prep_note: string | null }): string`. Consumed by Task 9 (cron route refactor) and Task 11 (day page).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { groupPrepByDate, prepPhrase, type PrepCandidate } from './prep'

function candidate(over: Partial<PrepCandidate> & Pick<PrepCandidate, 'dish_id' | 'dish_name' | 'cook_date'>): PrepCandidate {
  return { needs_thaw: false, needs_marinate: false, prep_lead_days: null, prep_note: null, ...over }
}

describe('groupPrepByDate', () => {
  it('groups a dish under its computed prep date', () => {
    const rows = [candidate({ dish_id: '1', dish_name: 'Ayam', cook_date: '2026-08-24', needs_thaw: true, prep_lead_days: 1 })]
    const batches = groupPrepByDate(rows)
    expect(batches.get('2026-08-23')).toEqual([
      { dish_id: '1', dish_name: 'Ayam', cook_date: '2026-08-24', needs_thaw: true, needs_marinate: false, prep_note: null },
    ])
  })

  it('batches multiple dishes sharing the same computed prep date', () => {
    const rows = [
      candidate({ dish_id: '1', dish_name: 'Ayam', cook_date: '2026-08-25', needs_thaw: true, prep_lead_days: 1 }),
      candidate({ dish_id: '2', dish_name: 'Ikan', cook_date: '2026-08-25', needs_marinate: true, prep_lead_days: 1 }),
    ]
    expect(groupPrepByDate(rows).get('2026-08-24')).toHaveLength(2)
  })

  it('keeps dishes with different lead times in separate buckets', () => {
    const rows = [
      candidate({ dish_id: '1', dish_name: 'Ayam', cook_date: '2026-08-24', needs_thaw: true, prep_lead_days: 1 }),
      candidate({ dish_id: '2', dish_name: 'Babi', cook_date: '2026-08-27', needs_marinate: true, prep_lead_days: 3 }),
    ]
    const batches = groupPrepByDate(rows)
    expect(batches.get('2026-08-23')).toHaveLength(1)
    expect(batches.get('2026-08-24')).toHaveLength(1)
  })

  it('drops dishes needing neither thaw nor marinate', () => {
    const rows = [candidate({ dish_id: '1', dish_name: 'Nasi', cook_date: '2026-08-24' })]
    expect(groupPrepByDate(rows).size).toBe(0)
  })
})

describe('prepPhrase', () => {
  it('prefers prep_note when present', () => {
    expect(prepPhrase({ needs_thaw: true, needs_marinate: true, prep_note: 'tahan seminggu' })).toBe('tahan seminggu')
  })
  it('derives "thaw + marinate" when both flags are set', () => {
    expect(prepPhrase({ needs_thaw: true, needs_marinate: true, prep_note: null })).toBe('thaw + marinate')
  })
  it('derives "thaw" alone', () => {
    expect(prepPhrase({ needs_thaw: true, needs_marinate: false, prep_note: null })).toBe('thaw')
  })
  it('derives "marinate" alone', () => {
    expect(prepPhrase({ needs_thaw: false, needs_marinate: true, prep_note: null })).toBe('marinate')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/meals/prep.test.ts`
Expected: FAIL — `Cannot find module './prep'`.

- [ ] **Step 3: Write the implementation**

```ts
import { prepDateFor } from './dates'

export type PrepCandidate = {
  dish_id: string
  dish_name: string
  cook_date: string
  needs_thaw: boolean
  needs_marinate: boolean
  prep_lead_days: number | null
  prep_note: string | null
}

export type PrepItem = Omit<PrepCandidate, 'prep_lead_days'>

// Groups dishes that need thaw/marinate by the evening they should be
// prepped (cook_date - lead days). Dishes needing neither are dropped.
// Shared by the day page (Part A) and the WA cron route's buildPrepBatches
// (Part B) — the single source of truth for this grouping.
export function groupPrepByDate(rows: PrepCandidate[]): Map<string, PrepItem[]> {
  const batches = new Map<string, PrepItem[]>()
  for (const row of rows) {
    if (!row.needs_thaw && !row.needs_marinate) continue
    const prepDate = prepDateFor(row.cook_date, row.prep_lead_days)
    const item: PrepItem = {
      dish_id: row.dish_id, dish_name: row.dish_name, cook_date: row.cook_date,
      needs_thaw: row.needs_thaw, needs_marinate: row.needs_marinate, prep_note: row.prep_note,
    }
    const list = batches.get(prepDate) ?? []
    list.push(item)
    batches.set(prepDate, list)
  }
  return batches
}

// Same "thaw + marinate / thaw / marinate / prep_note override" phrase used
// by the WhatsApp prep/thaw message (lib/wa/messages.ts composePrepThawMessage).
// Deliberately duplicated rather than shared, so that tested, already-shipped
// message-composition code is never touched by this feature.
export function prepPhrase(item: { needs_thaw: boolean; needs_marinate: boolean; prep_note: string | null }): string {
  return item.prep_note?.trim()
    || (item.needs_thaw && item.needs_marinate ? 'thaw + marinate'
      : item.needs_thaw ? 'thaw'
      : item.needs_marinate ? 'marinate' : 'siapkan')
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/meals/prep.test.ts`
Expected: PASS (all 8 cases).

- [ ] **Step 5: Commit**

```bash
git add lib/meals/prep.ts lib/meals/prep.test.ts
git commit -m "feat(meals): add shared prep grouping/phrasing lib

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Extract `qtyDisplay` into `lib/meals/qty.ts`

**Files:**
- Modify: `lib/meals/qty.ts`
- Modify: `components/meals/PlanClient.tsx`

**Interfaces:**
- Produces: `qtyDisplay(dishes: { qty_amount?: number | null; qty_unit?: string | null; qty_note?: string | null; veg_portions?: number; fruit_portions?: number } | null | undefined): string | null` — moved from a private function in `PlanClient.tsx`, now importable by `components/meals/DayView.tsx` (Task 11) too.

- [ ] **Step 1: Add `qtyDisplay` to `lib/meals/qty.ts`**

Append to the end of the file:

```ts
type QtyDishFields = {
  qty_amount?: number | null
  qty_unit?: string | null
  qty_note?: string | null
  veg_portions?: number
  fruit_portions?: number
}

// Compact "400g · 🥗 2 veg" style line for a dish's buy/cook amount + produce
// portion count. Pure display — no targets, no storage. null when there's
// nothing worth showing.
export function qtyDisplay(dishes: QtyDishFields | null | undefined): string | null {
  const qty = formatQty(dishes?.qty_amount, dishes?.qty_unit, dishes?.qty_note)
  const veg = dishes?.veg_portions ?? 0
  const fruit = dishes?.fruit_portions ?? 0
  const parts: string[] = []
  if (qty) parts.push(qty)
  if (veg > 0) parts.push(`🥗 ${veg} veg`)
  if (fruit > 0) parts.push(`🍎 ${fruit} fruit`)
  return parts.length ? parts.join(' · ') : null
}
```

- [ ] **Step 2: Remove the private copy from `components/meals/PlanClient.tsx` and import it instead**

Change the import line:

```ts
import { formatQty } from '@/lib/meals/qty'
```

to:

```ts
import { formatQty, qtyDisplay } from '@/lib/meals/qty'
```

Delete this now-duplicate local function (everything else in the file that calls `qtyDisplay(...)` keeps working unchanged, since the signature is identical):

```ts
// Compact "400g · 🥗 2 veg" style line for a dish's buy/cook amount + produce
// portion count. Pure display — no targets, no storage. null when there's
// nothing worth showing.
function qtyDisplay(dishes: MealPlan['dishes']): string | null {
  const qty = formatQty(dishes?.qty_amount, dishes?.qty_unit, dishes?.qty_note)
  const veg = dishes?.veg_portions ?? 0
  const fruit = dishes?.fruit_portions ?? 0
  const parts: string[] = []
  if (qty) parts.push(qty)
  if (veg > 0) parts.push(`🥗 ${veg} veg`)
  if (fruit > 0) parts.push(`🍎 ${fruit} fruit`)
  return parts.length ? parts.join(' · ') : null
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/meals/qty.ts components/meals/PlanClient.tsx
git commit -m "refactor(meals): extract qtyDisplay into lib/meals/qty.ts

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Extend `MealPlan['dishes']` with prep + bumbu fields

**Files:**
- Modify: `lib/meals/types.ts`

**Interfaces:**
- Produces: `MealPlan['dishes']` gains `needs_thaw?: boolean; needs_marinate?: boolean; prep_lead_days?: number | null; prep_note?: string | null; bumbu_packet?: string | null`. Consumed by Task 11 (day page).

- [ ] **Step 1: Extend the type**

Change:

```ts
  dishes?: {
    tier: Tier; spicy: boolean; richness: Richness; provides_soup: boolean; recipe_image_url: string | null
    protein: string; saltiness: Saltiness; difficulty: Difficulty; method: string | null; slot?: Slot; recipe_links?: RecipeLink[] | null
    qty_amount?: number | null; qty_unit?: string | null; qty_note?: string | null
    veg_portions?: number; fruit_portions?: number
  } | null
```

to:

```ts
  dishes?: {
    tier: Tier; spicy: boolean; richness: Richness; provides_soup: boolean; recipe_image_url: string | null
    protein: string; saltiness: Saltiness; difficulty: Difficulty; method: string | null; slot?: Slot; recipe_links?: RecipeLink[] | null
    qty_amount?: number | null; qty_unit?: string | null; qty_note?: string | null
    veg_portions?: number; fruit_portions?: number
    needs_thaw?: boolean; needs_marinate?: boolean; prep_lead_days?: number | null; prep_note?: string | null
    bumbu_packet?: string | null
  } | null
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (all fields are optional additions, so no existing `dishes(...)` select call — which doesn't request these columns — breaks).

- [ ] **Step 3: Commit**

```bash
git add lib/meals/types.ts
git commit -m "feat(meals): add prep + bumbu_packet fields to MealPlan.dishes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: `lib/wa/config.ts` — page-specific URL helpers

**Files:**
- Modify: `lib/wa/config.ts`

**Interfaces:**
- Produces: `shoppingPageUrl(): string`, `dayPageUrl(date: string): string`. Consumed by Tasks 6-8.

- [ ] **Step 1: Add the two helpers**

Append to the end of the file:

```ts
export function shoppingPageUrl(): string {
  return `${HOMESPACE_URL}/meals/shopping`
}

export function dayPageUrl(date: string): string {
  return `${HOMESPACE_URL}/meals/day/${date}`
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/wa/config.ts
git commit -m "feat(wa): add shopping/day page URL helpers

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Weekly shopping message — flat list, no headers

**Files:**
- Modify: `lib/wa/messages.ts`
- Modify: `lib/wa/messages.test.ts`

**Interfaces:**
- Consumes: `shoppingPageUrl()` from `./config`.
- Produces: `composeWeeklyShoppingMessage` unchanged signature, new output format.

- [ ] **Step 1: Replace the `composeWeeklyShoppingMessage` tests**

Replace the entire existing `describe('composeWeeklyShoppingMessage', ...)` block with:

```ts
describe('composeWeeklyShoppingMessage', () => {
  it('renders a flat list sorted protein -> veg -> bumbu -> other, no headers', () => {
    const msg = composeWeeklyShoppingMessage([
      { ingredient: 'Kangkung', quantity: '400g', category: 'vegetable' },
      { ingredient: 'Bumbu Rendang', quantity: null, category: 'bumbu' },
      { ingredient: 'Ayam', quantity: '1kg', category: 'protein' },
      { ingredient: 'Tahu', quantity: null, category: 'other' },
    ])
    expect(msg).not.toContain('*Protein*')
    expect(msg).not.toContain('*Sayur*')
    expect(msg).not.toContain('*Bumbu*')
    expect(msg).not.toContain('*Lainnya*')
    const lines = msg.split('\n').filter(l => l.startsWith('- '))
    expect(lines).toEqual(['- Ayam 1kg', '- Kangkung 400g', '- Bumbu Rendang', '- Tahu'])
    expect(msg).toContain('🛒 Belanja minggu ini:')
    expect(msg).toContain('Makasih ya 🧡')
    expect(msg).toContain('https://homespace-chi.vercel.app/meals/shopping')
  })

  it('maps "veg" and "pantry" categories into the same sort position as "vegetable" and "other"', () => {
    const msg = composeWeeklyShoppingMessage([
      { ingredient: 'Garam khusus', quantity: null, category: 'pantry' },
      { ingredient: 'Buncis', quantity: '250g', category: 'veg' },
    ])
    const lines = msg.split('\n').filter(l => l.startsWith('- '))
    expect(lines).toEqual(['- Buncis 250g', '- Garam khusus'])
  })

  it('returns a graceful message when there is nothing to buy, still linking to the shopping page', () => {
    const msg = composeWeeklyShoppingMessage([])
    expect(msg).toContain('https://homespace-chi.vercel.app/meals/shopping')
    expect(msg).not.toContain('- ')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/wa/messages.test.ts`
Expected: FAIL — the new assertions don't match the current grouped-with-headers output.

- [ ] **Step 3: Rewrite `composeWeeklyShoppingMessage`**

Change the import line:

```ts
import { HOMESPACE_URL } from './config'
```

to:

```ts
import { HOMESPACE_URL, shoppingPageUrl } from './config'
```

Replace the function body (keep `shoppingGroup`/`GROUP_ORDER` as-is — still used for sort order):

```ts
export function composeWeeklyShoppingMessage(items: WeeklyShoppingItem[]): string {
  if (items.length === 0) {
    return `🛒 Belum ada yang perlu dibeli minggu ini — santai dulu, ya! 💛\n${shoppingPageUrl()}`
  }

  const sorted = [...items].sort(
    (a, b) => GROUP_ORDER.indexOf(shoppingGroup(a.category)) - GROUP_ORDER.indexOf(shoppingGroup(b.category)),
  )
  const lines = sorted.map(item => (item.quantity ? `${item.ingredient} ${item.quantity}` : item.ingredient))

  return [
    '🛒 Belanja minggu ini:',
    ...lines.map(l => `- ${l}`),
    '',
    'Makasih ya 🧡',
    shoppingPageUrl(),
  ].join('\n')
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/wa/messages.test.ts`
Expected: PASS (weekly-shopping cases; daily/prep cases below are updated in Tasks 7-8).

- [ ] **Step 5: Commit**

```bash
git add lib/wa/messages.ts lib/wa/messages.test.ts
git commit -m "feat(wa): flatten weekly shopping message, drop category headers

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Daily reminder message — link to the day page

**Files:**
- Modify: `lib/wa/messages.ts`
- Modify: `lib/wa/messages.test.ts`

**Interfaces:**
- Consumes: `dayPageUrl(date: string): string` from `./config`.
- Produces: `composeDailyReminderMessage` unchanged content, new link.

- [ ] **Step 1: Update the link assertions**

In the `composeDailyReminderMessage` describe block, change the one assertion:

```ts
    expect(msg).toContain('https://homespace-chi.vercel.app')
```

(in the "composes breakfast, dinner main+support, and fruit" test) to:

```ts
    expect(msg).toContain('https://homespace-chi.vercel.app/meals/day/2026-08-24')
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/wa/messages.test.ts`
Expected: FAIL — current output still links to the bare homepage.

- [ ] **Step 3: Update `composeDailyReminderMessage`**

Change the import line to add `dayPageUrl`:

```ts
import { HOMESPACE_URL, shoppingPageUrl, dayPageUrl } from './config'
```

Change the last line of the function from:

```ts
  lines.push('', 'Selamat malam! 💛', HOMESPACE_URL)
```

to:

```ts
  lines.push('', 'Selamat malam! 💛', dayPageUrl(dateStr))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/wa/messages.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/wa/messages.ts lib/wa/messages.test.ts
git commit -m "feat(wa): daily reminder links to its day page

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Prep/thaw message — link to the earliest cook date's day page

**Files:**
- Modify: `lib/wa/messages.ts`
- Modify: `lib/wa/messages.test.ts`

**Interfaces:**
- Consumes: `dayPageUrl(date: string): string` from `./config`.
- Produces: `composePrepThawMessage` unchanged content, new link (earliest `cook_date` in the batch).

- [ ] **Step 1: Update the link assertions and add an earliest-date test**

Change the assertion in "uses prep_note when present, else derives a phrase from the flags":

```ts
    expect(msg).toContain('https://homespace-chi.vercel.app')
```

to:

```ts
    expect(msg).toContain('https://homespace-chi.vercel.app/meals/day/2026-08-24')
```

Then append a new test to the `composePrepThawMessage` describe block:

```ts
  it('links to the earliest cook date in the batch regardless of input order', () => {
    const msg = composePrepThawMessage([
      { dish_name: 'Babi', cook_date: '2026-08-27', needs_thaw: false, needs_marinate: true, prep_note: null },
      { dish_name: 'Ayam', cook_date: '2026-08-24', needs_thaw: true, needs_marinate: true, prep_note: null },
    ])
    expect(msg).toContain('https://homespace-chi.vercel.app/meals/day/2026-08-24')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/wa/messages.test.ts`
Expected: FAIL — current output still links to the bare homepage.

- [ ] **Step 3: Update `composePrepThawMessage`**

Drop `HOMESPACE_URL` from the import (nothing in the file needs it after this change):

```ts
import { shoppingPageUrl, dayPageUrl } from './config'
```

Replace the function body:

```ts
export function composePrepThawMessage(dishes: PrepDishRow[]): string | null {
  if (dishes.length === 0) return null

  const clauses = dishes.map(d => {
    const phrase = d.prep_note?.trim()
      || (d.needs_thaw && d.needs_marinate ? 'thaw + marinate'
        : d.needs_thaw ? 'thaw'
        : d.needs_marinate ? 'marinate' : 'siapkan')
    return `${d.dish_name} (${indonesianDayName(d.cook_date)}) — ${phrase}`
  })
  const earliestCookDate = [...dishes].map(d => d.cook_date).sort()[0]

  return [
    '🧊 Malam ini siapkan:',
    ...clauses.map(c => `- ${c}`),
    '',
    dayPageUrl(earliestCookDate),
  ].join('\n')
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/wa/messages.test.ts`
Expected: PASS (all cases in the file).

- [ ] **Step 5: Commit**

```bash
git add lib/wa/messages.ts lib/wa/messages.test.ts
git commit -m "feat(wa): prep/thaw message links to earliest cook date's day page

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Cron route — refactor `buildPrepBatches` onto `groupPrepByDate`

**Files:**
- Modify: `app/api/wa/cron/route.ts`

**Interfaces:**
- Consumes: `groupPrepByDate(rows: PrepCandidate[]): Map<string, PrepItem[]>` and type `PrepCandidate` from `@/lib/meals/prep`.
- Produces: `buildPrepBatches` returns the exact same `Map<string, PrepDishRow[]>` shape as before — pure internal refactor, no behavior change.

- [ ] **Step 1: Replace the import block**

Change:

```ts
import { weekDates, shiftWeek } from '@/lib/meals/dates'
import { getOrCreateSettings } from '@/lib/wa/settings'
import { resolveRecipients } from '@/lib/wa/config'
import { sendWhatsapp } from '@/lib/wa/relay'
import {
  jakartaToday, upcomingSaturday, targetWeekStart, tomorrowOf, jakartaDateTimeToUtcIso,
} from '@/lib/wa/schedule'
import { prepDateFor } from '@/lib/meals/dates'
```

to:

```ts
import { weekDates, shiftWeek } from '@/lib/meals/dates'
import { groupPrepByDate, type PrepCandidate } from '@/lib/meals/prep'
import { getOrCreateSettings } from '@/lib/wa/settings'
import { resolveRecipients } from '@/lib/wa/config'
import { sendWhatsapp } from '@/lib/wa/relay'
import {
  jakartaToday, upcomingSaturday, targetWeekStart, tomorrowOf, jakartaDateTimeToUtcIso,
} from '@/lib/wa/schedule'
```

(`prepDateFor` is no longer imported directly — `groupPrepByDate` calls it internally.)

- [ ] **Step 2: Rewrite `buildPrepBatches`**

Replace:

```ts
type DishFlags = { needs_thaw: boolean; needs_marinate: boolean; prep_lead_days: number | null; prep_note: string | null }

// Groups upcoming thaw/marinate dishes by the evening they should be prepped.
async function buildPrepBatches(today: string): Promise<Map<string, PrepDishRow[]>> {
  const until = shiftWeek(today, PREP_LOOKAHEAD_DAYS)
  const { data } = await supabase.from('meal_plans')
    .select('plan_date, dish_id, dish_name, skipped, dishes(needs_thaw, needs_marinate, prep_lead_days, prep_note)')
    .gte('plan_date', today).lte('plan_date', until)
    .eq('skipped', false).not('dish_id', 'is', null)

  // Without generated Database types, supabase-js can't infer the FK's
  // to-one cardinality from the select string and defaults to an array type;
  // it's actually a single nested object at runtime (same as the `dishes`
  // embed in app/api/meals/week/route.ts), hence the `unknown` bridge.
  type PrepPlanRow = { plan_date: string; dish_name: string | null; dishes: DishFlags | null }
  const batches = new Map<string, PrepDishRow[]>()
  for (const row of ((data ?? []) as unknown) as PrepPlanRow[]) {
    const dish = row.dishes
    if (!dish || (!dish.needs_thaw && !dish.needs_marinate)) continue
    const prepDate = prepDateFor(row.plan_date, dish.prep_lead_days)
    const entry: PrepDishRow = {
      dish_name: row.dish_name ?? 'Dish', cook_date: row.plan_date,
      needs_thaw: dish.needs_thaw, needs_marinate: dish.needs_marinate, prep_note: dish.prep_note,
    }
    const list = batches.get(prepDate) ?? []
    list.push(entry)
    batches.set(prepDate, list)
  }
  return batches
}
```

with:

```ts
type DishFlags = { needs_thaw: boolean; needs_marinate: boolean; prep_lead_days: number | null; prep_note: string | null }

// Groups upcoming thaw/marinate dishes by the evening they should be prepped.
// Delegates the grouping itself to lib/meals/prep.ts (shared with the day page).
async function buildPrepBatches(today: string): Promise<Map<string, PrepDishRow[]>> {
  const until = shiftWeek(today, PREP_LOOKAHEAD_DAYS)
  const { data } = await supabase.from('meal_plans')
    .select('plan_date, dish_id, dish_name, skipped, dishes(needs_thaw, needs_marinate, prep_lead_days, prep_note)')
    .gte('plan_date', today).lte('plan_date', until)
    .eq('skipped', false).not('dish_id', 'is', null)

  // Without generated Database types, supabase-js can't infer the FK's
  // to-one cardinality from the select string and defaults to an array type;
  // it's actually a single nested object at runtime (same as the `dishes`
  // embed in app/api/meals/week/route.ts), hence the `unknown` bridge.
  type PrepPlanRow = { plan_date: string; dish_id: string; dish_name: string | null; dishes: DishFlags | null }
  const candidates: PrepCandidate[] = ((data ?? []) as unknown as PrepPlanRow[])
    .filter(row => row.dishes)
    .map(row => ({
      dish_id: row.dish_id, dish_name: row.dish_name ?? 'Dish', cook_date: row.plan_date,
      needs_thaw: row.dishes!.needs_thaw, needs_marinate: row.dishes!.needs_marinate,
      prep_lead_days: row.dishes!.prep_lead_days, prep_note: row.dishes!.prep_note,
    }))

  const grouped = groupPrepByDate(candidates)
  const batches = new Map<string, PrepDishRow[]>()
  for (const [date, items] of grouped) {
    batches.set(date, items.map(item => ({
      dish_name: item.dish_name, cook_date: item.cook_date,
      needs_thaw: item.needs_thaw, needs_marinate: item.needs_marinate, prep_note: item.prep_note,
    })))
  }
  return batches
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Verify against the live database (no behavior change expected)**

Start the dev server (`npm run dev`), then curl the cron endpoint (replace `<secret>` with your `.env.local` `CRON_SECRET`):

```bash
curl -s "http://localhost:3000/api/wa/cron?secret=<secret>" | jq
```

Compare the result to what you'd get on `main` before this task — `built`/`skipped` counts for `prep_thaw` should be identical (same dishes, same batching), since this is a pure refactor. Confirm the actual row content is unchanged:

```sql
select ref_date, message from wa_outbound where kind = 'prep_thaw' order by ref_date;
```

Expected: same rows, same messages as before this task (the earliest-cook-date link change from Task 8 will now also show up here, since this endpoint composes real messages — that's expected and correct).

- [ ] **Step 5: Commit**

```bash
git add app/api/wa/cron/route.ts
git commit -m "refactor(wa): buildPrepBatches delegates to groupPrepByDate

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: `app/meals/page.tsx` — accept `?week=` to support the day page's "back to week" link

**Files:**
- Modify: `app/meals/page.tsx`

**Interfaces:**
- Produces: `MealsPlanPage` now reads `searchParams.week` (a `YYYY-MM-DD` Monday date); falls back to `currentMonday()` when absent/invalid. Consumed by Task 11's `backToWeekHref`.

- [ ] **Step 1: Update the page**

Change:

```tsx
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
```

to:

```tsx
import { supabase } from '@/lib/supabase'
import { weekDates, mondayOf } from '@/lib/meals/dates'
import { reconcileSoup } from '@/lib/meals/reconcile'
import type { DailyStaple, MealPlan } from '@/lib/meals/types'
import PlanClient from '@/components/meals/PlanClient'

function currentMonday(): string {
  const now = new Date()
  const dow = (now.getDay() + 6) % 7
  now.setDate(now.getDate() - dow)
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export default async function MealsPlanPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { week } = await searchParams
  const weekStart = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? mondayOf(week) : currentMonday()
```

(The rest of the function body is unchanged — it already uses `weekStart` from this point on.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify**

With the dev server running, use the same synthetic-session-cookie technique from the earlier WhatsApp-push work (`/meals` requires a login session same as every `/meals/*` page). `PlanClient.tsx` renders `{label(days[0])} – {label(days[6])}` (e.g. "Aug 17") directly in its JSX from the `initialWeekStart` prop, so the server-rendered HTML (what `curl` sees, before any client JS runs) reflects whichever week was requested:

```bash
curl -s "http://localhost:3000/meals?week=2026-08-17" -H 'Cookie: hs_session={"id":"test","name":"Test"}' | grep -o 'Aug 17'
curl -s "http://localhost:3000/meals?week=2026-08-24" -H 'Cookie: hs_session={"id":"test","name":"Test"}' | grep -o 'Aug 24'
```

Expected: each command finds one match — confirms `?week=` actually changes which week is server-rendered. Then confirm the no-param fallback still works:

```bash
curl -s "http://localhost:3000/meals" -H 'Cookie: hs_session={"id":"test","name":"Test"}' | grep -c 'DM Serif Display'
```

Expected: a non-zero count (page renders normally with today's week when `?week=` is absent).

- [ ] **Step 4: Commit**

```bash
git add app/meals/page.tsx
git commit -m "feat(meals): accept ?week= on /meals for the day page's back-link

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: The day page — `components/meals/DayView.tsx` + `app/meals/day/[date]/page.tsx`

**Files:**
- Create: `components/meals/DayView.tsx`
- Create: `app/meals/day/[date]/page.tsx`

**Interfaces:**
- Consumes: `qtyDisplay` from `@/lib/meals/qty`; `groupPrepByDate`, `prepPhrase`, type `PrepCandidate` from `@/lib/meals/prep`; `prepDateFor`, `shiftWeek`, `mondayOf` from `@/lib/meals/dates`; `reconcileSoup` from `@/lib/meals/reconcile`; `SLOT_LABELS`, type `MealPlan` from `@/lib/meals/types`; `DishImage` from `./DishImage`.
- Produces: `DayView` component (exports types `TodayPrepItem`, `UpcomingPrepItem`); the `/meals/day/[date]` route.

- [ ] **Step 1: Write `components/meals/DayView.tsx`**

```tsx
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { SLOT_LABELS, type MealPlan } from '@/lib/meals/types'
import { qtyDisplay } from '@/lib/meals/qty'
import DishImage from './DishImage'

export type TodayPrepItem = { dish_id: string; dish_name: string; phrase: string; prepDayLabel: string }
export type UpcomingPrepItem = { dish_id: string; dish_name: string; phrase: string; cookDate: string; cookDayLabel: string }

function DishLinks({ dishes }: { dishes: MealPlan['dishes'] }) {
  const links = dishes?.recipe_links ?? []
  if (links.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2 mt-1">
      {links.map((l, i) => (
        <a key={i} href={l.url} target="_blank" rel="noopener noreferrer"
          className="text-xs text-orange-600 hover:text-orange-700 underline underline-offset-2">
          {l.title || l.url}
        </a>
      ))}
    </div>
  )
}

function DishCard({ row, big }: { row: MealPlan; big?: boolean }) {
  const qty = qtyDisplay(row.dishes)
  return (
    <Link href={row.dish_id ? `/meals/dish/${row.dish_id}` : '#'}
      className="block bg-white border border-stone-200 rounded-2xl overflow-hidden hover:border-stone-300 transition-colors">
      <DishImage imageUrl={row.dishes?.recipe_image_url ?? null} protein={row.dishes?.protein ?? 'none'} name={row.dish_name ?? undefined}
        className={big ? 'w-full aspect-video' : 'w-full aspect-[3/1]'} rounded="rounded-none" iconSize={big ? 34 : 22} />
      <div className="p-3">
        <div className="text-[10px] uppercase tracking-wide text-stone-400">
          {row.dishes?.slot ? SLOT_LABELS[row.dishes.slot] : ''}
        </div>
        <div className={big ? 'text-lg text-stone-900' : 'text-sm text-stone-800'} style={{ fontFamily: 'DM Serif Display, serif' }}>
          {row.dish_name ?? '—'}
        </div>
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

export default function DayView({
  date, dayName, rows, todayPrep, upcomingPrep, prevDate, nextDate, backToWeekHref,
}: {
  date: string
  dayName: string
  rows: MealPlan[]
  todayPrep: TodayPrepItem[]
  upcomingPrep: UpcomingPrepItem[]
  prevDate: string
  nextDate: string
  backToWeekHref: string
}) {
  const breakfast = rows.find(r => r.slot === 'breakfast' && r.dish_id && !r.skipped)
  const main = rows.find(r => r.role === 'main' && r.dish_id && !r.skipped)
  const supports = rows.filter(r => r.role === 'support' && r.dish_id && !r.skipped)
  const fruit = rows.find(r => r.slot === 'fruit' && r.dish_id && !r.skipped)
  const desert = rows.find(r => r.slot === 'desert' && r.dish_id && !r.skipped)
  const hasPlan = !!(breakfast || main || supports.length || fruit || desert)

  return (
    <div className="max-w-md mx-auto">
      <Link href={backToWeekHref} className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-800 mb-4">
        <ChevronLeft size={16} /> Back to week
      </Link>

      <div className="flex items-center justify-between mb-4">
        <Link href={`/meals/day/${prevDate}`} className="p-2 rounded-lg hover:bg-stone-100 text-stone-600" aria-label="Previous day">
          <ChevronLeft size={18} />
        </Link>
        <h1 className="text-xl text-stone-900" style={{ fontFamily: 'DM Serif Display, serif' }}>{dayName}</h1>
        <Link href={`/meals/day/${nextDate}`} className="p-2 rounded-lg hover:bg-stone-100 text-stone-600" aria-label="Next day">
          <ChevronRight size={18} />
        </Link>
      </div>

      {!hasPlan ? (
        <p className="text-sm text-stone-400 bg-white border border-stone-200 rounded-2xl p-5 text-center">
          Nothing planned for this day yet.
        </p>
      ) : (
        <div className="space-y-3">
          {breakfast && <DishCard row={breakfast} />}
          {main && <DishCard row={main} big />}
          {supports.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {supports.map(s => <DishCard key={s.id} row={s} />)}
            </div>
          )}
          {fruit && <DishCard row={fruit} />}
          {desert && <DishCard row={desert} />}
        </div>
      )}

      {(todayPrep.length > 0 || upcomingPrep.length > 0) && (
        <div className="mt-5 bg-white border border-stone-200 rounded-2xl p-4">
          <h2 className="text-base text-stone-800 mb-3" style={{ fontFamily: 'DM Serif Display, serif' }}>Preparation</h2>
          {todayPrep.length > 0 && (
            <div className="mb-3">
              <div className="text-xs font-medium text-stone-500 mb-1.5">🍽️ Today&apos;s dishes</div>
              <ul className="space-y-1">
                {todayPrep.map(item => (
                  <li key={item.dish_id} className="text-sm text-stone-600">
                    {item.dish_name} — {item.phrase} <span className="text-stone-400">(started {item.prepDayLabel})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {upcomingPrep.length > 0 && (
            <div>
              <div className="text-xs font-medium text-stone-500 mb-1.5">🧊 Prep tonight for upcoming days</div>
              <ul className="space-y-1">
                {upcomingPrep.map(item => (
                  <li key={item.dish_id} className="text-sm text-stone-700">
                    <Link href={`/meals/day/${item.cookDate}`} className="hover:text-orange-700">
                      {item.dish_name} ({item.cookDayLabel}) — {item.phrase}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Write `app/meals/day/[date]/page.tsx`**

```tsx
export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { shiftWeek, mondayOf, prepDateFor } from '@/lib/meals/dates'
import { groupPrepByDate, prepPhrase, type PrepCandidate } from '@/lib/meals/prep'
import { reconcileSoup } from '@/lib/meals/reconcile'
import type { MealPlan } from '@/lib/meals/types'
import DayView, { type TodayPrepItem, type UpcomingPrepItem } from '@/components/meals/DayView'

const DISHES_SELECT = 'tier, spicy, richness, provides_soup, recipe_image_url, protein, saltiness, difficulty, method, ' +
  'slot, recipe_links, qty_amount, qty_unit, qty_note, veg_portions, fruit_portions, ' +
  'needs_thaw, needs_marinate, prep_lead_days, prep_note, bumbu_packet'

const PREP_LOOKAHEAD_DAYS = 14

function shortDayName(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short' })
}
function longDayName(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
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

  const until = shiftWeek(date, PREP_LOOKAHEAD_DAYS)
  const [{ data: dayRows }, { data: lookaheadRows }] = await Promise.all([
    supabase.from('meal_plans').select(`*, dishes(${DISHES_SELECT})`).eq('plan_date', date),
    supabase.from('meal_plans')
      .select('plan_date, dish_id, dish_name, skipped, dishes(needs_thaw, needs_marinate, prep_lead_days, prep_note)')
      .gte('plan_date', date).lte('plan_date', until).eq('skipped', false).not('dish_id', 'is', null),
  ])

  const rows = await reconcileSoup((dayRows ?? []) as MealPlan[])

  // Today's own dishes that needed thaw/marinate — informational recap.
  const todayPrep: TodayPrepItem[] = rows
    .filter(r => r.dish_id && !r.skipped && (r.dishes?.needs_thaw || r.dishes?.needs_marinate))
    .map(r => {
      const needsThaw = !!r.dishes?.needs_thaw
      const needsMarinate = !!r.dishes?.needs_marinate
      const prepNote = r.dishes?.prep_note ?? null
      const leadDays = r.dishes?.prep_lead_days ?? null
      return {
        dish_id: r.dish_id as string,
        dish_name: r.dish_name ?? 'Dish',
        phrase: prepPhrase({ needs_thaw: needsThaw, needs_marinate: needsMarinate, prep_note: prepNote }),
        prepDayLabel: shortDayName(prepDateFor(date, leadDays)),
      }
    })

  // Dishes elsewhere in the lookahead window whose computed prep date is TODAY.
  type LookaheadRow = {
    plan_date: string; dish_id: string; dish_name: string | null
    dishes: { needs_thaw: boolean; needs_marinate: boolean; prep_lead_days: number | null; prep_note: string | null } | null
  }
  const candidates: PrepCandidate[] = ((lookaheadRows ?? []) as unknown as LookaheadRow[])
    .filter(r => r.dishes && r.plan_date !== date) // today's own dishes are covered by todayPrep above
    .map(r => ({
      dish_id: r.dish_id, dish_name: r.dish_name ?? 'Dish', cook_date: r.plan_date,
      needs_thaw: r.dishes!.needs_thaw, needs_marinate: r.dishes!.needs_marinate,
      prep_lead_days: r.dishes!.prep_lead_days, prep_note: r.dishes!.prep_note,
    }))
  const dueToday = groupPrepByDate(candidates).get(date) ?? []
  const upcomingPrep: UpcomingPrepItem[] = dueToday.map(item => ({
    dish_id: item.dish_id, dish_name: item.dish_name, phrase: prepPhrase(item),
    cookDate: item.cook_date, cookDayLabel: shortDayName(item.cook_date),
  }))

  return (
    <DayView
      date={date} dayName={longDayName(date)} rows={rows}
      todayPrep={todayPrep} upcomingPrep={upcomingPrep}
      prevDate={shiftWeek(date, -1)} nextDate={shiftWeek(date, 1)}
      backToWeekHref={`/meals?week=${mondayOf(date)}`}
    />
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. If small type-narrowing friction shows up around the optional `dishes` fields (e.g. a stricter null check needed), adjust with the same defensive-default style already used here (`?? false`, `?? null`, `as string` after an explicit `dish_id &&` filter) — the logic must not change, just satisfy the compiler.

- [ ] **Step 4: Verify against the live database**

With the dev server running, and using the same synthetic-session-cookie technique from the earlier WhatsApp-push work (the route requires a login session, same as every other `/meals/*` page):

```bash
curl -s "http://localhost:3000/meals/day/2026-08-24" -H 'Cookie: hs_session={"id":"test","name":"Test"}' | grep -o 'DM Serif Display' | head -1
```

Expected: at least one match (confirms the page rendered without a server error — an unhandled error would produce Next's error page instead, which doesn't contain that string).

Pick a date you know has real prep data — the earlier WhatsApp work's `wa_outbound` verification found `prep_thaw` rows for `2026-08-28` and `2026-09-02`; re-check what's current:

```sql
select ref_date, message from wa_outbound where kind = 'prep_thaw' order by ref_date;
```

Then curl that `ref_date` and confirm the "Prep tonight for upcoming days" text appears:

```bash
curl -s "http://localhost:3000/meals/day/<that ref_date>" -H 'Cookie: hs_session={"id":"test","name":"Test"}' | grep -o 'Prep tonight for upcoming days'
```

Expected: one match. Also confirm the not-found path:

```bash
curl -s "http://localhost:3000/meals/day/not-a-date" -H 'Cookie: hs_session={"id":"test","name":"Test"}' | grep -o 'Invalid date'
```

Expected: one match.

- [ ] **Step 5: Commit**

```bash
git add components/meals/DayView.tsx "app/meals/day/[date]/page.tsx"
git commit -m "feat(meals): add per-day meal page with Preparation section

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Final check (not a task — run after Task 11)

```bash
npx vitest run
npx tsc --noEmit
```

Expected: all `lib/**/*.test.ts` pass (including the relocated/new `lib/meals/dates.test.ts` and `lib/meals/prep.test.ts` cases), no type errors.

Then re-run WhatsApp test mode so Kevin can preview the updated messages and tap through the new links (same URL pattern as before — only the message bodies changed):

```
https://<deployment-or-localhost>/api/wa/cron?secret=<CRON_SECRET>&test=1&to=%2B6282242382604
```

Confirm on the phone: the shopping message is a flat list (no bold category headers) ending "Makasih ya 🧡" and linking to `/meals/shopping`; the daily reminder links to `/meals/day/<tomorrow>`; the prep/thaw message links to `/meals/day/<earliest cook date in that batch>`; tapping each link lands on the right page (shopping page and the new day page, respectively), and the day page's Preparation section shows both sub-sections when applicable.
