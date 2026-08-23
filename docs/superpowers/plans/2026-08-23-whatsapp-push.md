# WhatsApp PUSH Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scheduled WhatsApp messages (weekly shopping list, daily meal reminder, smart prep/thaw reminder) sent to Kevin's wife (optionally Kevin), driven by a cron endpoint an external scheduler hits every ~30 min.

**Architecture:** A small pure `lib/wa/` module (scheduling math + message composition, unit-tested) feeds one integration route (`app/api/wa/cron/route.ts`) that builds/dedupes `wa_outbound` rows from the live meal-planning data and sends due ones through the existing relay. A second route + page manage the `wa_settings` singleton.

**Tech Stack:** Next.js App Router route handlers, `@supabase/supabase-js` (existing `lib/supabase.ts` client), vitest.

**Spec:** `docs/superpowers/specs/2026-08-23-whatsapp-push-design.md`

## Global Constraints

- All 3 message types: Indonesian, warm, short, always end with
  `https://homespace-chi.vercel.app`.
- Recipients are fixed constants — wife `+6283194111119` always, Kevin
  `+6282242382604` only when `include_kevin` is set. No user-editable
  recipient list.
- Asia/Jakarta is fixed UTC+7, no DST — never use the server process's
  local timezone for date/time math.
- `wa_outbound` dedupe key is `(kind, ref_date)` — a row is only ever
  built once per occurrence and never resent once `sent = true`.
- The cron route must be safe to call every 30 min: re-running it must
  never double-send and must be inexpensive when there's nothing to do.
- Supabase project: `eelcqdkkefhvoloiikka` (name "Homespace"). Vitest only
  covers `lib/**/*.test.ts` (see `vitest.config.ts`) — API routes are
  verified manually (curl + SQL), matching this repo's existing convention
  (no `app/api/**/*.test.ts` anywhere today).

---

### Task 1: Migration — `wa_settings` table + `wa_outbound` dedupe constraint

**Files:**
- Create: `migrations/2026-08-23-wa-push.sql`

**Interfaces:**
- Produces: table `wa_settings(id, weekly_enabled, weekly_time, daily_enabled, daily_time, prep_enabled, prep_time, include_kevin, updated_at)`, one seeded row. Constraint `wa_outbound_kind_ref_date_key unique (kind, ref_date)`.

- [ ] **Step 1: Write the migration file**

```sql
-- WhatsApp PUSH layer: settings singleton + dedupe key on wa_outbound.

create table if not exists wa_settings (
  id uuid primary key default gen_random_uuid(),
  weekly_enabled boolean not null default true,
  weekly_time text not null default '09:00',
  daily_enabled boolean not null default true,
  daily_time text not null default '17:30',
  prep_enabled boolean not null default true,
  prep_time text not null default '19:30',
  include_kevin boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table wa_settings enable row level security;

create policy "Allow all access" on wa_settings for all to public using (true) with check (true);

insert into wa_settings (id)
select gen_random_uuid()
where not exists (select 1 from wa_settings);

alter table wa_outbound add constraint wa_outbound_kind_ref_date_key unique (kind, ref_date);
```

- [ ] **Step 2: Apply it to the live project**

Use the Supabase MCP `apply_migration` tool with `project_id: eelcqdkkefhvoloiikka`, `name: wa_push`, and the SQL above as `query`. (This both runs the SQL and records it in Supabase's migration history; the file in `migrations/` is the repo's own record, matching the existing `migrations/2026-08-14-dish-images-storage.sql`.)

- [ ] **Step 3: Verify**

Run (Supabase MCP `execute_sql`, same project):
```sql
select * from wa_settings;
```
Expected: exactly one row, all defaults as above.

```sql
select conname from pg_constraint where conname = 'wa_outbound_kind_ref_date_key';
```
Expected: one row returned.

- [ ] **Step 4: Commit**

```bash
git add migrations/2026-08-23-wa-push.sql
git commit -m "feat(wa): add wa_settings table + wa_outbound dedupe constraint

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `lib/wa/types.ts` + `lib/wa/config.ts`

**Files:**
- Create: `lib/wa/types.ts`
- Create: `lib/wa/config.ts`

**Interfaces:**
- Produces: types `WaOutboundKind`, `WaSettings`, `WaOutboundRow`, `WeeklyShoppingItem`, `ShopIngredientRow`, `DailyPlanRow`, `PrepDishRow`; constants `WA_NUMBERS`, `HOMESPACE_URL`; function `resolveRecipients(includeKevin: boolean): string[]`.

- [ ] **Step 1: Write `lib/wa/types.ts`**

```ts
export type WaOutboundKind = 'weekly_shopping' | 'daily_reminder' | 'prep_thaw'

export type WaSettings = {
  id: string
  weekly_enabled: boolean
  weekly_time: string
  daily_enabled: boolean
  daily_time: string
  prep_enabled: boolean
  prep_time: string
  include_kevin: boolean
  updated_at: string
}

export type WaOutboundRow = {
  id: string
  kind: WaOutboundKind
  send_at: string
  recipients: string[]
  message: string
  ref_date: string
  sent: boolean
  sent_at: string | null
}

// ---- message-composer input shapes ------------------------------------------

export type WeeklyShoppingItem = { ingredient: string; quantity: string | null; category: string }

// Raw shape of one entry in dishes.shop_ingredients (see scripts/draft-shopping-ingredients.mjs).
export type ShopIngredientRow = { item: string; amount: number; unit: string; category: string }

export type DailyPlanRow = {
  slot: string
  role: string
  dish_id: string | null
  dish_name: string | null
  skipped: boolean
}

export type PrepDishRow = {
  dish_name: string
  cook_date: string
  needs_thaw: boolean
  needs_marinate: boolean
  prep_note: string | null
}
```

- [ ] **Step 2: Write `lib/wa/config.ts`**

```ts
// Fixed household recipients — not user-editable (see design spec §Recipients).
export const WA_NUMBERS = {
  wife: '+6283194111119',
  kevin: '+6282242382604',
} as const

export const HOMESPACE_URL = 'https://homespace-chi.vercel.app'

export function resolveRecipients(includeKevin: boolean): string[] {
  return includeKevin ? [WA_NUMBERS.wife, WA_NUMBERS.kevin] : [WA_NUMBERS.wife]
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (these two files have no consumers yet, so this just confirms they parse/typecheck cleanly).

- [ ] **Step 4: Commit**

```bash
git add lib/wa/types.ts lib/wa/config.ts
git commit -m "feat(wa): add shared types and fixed recipient config

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `lib/wa/schedule.ts` — date/time helpers

**Files:**
- Create: `lib/wa/schedule.ts`
- Test: `lib/wa/schedule.test.ts`

**Interfaces:**
- Consumes: `shiftWeek(dateStr: string, deltaDays: number): string` and `mondayOf(dateStr: string): string` from `@/lib/meals/dates`.
- Produces: `jakartaToday(now?: Date): string`, `upcomingSaturday(today: string): string`, `tomorrowOf(today: string): string`, `targetWeekStart(saturdayDate: string): string`, `prepDateFor(cookDate: string, prepLeadDays: number | null): string`, `indonesianDayName(dateStr: string): string`, `jakartaDateTimeToUtcIso(dateStr: string, hhmm: string): string`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import {
  jakartaToday, upcomingSaturday, tomorrowOf, targetWeekStart,
  prepDateFor, indonesianDayName, jakartaDateTimeToUtcIso,
} from './schedule'

describe('jakartaToday', () => {
  it('rolls over to the next day once UTC+7 crosses midnight', () => {
    // 2026-08-22T18:00:00Z + 7h = 2026-08-23T01:00 Jakarta
    expect(jakartaToday(new Date('2026-08-22T18:00:00Z'))).toBe('2026-08-23')
  })
  it('stays on the same day otherwise', () => {
    expect(jakartaToday(new Date('2026-08-22T01:00:00Z'))).toBe('2026-08-22')
  })
})

describe('upcomingSaturday', () => {
  it('returns today when today is Saturday', () => {
    expect(upcomingSaturday('2026-08-22')).toBe('2026-08-22') // a Saturday
  })
  it('returns 6 days out when today is Sunday', () => {
    expect(upcomingSaturday('2026-08-23')).toBe('2026-08-29') // Sunday -> next Saturday
  })
  it('returns the Saturday later this week for a midweek day', () => {
    expect(upcomingSaturday('2026-08-17')).toBe('2026-08-22') // Monday -> that week's Saturday
  })
})

describe('tomorrowOf', () => {
  it('adds one day', () => {
    expect(tomorrowOf('2026-08-31')).toBe('2026-09-01')
  })
})

describe('targetWeekStart', () => {
  it('is the Monday of the week after the Saturday\'s own week', () => {
    // Saturday 2026-08-22 is in the Mon-Sun week starting 2026-08-17
    expect(targetWeekStart('2026-08-22')).toBe('2026-08-24')
  })
})

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

describe('indonesianDayName', () => {
  it('maps known dates to Indonesian weekday names', () => {
    expect(indonesianDayName('2026-08-17')).toBe('Senin') // Monday
    expect(indonesianDayName('2026-08-22')).toBe('Sabtu') // Saturday
    expect(indonesianDayName('2026-08-23')).toBe('Minggu') // Sunday
  })
})

describe('jakartaDateTimeToUtcIso', () => {
  it('subtracts the 7h offset', () => {
    expect(jakartaDateTimeToUtcIso('2026-08-22', '09:00')).toBe('2026-08-22T02:00:00.000Z')
  })
  it('rolls the UTC date back when the Jakarta time is before 07:00', () => {
    expect(jakartaDateTimeToUtcIso('2026-08-22', '01:00')).toBe('2026-08-21T18:00:00.000Z')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/wa/schedule.test.ts`
Expected: FAIL — `Cannot find module './schedule'` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```ts
import { shiftWeek, mondayOf } from '@/lib/meals/dates'

const JAKARTA_OFFSET_MS = 7 * 3600_000
const ID_DAYS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'] // Mon..Sun

// Today's date (YYYY-MM-DD) in Asia/Jakarta (fixed UTC+7, no DST), derived
// from the instant `now` — never from the server process's own timezone.
export function jakartaToday(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + JAKARTA_OFFSET_MS)
  const y = shifted.getUTCFullYear()
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const d = String(shifted.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function dowMonBased(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return (new Date(y, m - 1, d).getDay() + 6) % 7 // Mon=0 ... Sun=6
}

// The next Saturday on/after `today` (inclusive).
export function upcomingSaturday(today: string): string {
  const dow = dowMonBased(today)
  const daysUntilSat = dow <= 5 ? 5 - dow : 6
  return shiftWeek(today, daysUntilSat)
}

export function tomorrowOf(today: string): string {
  return shiftWeek(today, 1)
}

// The Monday-start week a Saturday's shopping trip is FOR: the week after
// the Saturday's own Mon-Sun week.
export function targetWeekStart(saturdayDate: string): string {
  return shiftWeek(mondayOf(saturdayDate), 7)
}

// A thaw/marinate dish always gets at least one evening's notice.
export function prepDateFor(cookDate: string, prepLeadDays: number | null): string {
  const lead = Math.max(prepLeadDays ?? 1, 1)
  return shiftWeek(cookDate, -lead)
}

export function indonesianDayName(dateStr: string): string {
  return ID_DAYS[dowMonBased(dateStr)]
}

// Combine a local Asia/Jakarta date + "HH:MM" wall-clock time into a UTC ISO instant.
export function jakartaDateTimeToUtcIso(dateStr: string, hhmm: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const [hh, mm] = hhmm.split(':').map(Number)
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - JAKARTA_OFFSET_MS).toISOString()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/wa/schedule.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/wa/schedule.ts lib/wa/schedule.test.ts
git commit -m "feat(wa): add Asia/Jakarta date and scheduling helpers

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `lib/wa/messages.ts` — weekly shopping composer

**Files:**
- Create: `lib/wa/messages.ts`
- Test: `lib/wa/messages.test.ts`

**Interfaces:**
- Consumes: `formatQtyAmount(amount: number, unit: string): string` from `@/lib/meals/qty`; `HOMESPACE_URL` from `./config`; types `WeeklyShoppingItem`, `ShopIngredientRow` from `./types`.
- Produces: `sumShopIngredients(rows: ShopIngredientRow[]): WeeklyShoppingItem[]`, `composeWeeklyShoppingMessage(items: WeeklyShoppingItem[]): string`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { sumShopIngredients, composeWeeklyShoppingMessage } from './messages'

describe('sumShopIngredients', () => {
  it('sums duplicate items (case-insensitive) sharing a unit', () => {
    const result = sumShopIngredients([
      { item: 'Ayam', amount: 500, unit: 'g', category: 'protein' },
      { item: 'ayam', amount: 300, unit: 'g', category: 'protein' },
    ])
    expect(result).toEqual([{ ingredient: 'Ayam', quantity: '800g', category: 'protein' }])
  })
  it('keeps different units of the same item separate', () => {
    const result = sumShopIngredients([
      { item: 'Ikan', amount: 2, unit: 'ekor', category: 'protein' },
      { item: 'Ikan', amount: 400, unit: 'g', category: 'protein' },
    ])
    expect(result).toHaveLength(2)
  })
})

describe('composeWeeklyShoppingMessage', () => {
  it('groups items into Protein / Sayur / Bumbu / Lainnya', () => {
    const msg = composeWeeklyShoppingMessage([
      { ingredient: 'Ayam', quantity: '1kg', category: 'protein' },
      { ingredient: 'Kangkung', quantity: '400g', category: 'vegetable' },
      { ingredient: 'Bumbu Rendang', quantity: null, category: 'bumbu' },
      { ingredient: 'Tahu', quantity: null, category: 'other' },
    ])
    expect(msg).toContain('*Protein*\n- Ayam 1kg')
    expect(msg).toContain('*Sayur*\n- Kangkung 400g')
    expect(msg).toContain('*Bumbu*\n- Bumbu Rendang')
    expect(msg).toContain('*Lainnya*\n- Tahu')
    expect(msg).toContain('https://homespace-chi.vercel.app')
  })
  it('omits a group heading entirely when it has no items', () => {
    const msg = composeWeeklyShoppingMessage([{ ingredient: 'Ayam', quantity: '1kg', category: 'protein' }])
    expect(msg).not.toContain('Sayur')
    expect(msg).not.toContain('Bumbu')
    expect(msg).not.toContain('Lainnya')
  })
  it('returns a graceful message when there is nothing to buy', () => {
    const msg = composeWeeklyShoppingMessage([])
    expect(msg).toContain('https://homespace-chi.vercel.app')
    expect(msg).not.toContain('*Protein*')
  })
  it('maps "veg" and "pantry" categories the same as "vegetable" and "other"', () => {
    const msg = composeWeeklyShoppingMessage([
      { ingredient: 'Buncis', quantity: '250g', category: 'veg' },
      { ingredient: 'Garam khusus', quantity: null, category: 'pantry' },
    ])
    expect(msg).toContain('*Sayur*\n- Buncis 250g')
    expect(msg).toContain('*Lainnya*\n- Garam khusus')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/wa/messages.test.ts`
Expected: FAIL — `Cannot find module './messages'`.

- [ ] **Step 3: Write the implementation**

```ts
import { formatQtyAmount } from '@/lib/meals/qty'
import { HOMESPACE_URL } from './config'
import type { WeeklyShoppingItem, ShopIngredientRow } from './types'

// ---- Weekly shopping ---------------------------------------------------------

type ShoppingGroup = 'Protein' | 'Sayur' | 'Bumbu' | 'Lainnya'
const GROUP_ORDER: ShoppingGroup[] = ['Protein', 'Sayur', 'Bumbu', 'Lainnya']

function shoppingGroup(category: string): ShoppingGroup {
  const c = category.trim().toLowerCase()
  if (c === 'protein') return 'Protein'
  if (c === 'vegetable' || c === 'veg') return 'Sayur'
  if (c === 'bumbu') return 'Bumbu'
  return 'Lainnya' // pantry | other | dish | anything unrecognized
}

// Sums duplicate items (case-insensitive name match, same unit) drafted from
// dishes.shop_ingredients across a week's meal_plans, into the same shape a
// real meal_shopping_items query returns.
export function sumShopIngredients(rows: ShopIngredientRow[]): WeeklyShoppingItem[] {
  const byKey = new Map<string, { ingredient: string; category: string; total: number; unit: string }>()
  for (const r of rows) {
    const key = `${r.item.trim().toLowerCase()}|${r.unit}`
    const existing = byKey.get(key)
    if (existing) existing.total += r.amount
    else byKey.set(key, { ingredient: r.item.trim(), category: r.category, total: r.amount, unit: r.unit })
  }
  return [...byKey.values()].map(v => ({
    ingredient: v.ingredient,
    category: v.category,
    quantity: formatQtyAmount(v.total, v.unit),
  }))
}

export function composeWeeklyShoppingMessage(items: WeeklyShoppingItem[]): string {
  const groups = new Map<ShoppingGroup, string[]>()
  for (const item of items) {
    const g = shoppingGroup(item.category)
    const line = item.quantity ? `${item.ingredient} ${item.quantity}` : item.ingredient
    const list = groups.get(g) ?? []
    list.push(line)
    groups.set(g, list)
  }

  if (groups.size === 0) {
    return `🛒 Belum ada yang perlu dibeli minggu ini — santai dulu, ya! 💛\n${HOMESPACE_URL}`
  }

  const sections = GROUP_ORDER
    .filter(g => groups.has(g))
    .map(g => `*${g}*\n${groups.get(g)!.map(l => `- ${l}`).join('\n')}`)

  return [
    '🛒 Belanja minggu ini ya:',
    '',
    sections.join('\n\n'),
    '',
    'Makasih banyak! 💛',
    HOMESPACE_URL,
  ].join('\n')
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/wa/messages.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/wa/messages.ts lib/wa/messages.test.ts
git commit -m "feat(wa): add weekly shopping message composer

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: `lib/wa/messages.ts` — daily meal reminder composer

**Files:**
- Modify: `lib/wa/messages.ts`
- Modify: `lib/wa/messages.test.ts`

**Interfaces:**
- Consumes: `indonesianDayName(dateStr: string): string` from `./schedule`; `HOMESPACE_URL` from `./config`; type `DailyPlanRow` from `./types`.
- Produces: `composeDailyReminderMessage(dateStr: string, rows: DailyPlanRow[]): string | null`.

- [ ] **Step 1: Add the failing tests** (append to `lib/wa/messages.test.ts`)

```ts
import { composeDailyReminderMessage } from './messages'

describe('composeDailyReminderMessage', () => {
  const base = { dish_id: 'd1', skipped: false }

  it('returns null when nothing is planned for that date', () => {
    expect(composeDailyReminderMessage('2026-08-24', [])).toBeNull()
  })

  it('composes breakfast, dinner main+support, and fruit', () => {
    const msg = composeDailyReminderMessage('2026-08-24', [
      { ...base, slot: 'breakfast', role: 'breakfast', dish_name: 'Bubur ayam' },
      { ...base, slot: 'utama', role: 'main', dish_name: 'Ayam bakar' },
      { ...base, slot: 'sayuran', role: 'support', dish_name: 'Tumis kangkung' },
      { ...base, slot: 'fruit', role: 'optional', dish_name: 'Pisang' },
    ])
    expect(msg).toContain('Senin') // 2026-08-24 is a Monday
    expect(msg).toContain('🌅 Sarapan: Bubur ayam')
    expect(msg).toContain('🍽️ Makan malam: Ayam bakar + Tumis kangkung')
    expect(msg).toContain('🍎 Buah: Pisang')
    expect(msg).toContain('https://homespace-chi.vercel.app')
  })

  it('skips missing sections and ignores skipped/optional rows', () => {
    const msg = composeDailyReminderMessage('2026-08-24', [
      { ...base, slot: 'utama', role: 'main', dish_name: 'Ayam bakar' },
      { ...base, slot: 'desert', role: 'optional', dish_name: 'Puding', skipped: false },
      { ...base, slot: 'kuah', role: 'support', dish_name: 'Sup', skipped: true },
    ])
    expect(msg).not.toContain('Sarapan')
    expect(msg).not.toContain('Buah')
    expect(msg).not.toContain('Puding')
    expect(msg).not.toContain('Sup')
    expect(msg).toContain('🍽️ Makan malam: Ayam bakar')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/wa/messages.test.ts`
Expected: FAIL — `composeDailyReminderMessage is not a function`.

- [ ] **Step 3: Add the implementation** (append to `lib/wa/messages.ts`)

```ts
import { indonesianDayName } from './schedule'
import type { DailyPlanRow } from './types'

// ---- Daily meal reminder ------------------------------------------------------

export function composeDailyReminderMessage(dateStr: string, rows: DailyPlanRow[]): string | null {
  const planned = rows.filter(r => r.dish_id && !r.skipped)
  if (planned.length === 0) return null

  const breakfast = planned.find(r => r.slot === 'breakfast')?.dish_name
  const main = planned.find(r => r.role === 'main')?.dish_name
  const supports = planned.filter(r => r.role === 'support').map(r => r.dish_name).filter((n): n is string => !!n)
  const fruit = planned.find(r => r.slot === 'fruit')?.dish_name

  if (!breakfast && !main && supports.length === 0 && !fruit) return null

  const lines: string[] = [`🌤️ Besok, ${indonesianDayName(dateStr)}:`, '']
  if (breakfast) lines.push(`🌅 Sarapan: ${breakfast}`)
  if (main) lines.push(`🍽️ Makan malam: ${main}${supports.length ? ` + ${supports.join(', ')}` : ''}`)
  else if (supports.length) lines.push(`🍽️ Makan malam: ${supports.join(', ')}`)
  if (fruit) lines.push(`🍎 Buah: ${fruit}`)
  lines.push('', 'Selamat malam! 💛', HOMESPACE_URL)

  return lines.join('\n')
}
```

(`HOMESPACE_URL` is already imported at the top of `lib/wa/messages.ts` from Task 4 — do not re-import.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/wa/messages.test.ts`
Expected: PASS (all cases, including Task 4's).

- [ ] **Step 5: Commit**

```bash
git add lib/wa/messages.ts lib/wa/messages.test.ts
git commit -m "feat(wa): add daily meal reminder message composer

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: `lib/wa/messages.ts` — prep/thaw reminder composer

**Files:**
- Modify: `lib/wa/messages.ts`
- Modify: `lib/wa/messages.test.ts`

**Interfaces:**
- Consumes: `indonesianDayName` from `./schedule`; `HOMESPACE_URL` from `./config`; type `PrepDishRow` from `./types`.
- Produces: `composePrepThawMessage(dishes: PrepDishRow[]): string | null`.

- [ ] **Step 1: Add the failing tests** (append to `lib/wa/messages.test.ts`)

```ts
import { composePrepThawMessage } from './messages'

describe('composePrepThawMessage', () => {
  it('returns null for an empty batch', () => {
    expect(composePrepThawMessage([])).toBeNull()
  })

  it('uses prep_note when present, else derives a phrase from the flags', () => {
    const msg = composePrepThawMessage([
      { dish_name: 'Ayam', cook_date: '2026-08-24', needs_thaw: true, needs_marinate: true, prep_note: null },
      {
        dish_name: 'Babi', cook_date: '2026-08-27', needs_thaw: false, needs_marinate: true,
        prep_note: 'bisa marinate sekarang, tahan seminggu',
      },
    ])
    expect(msg).toContain('🧊 Malam ini siapkan:')
    expect(msg).toContain('Ayam (Senin) — thaw + marinate') // 2026-08-24 is Monday
    expect(msg).toContain('Babi (Kamis) — bisa marinate sekarang, tahan seminggu') // 2026-08-27 is Thursday
    expect(msg).toContain('https://homespace-chi.vercel.app')
  })

  it('derives "thaw" alone when only needs_thaw is set', () => {
    const msg = composePrepThawMessage([
      { dish_name: 'Ikan', cook_date: '2026-08-24', needs_thaw: true, needs_marinate: false, prep_note: null },
    ])
    expect(msg).toContain('Ikan (Senin) — thaw')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/wa/messages.test.ts`
Expected: FAIL — `composePrepThawMessage is not a function`.

- [ ] **Step 3: Add the implementation** (append to `lib/wa/messages.ts`)

```ts
import type { PrepDishRow } from './types'

// ---- Prep / thaw reminder -----------------------------------------------------

export function composePrepThawMessage(dishes: PrepDishRow[]): string | null {
  if (dishes.length === 0) return null

  const clauses = dishes.map(d => {
    const phrase = d.prep_note?.trim()
      || (d.needs_thaw && d.needs_marinate ? 'thaw + marinate'
        : d.needs_thaw ? 'thaw'
        : d.needs_marinate ? 'marinate' : 'siapkan')
    return `${d.dish_name} (${indonesianDayName(d.cook_date)}) — ${phrase}`
  })

  return [
    '🧊 Malam ini siapkan:',
    ...clauses.map(c => `- ${c}`),
    '',
    HOMESPACE_URL,
  ].join('\n')
}
```

(Consolidate the three `import type { ... } from './types'` lines and the two `import { ... } from './schedule'`/`'./config'` lines at the top of the file into single statements per module — Tasks 4–6 introduced them incrementally; tidy to one clean import block per source before committing.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/wa/messages.test.ts`
Expected: PASS (all cases from Tasks 4-6).

- [ ] **Step 5: Commit**

```bash
git add lib/wa/messages.ts lib/wa/messages.test.ts
git commit -m "feat(wa): add prep/thaw batch reminder message composer

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Exempt the cron route from session auth + add `CRON_SECRET`

**Files:**
- Modify: `proxy.ts`
- Modify: `.env.example`
- Modify: `.env.local` (not committed)

**Interfaces:**
- Produces: `/api/wa/cron` reachable without a session cookie (it protects itself via its own `?secret=` check, added in Task 8); env var `CRON_SECRET` available to `process.env`.

- [ ] **Step 1: Update `proxy.ts`**

The global session middleware currently redirects every path except `/login` and `/api/auth/*` to `/login` when there's no session cookie — that would break an external cron caller hitting `/api/wa/cron` directly. Add it to the public list:

```ts
import { NextRequest, NextResponse } from 'next/server'

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  const isPublic = pathname === '/login' || pathname.startsWith('/api/auth/') || pathname.startsWith('/api/wa/cron')
  if (isPublic) return NextResponse.next()

  const sessionCookie = request.cookies.get('hs_session')?.value
  if (!sessionCookie) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  try {
    JSON.parse(sessionCookie)
    return NextResponse.next()
  } catch {
    return NextResponse.redirect(new URL('/login', request.url))
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

- [ ] **Step 2: Add `CRON_SECRET` to `.env.example`**

Add this line near the existing `WHATSAPP_RELAY_*` lines:

```
CRON_SECRET=
```

- [ ] **Step 3: Add a real value to `.env.local` for local testing**

Generate a random secret and append it:

```bash
echo "CRON_SECRET=$(openssl rand -hex 20)" >> .env.local
```

Note the generated value (e.g. `grep CRON_SECRET .env.local`) — it's needed for every curl verification step in Tasks 8-12, and Kevin should set the same (or his own) value as `CRON_SECRET` in Vercel's env vars before this ships.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit** (only the tracked files — `.env.local` is gitignored)

```bash
git add proxy.ts .env.example
git commit -m "feat(wa): exempt cron endpoint from session auth, add CRON_SECRET

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: `lib/wa/settings.ts` + cron route — auth, settings, weekly build

**Files:**
- Create: `lib/wa/settings.ts`
- Create: `app/api/wa/cron/route.ts`

**Interfaces:**
- Consumes: `supabase` from `@/lib/supabase`; `WaSettings` from `@/lib/wa/types`; `upcomingSaturday`, `targetWeekStart`, `jakartaToday`, `jakartaDateTimeToUtcIso` from `@/lib/wa/schedule`; `composeWeeklyShoppingMessage`, `sumShopIngredients` from `@/lib/wa/messages`; `resolveRecipients` from `@/lib/wa/config`; `weekDates` from `@/lib/meals/dates`.
- Produces: `getOrCreateSettings(): Promise<WaSettings>` (reused by Task 13); `GET` handler at `/api/wa/cron` that (for now) only builds the weekly-shopping row and returns `{ built, sent: 0, skipped, failed: 0 }`.

- [ ] **Step 1: Write `lib/wa/settings.ts`**

```ts
import { supabase } from '@/lib/supabase'
import type { WaSettings } from './types'

const DEFAULTS = {
  weekly_enabled: true, weekly_time: '09:00',
  daily_enabled: true, daily_time: '17:30',
  prep_enabled: true, prep_time: '19:30',
  include_kevin: false,
}

// The app operates on a single settings row. The migration seeds one, but
// this is a safety net in case it's ever missing.
export async function getOrCreateSettings(): Promise<WaSettings> {
  const { data } = await supabase.from('wa_settings').select('*').limit(1).maybeSingle()
  if (data) return data as WaSettings
  const { data: inserted, error } = await supabase.from('wa_settings').insert(DEFAULTS).select().single()
  if (error || !inserted) throw new Error(error?.message ?? 'failed to create wa_settings row')
  return inserted as WaSettings
}
```

- [ ] **Step 2: Write `app/api/wa/cron/route.ts`**

```ts
import { supabase } from '@/lib/supabase'
import { weekDates } from '@/lib/meals/dates'
import { getOrCreateSettings } from '@/lib/wa/settings'
import { resolveRecipients } from '@/lib/wa/config'
import { jakartaToday, upcomingSaturday, targetWeekStart, jakartaDateTimeToUtcIso } from '@/lib/wa/schedule'
import { composeWeeklyShoppingMessage, sumShopIngredients } from '@/lib/wa/messages'
import type { WaOutboundKind, WeeklyShoppingItem, ShopIngredientRow } from '@/lib/wa/types'

async function buildWeeklyItems(saturday: string): Promise<WeeklyShoppingItem[]> {
  const weekStart = targetWeekStart(saturday)
  const { data: list } = await supabase.from('meal_shopping_lists')
    .select('id').eq('week_start', weekStart).maybeSingle()

  if (list) {
    const { data: items } = await supabase.from('meal_shopping_items')
      .select('ingredient, quantity, category')
      .eq('list_id', list.id).eq('checked', false).eq('already_have', false)
    return (items ?? []) as WeeklyShoppingItem[]
  }

  const days = weekDates(weekStart)
  const { data: plans } = await supabase.from('meal_plans').select('dish_id')
    .gte('plan_date', days[0]).lte('plan_date', days[6])
    .eq('skipped', false).not('dish_id', 'is', null)
  const dishIds = [...new Set((plans ?? []).map(p => p.dish_id as string))]
  if (dishIds.length === 0) return []

  const { data: dishes } = await supabase.from('dishes').select('shop_ingredients').in('id', dishIds)
  const rows: ShopIngredientRow[] = (dishes ?? []).flatMap(d => (d.shop_ingredients ?? []) as ShopIngredientRow[])
  return sumShopIngredients(rows)
}

// Insert a wa_outbound row for (kind, refDate) if absent; if present and not
// yet sent, refresh its content (message/recipients/send_at may have changed
// since the last build); if already sent, leave it untouched.
async function upsertOutbound(
  kind: WaOutboundKind, refDate: string, sendAt: string, recipients: string[], message: string,
): Promise<'built' | 'skipped'> {
  const { data: existing } = await supabase.from('wa_outbound').select('id, sent')
    .eq('kind', kind).eq('ref_date', refDate).maybeSingle()

  if (!existing) {
    const { error } = await supabase.from('wa_outbound').insert({
      kind, ref_date: refDate, send_at: sendAt, recipients, message, sent: false,
    })
    return error ? 'skipped' : 'built'
  }
  if (existing.sent) return 'skipped'
  const { error } = await supabase.from('wa_outbound')
    .update({ send_at: sendAt, recipients, message }).eq('id', existing.id)
  return error ? 'skipped' : 'built'
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const secret = url.searchParams.get('secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const settings = await getOrCreateSettings()
  const today = jakartaToday()
  let built = 0, skipped = 0

  if (settings.weekly_enabled) {
    try {
      const saturday = upcomingSaturday(today)
      const items = await buildWeeklyItems(saturday)
      const message = composeWeeklyShoppingMessage(items)
      const sendAt = jakartaDateTimeToUtcIso(saturday, settings.weekly_time)
      const result = await upsertOutbound(
        'weekly_shopping', saturday, sendAt, resolveRecipients(settings.include_kevin), message,
      )
      if (result === 'built') built++; else skipped++
    } catch (err) {
      console.error('weekly_shopping build failed:', err)
      skipped++
    }
  }

  return Response.json({ built, sent: 0, skipped, failed: 0 })
}
```

Wrapping each kind's build in `try/catch` (rather than letting a query error propagate as an empty result that would silently build a wrong/empty message) matches the design spec's error-handling rule: a failed build is skipped for this tick, other kinds still proceed, and the next tick retries.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Verify against the live database**

Start the dev server: `npm run dev` (in another terminal/background).

Confirm settings are enabled and note today's/upcoming Saturday's target
week (adjust the date literals below to your actual current date):
```sql
select weekly_enabled, weekly_time from wa_settings;
```

Curl the endpoint (replace `<secret>` with the value from `.env.local`):
```bash
curl -s "http://localhost:3000/api/wa/cron?secret=<secret>" | jq
```
Expected: `{"built": 1, "sent": 0, "skipped": 0, "failed": 0}` (or `"built": 0, "skipped": 1` if a row for that Saturday already exists from a prior run).

Confirm the row landed correctly:
```sql
select kind, ref_date, send_at, recipients, sent, message from wa_outbound where kind = 'weekly_shopping' order by created_at desc limit 1;
```
Expected: one row, `ref_date` = the upcoming Saturday, `recipients = ["+6283194111119"]`, `message` starting with `🛒 Belanja minggu ini ya:` (or the graceful empty-list message if no plan/list exists yet for that target week), `sent = false`.

Curl again immediately:
```bash
curl -s "http://localhost:3000/api/wa/cron?secret=<secret>" | jq
```
Expected: `{"built": 0, "sent": 0, "skipped": 1, "failed": 0}` — confirms the dedupe/refresh path (no duplicate row created).

- [ ] **Step 5: Commit**

```bash
git add lib/wa/settings.ts app/api/wa/cron/route.ts
git commit -m "feat(wa): add cron endpoint with weekly shopping build phase

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Cron route — daily reminder + prep/thaw build phases

**Files:**
- Modify: `app/api/wa/cron/route.ts`

**Interfaces:**
- Consumes: `tomorrowOf`, `prepDateFor` from `@/lib/wa/schedule`; `composeDailyReminderMessage`, `composePrepThawMessage` from `@/lib/wa/messages`; `shiftWeek` from `@/lib/meals/dates`; types `DailyPlanRow`, `PrepDishRow` from `@/lib/wa/types`.
- Produces: the same route now also builds `daily_reminder` and `prep_thaw` rows.

- [ ] **Step 1: Extend the imports and add the two new build helpers**

```ts
import { weekDates, shiftWeek } from '@/lib/meals/dates'
import { getOrCreateSettings } from '@/lib/wa/settings'
import { resolveRecipients } from '@/lib/wa/config'
import {
  jakartaToday, upcomingSaturday, targetWeekStart, tomorrowOf, prepDateFor, jakartaDateTimeToUtcIso,
} from '@/lib/wa/schedule'
import {
  composeWeeklyShoppingMessage, sumShopIngredients, composeDailyReminderMessage, composePrepThawMessage,
} from '@/lib/wa/messages'
import type { WaOutboundKind, WeeklyShoppingItem, ShopIngredientRow, DailyPlanRow, PrepDishRow } from '@/lib/wa/types'

const PREP_LOOKAHEAD_DAYS = 14

async function buildDailyRows(tomorrow: string): Promise<DailyPlanRow[]> {
  const { data } = await supabase.from('meal_plans')
    .select('slot, role, dish_id, dish_name, skipped').eq('plan_date', tomorrow)
  return (data ?? []) as DailyPlanRow[]
}

type DishFlags = { needs_thaw: boolean; needs_marinate: boolean; prep_lead_days: number | null; prep_note: string | null }

// Groups upcoming thaw/marinate dishes by the evening they should be prepped.
async function buildPrepBatches(today: string): Promise<Map<string, PrepDishRow[]>> {
  const until = shiftWeek(today, PREP_LOOKAHEAD_DAYS)
  const { data } = await supabase.from('meal_plans')
    .select('plan_date, dish_id, dish_name, skipped, dishes(needs_thaw, needs_marinate, prep_lead_days, prep_note)')
    .gte('plan_date', today).lte('plan_date', until)
    .eq('skipped', false).not('dish_id', 'is', null)

  const batches = new Map<string, PrepDishRow[]>()
  for (const row of (data ?? []) as { plan_date: string; dish_name: string | null; dishes: DishFlags | null }[]) {
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

- [ ] **Step 2: Extend the `GET` handler**

Insert this between the weekly block and the final `return Response.json(...)`:

```ts
  if (settings.daily_enabled) {
    try {
      const tomorrow = tomorrowOf(today)
      const rows = await buildDailyRows(tomorrow)
      const message = composeDailyReminderMessage(tomorrow, rows)
      if (message) {
        const sendAt = jakartaDateTimeToUtcIso(today, settings.daily_time)
        const result = await upsertOutbound(
          'daily_reminder', tomorrow, sendAt, resolveRecipients(settings.include_kevin), message,
        )
        if (result === 'built') built++; else skipped++
      } else {
        skipped++
      }
    } catch (err) {
      console.error('daily_reminder build failed:', err)
      skipped++
    }
  }

  if (settings.prep_enabled) {
    try {
      const batches = await buildPrepBatches(today)
      for (const [prepDate, dishes] of batches) {
        const message = composePrepThawMessage(dishes)
        if (!message) { skipped++; continue }
        const sendAt = jakartaDateTimeToUtcIso(prepDate, settings.prep_time)
        const result = await upsertOutbound(
          'prep_thaw', prepDate, sendAt, resolveRecipients(settings.include_kevin), message,
        )
        if (result === 'built') built++; else skipped++
      }
    } catch (err) {
      console.error('prep_thaw build failed:', err)
      skipped++
    }
  }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Verify against the live database**

With the dev server running, curl again:
```bash
curl -s "http://localhost:3000/api/wa/cron?secret=<secret>" | jq
```
Expected: `built` increases by 1 (daily) plus however many distinct prep-evenings exist among dishes with `needs_thaw`/`needs_marinate` in the next 14 days (0 if none). Confirm:
```sql
select kind, ref_date, send_at, message from wa_outbound where kind = 'daily_reminder' order by created_at desc limit 1;
select kind, ref_date, message from wa_outbound where kind = 'prep_thaw' order by created_at desc;
```
Expected: a `daily_reminder` row for tomorrow's date with sections matching whatever is actually planned in `meal_plans` for that date; `prep_thaw` rows (if any) with `ref_date` earlier than the corresponding dish's cook date by at least 1 day, and messages listing dish names with the correct Indonesian weekday.

Curl a third time — `built` should now be 0 and `skipped` should cover every kind that already has a pending or already-sent row.

- [ ] **Step 5: Commit**

```bash
git add app/api/wa/cron/route.ts
git commit -m "feat(wa): add daily reminder and prep/thaw build phases to cron route

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: `lib/wa/relay.ts`

**Files:**
- Create: `lib/wa/relay.ts`

**Interfaces:**
- Consumes: env vars `WHATSAPP_RELAY_URL`, `WHATSAPP_RELAY_SECRET`.
- Produces: `sendWhatsapp(phone: string, message: string): Promise<{ ok: true } | { ok: false; error: string }>`.

- [ ] **Step 1: Write the implementation**

```ts
export type SendResult = { ok: true } | { ok: false; error: string }

// Posts one message to the Mac Mini WhatsApp relay (over Tailscale Funnel).
// Not unit-tested — network I/O, same convention as the Google Calendar call
// in app/api/calendar/create-event/route.ts.
export async function sendWhatsapp(phone: string, message: string): Promise<SendResult> {
  const url = process.env.WHATSAPP_RELAY_URL
  const secret = process.env.WHATSAPP_RELAY_SECRET
  if (!url || !secret) return { ok: false, error: 'WHATSAPP_RELAY_URL/WHATSAPP_RELAY_SECRET not configured' }

  try {
    const res = await fetch(`${url}/send-whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: secret, phone, message }),
    })
    if (!res.ok) return { ok: false, error: `relay HTTP ${res.status}` }
    const body = await res.json().catch(() => null)
    if (!body?.ok) return { ok: false, error: `relay response: ${JSON.stringify(body)}` }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/wa/relay.ts
git commit -m "feat(wa): add relay client for sending WhatsApp messages

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: Cron route — send phase

**Files:**
- Modify: `app/api/wa/cron/route.ts`

**Interfaces:**
- Consumes: `sendWhatsapp` from `@/lib/wa/relay`; `WaOutboundRow`, `WaSettings` from `@/lib/wa/types`.
- Produces: the route now actually sends due, enabled rows and marks them sent.

- [ ] **Step 1: Add the import and a small enabled-check helper**

```ts
import { sendWhatsapp } from '@/lib/wa/relay'
import type { WaOutboundRow } from '@/lib/wa/types'

function kindEnabled(kind: WaOutboundKind, settings: import('@/lib/wa/types').WaSettings): boolean {
  if (kind === 'weekly_shopping') return settings.weekly_enabled
  if (kind === 'daily_reminder') return settings.daily_enabled
  return settings.prep_enabled
}
```

- [ ] **Step 2: Replace the final `return Response.json(...)` with the send phase**

```ts
  const { data: due } = await supabase.from('wa_outbound').select('*')
    .eq('sent', false).lte('send_at', new Date().toISOString())

  let sent = 0, failed = 0
  for (const row of (due ?? []) as WaOutboundRow[]) {
    if (!kindEnabled(row.kind, settings)) { skipped++; continue }
    const results = await Promise.all(row.recipients.map(phone => sendWhatsapp(phone, row.message)))
    const allOk = results.every(r => r.ok)
    if (allOk) {
      await supabase.from('wa_outbound').update({ sent: true, sent_at: new Date().toISOString() }).eq('id', row.id)
      sent++
    } else {
      failed++
    }
  }

  return Response.json({ built, sent, skipped, failed })
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Verify against the live relay — this sends a real WhatsApp message**

Force a row to be due right now, using the weekly row created in Task 8's verification:
```sql
update wa_outbound set send_at = now() - interval '1 minute' where kind = 'weekly_shopping' and sent = false;
```
Curl the endpoint:
```bash
curl -s "http://localhost:3000/api/wa/cron?secret=<secret>" | jq
```
Expected: `{"built": <n>, "sent": 1, "skipped": <n>, "failed": 0}`, and a real WhatsApp message arrives on the wife's number (`+6283194111119`) — confirm with Kevin before running this step, since it is a live send, not a preview.

Confirm the row is now marked sent:
```sql
select sent, sent_at from wa_outbound where kind = 'weekly_shopping' order by created_at desc limit 1;
```
Expected: `sent = true`, `sent_at` populated.

Curl once more — `sent` should be 0 this time (the row is no longer due-and-unsent).

- [ ] **Step 5: Commit**

```bash
git add app/api/wa/cron/route.ts
git commit -m "feat(wa): add send phase to cron route

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 12: Cron route — test mode

**Files:**
- Modify: `app/api/wa/cron/route.ts`

**Interfaces:**
- Produces: `&test=1&to=+62...` query mode that force-sends all 3 message types to one number immediately, bypassing `wa_outbound` and `wa_settings` entirely.

- [ ] **Step 1: Add sample fallback data and the test-mode function**

Add near the top of the file, after the existing constants:

```ts
const SAMPLE_WEEKLY_ITEMS: WeeklyShoppingItem[] = [
  { ingredient: 'Ayam', quantity: '1kg', category: 'protein' },
  { ingredient: 'Kangkung', quantity: '400g', category: 'vegetable' },
  { ingredient: 'Bumbu Rendang', quantity: null, category: 'bumbu' },
]
const SAMPLE_DAILY_ROWS: DailyPlanRow[] = [
  { slot: 'breakfast', role: 'breakfast', dish_id: 'sample', dish_name: 'Bubur ayam', skipped: false },
  { slot: 'utama', role: 'main', dish_id: 'sample', dish_name: 'Ayam bakar', skipped: false },
  { slot: 'sayuran', role: 'support', dish_id: 'sample', dish_name: 'Tumis kangkung', skipped: false },
  { slot: 'fruit', role: 'optional', dish_id: 'sample', dish_name: 'Pisang', skipped: false },
]
const SAMPLE_PREP_DISHES: PrepDishRow[] = [
  { dish_name: 'Ayam', cook_date: '2026-08-24', needs_thaw: true, needs_marinate: true, prep_note: null },
  {
    dish_name: 'Babi', cook_date: '2026-08-27', needs_thaw: false, needs_marinate: true,
    prep_note: 'bisa marinate sekarang, tahan seminggu',
  },
]
const SAMPLE_TAG = '\n\n_(contoh — belum ada data nyata untuk ini)_'

async function runTestMode(to: string): Promise<Response> {
  const today = jakartaToday()

  const saturday = upcomingSaturday(today)
  const weeklyItems = await buildWeeklyItems(saturday)
  const weeklyMessage = weeklyItems.length > 0
    ? composeWeeklyShoppingMessage(weeklyItems)
    : composeWeeklyShoppingMessage(SAMPLE_WEEKLY_ITEMS) + SAMPLE_TAG

  const tomorrow = tomorrowOf(today)
  const dailyRows = await buildDailyRows(tomorrow)
  const dailyMessage = composeDailyReminderMessage(tomorrow, dailyRows)
    ?? composeDailyReminderMessage(tomorrow, SAMPLE_DAILY_ROWS)! + SAMPLE_TAG

  const batches = await buildPrepBatches(today)
  const firstBatch = [...batches.values()][0]
  const prepMessage = firstBatch
    ? composePrepThawMessage(firstBatch)!
    : composePrepThawMessage(SAMPLE_PREP_DISHES)! + SAMPLE_TAG

  const sentOk: Record<string, boolean> = {}
  for (const [kind, message] of [
    ['weekly_shopping', weeklyMessage],
    ['daily_reminder', dailyMessage],
    ['prep_thaw', prepMessage],
  ] as const) {
    const result = await sendWhatsapp(to, message)
    sentOk[kind] = result.ok
  }
  return Response.json({ sent: sentOk })
}
```

- [ ] **Step 2: Branch into it at the top of `GET`, right after the secret check**

```ts
  const isTest = url.searchParams.get('test') === '1'
  if (isTest) {
    const to = url.searchParams.get('to')
    if (!to) return Response.json({ error: 'test mode requires &to=+62...' }, { status: 400 })
    return runTestMode(to)
  }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Verify against the live relay — this sends 3 real WhatsApp messages**

Confirm with Kevin before running (it sends real messages to whatever `&to=` number you give it):
```bash
curl -s "http://localhost:3000/api/wa/cron?secret=<secret>&test=1&to=%2B6282242382604" | jq
```
Expected: `{"sent": {"weekly_shopping": true, "daily_reminder": true, "prep_thaw": true}}`, and 3 WhatsApp messages arrive on Kevin's phone (`+6282242382604`) within a few seconds, formatted per the design spec. Confirm no `wa_outbound` rows were created by this call:
```sql
select count(*) from wa_outbound where created_at > now() - interval '2 minutes';
```
Expected: `0` (test mode must not touch the table).

- [ ] **Step 5: Commit**

```bash
git add app/api/wa/cron/route.ts
git commit -m "feat(wa): add cron test mode for previewing all 3 message types

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 13: Settings API route

**Files:**
- Create: `app/api/wa/settings/route.ts`

**Interfaces:**
- Consumes: `getOrCreateSettings` from `@/lib/wa/settings`; `supabase` from `@/lib/supabase`.
- Produces: `GET` (returns the singleton `WaSettings` row), `PATCH` (whitelisted-field update).

- [ ] **Step 1: Write the route**

```ts
import { supabase } from '@/lib/supabase'
import { getOrCreateSettings } from '@/lib/wa/settings'

const FIELDS = [
  'weekly_enabled', 'weekly_time', 'daily_enabled', 'daily_time',
  'prep_enabled', 'prep_time', 'include_kevin',
]

export async function GET() {
  const settings = await getOrCreateSettings()
  return Response.json(settings)
}

export async function PATCH(request: Request) {
  const body = await request.json()
  const patch = Object.fromEntries(Object.entries(body).filter(([k]) => FIELDS.includes(k)))
  const settings = await getOrCreateSettings()
  const { data, error } = await supabase.from('wa_settings')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', settings.id).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify against the live database**

With the dev server running:
```bash
curl -s http://localhost:3000/api/wa/settings | jq
```
Expected: the singleton row as JSON.

```bash
curl -s -X PATCH http://localhost:3000/api/wa/settings -H 'Content-Type: application/json' -d '{"include_kevin": true, "daily_time": "18:00"}' | jq
```
Expected: the updated row (`include_kevin: true`, `daily_time: "18:00"`).

```bash
curl -s -X PATCH http://localhost:3000/api/wa/settings -H 'Content-Type: application/json' -d '{"include_kevin": false, "daily_time": "17:30"}' | jq
```
Reset back to defaults so later manual testing isn't affected.

- [ ] **Step 4: Commit**

```bash
git add app/api/wa/settings/route.ts
git commit -m "feat(wa): add settings GET/PATCH route

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 14: Settings page + client component

**Files:**
- Create: `app/settings/page.tsx`
- Create: `components/settings/WaSettingsClient.tsx`

**Interfaces:**
- Consumes: `GET /api/wa/settings`, `PATCH /api/wa/settings` (Task 13); `WaSettings` type from `@/lib/wa/types`.
- Produces: a `/settings` page rendering three enable+time rows and an "include Kevin" toggle, saved on change.

- [ ] **Step 1: Write `app/settings/page.tsx`**

```tsx
export const dynamic = 'force-dynamic'

import { supabase } from '@/lib/supabase'
import WaSettingsClient from '@/components/settings/WaSettingsClient'
import type { WaSettings } from '@/lib/wa/types'

export default async function SettingsPage() {
  const { data } = await supabase.from('wa_settings').select('*').limit(1).single()
  return <WaSettingsClient initialSettings={data as WaSettings} />
}
```

- [ ] **Step 2: Write `components/settings/WaSettingsClient.tsx`**

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Bell } from 'lucide-react'
import type { WaSettings } from '@/lib/wa/types'

type Row = {
  key: 'weekly' | 'daily' | 'prep'
  label: string
  description: string
}

const ROWS: Row[] = [
  { key: 'weekly', label: 'Weekly shopping list', description: 'Saturday morning, grouped by Protein/Sayur/Bumbu' },
  { key: 'daily', label: 'Daily meal reminder', description: "Tomorrow's meals, sent the evening before" },
  { key: 'prep', label: 'Prep/thaw reminder', description: 'Batches same-evening thaw & marinate prep' },
]

export default function WaSettingsClient({ initialSettings }: { initialSettings: WaSettings }) {
  const [settings, setSettings] = useState(initialSettings)
  const [saving, setSaving] = useState(false)

  async function patch(fields: Partial<WaSettings>) {
    setSettings(s => ({ ...s, ...fields }))
    setSaving(true)
    try {
      const res = await fetch('/api/wa/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      })
      const updated = await res.json()
      setSettings(updated)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="bg-white border-b border-stone-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link href="/" className="text-stone-400 hover:text-stone-600 transition-colors">
            <ArrowLeft size={18} />
          </Link>
          <h1 className="text-xl font-semibold text-stone-900" style={{ fontFamily: 'DM Serif Display, serif' }}>
            Notifications
          </h1>
          {saving && <span className="text-xs text-stone-400 ml-auto">Saving…</span>}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8 space-y-4">
        {ROWS.map(({ key, label, description }) => {
          const enabledKey = `${key}_enabled` as const
          const timeKey = `${key}_time` as const
          return (
            <div key={key} className="bg-white border border-stone-200 rounded-xl p-4 flex items-center justify-between gap-4">
              <div>
                <p className="font-medium text-stone-900 flex items-center gap-2"><Bell size={15} /> {label}</p>
                <p className="text-sm text-stone-500 mt-0.5">{description}</p>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="time"
                  value={settings[timeKey]}
                  onChange={e => patch({ [timeKey]: e.target.value } as Partial<WaSettings>)}
                  className="border border-stone-200 rounded-lg px-2 py-1 text-sm"
                  disabled={!settings[enabledKey]}
                />
                <button
                  onClick={() => patch({ [enabledKey]: !settings[enabledKey] } as Partial<WaSettings>)}
                  className={`w-11 h-6 rounded-full transition-colors relative ${settings[enabledKey] ? 'bg-orange-500' : 'bg-stone-300'}`}
                >
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${settings[enabledKey] ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
              </div>
            </div>
          )
        })}

        <div className="bg-white border border-stone-200 rounded-xl p-4 flex items-center justify-between gap-4">
          <div>
            <p className="font-medium text-stone-900">Also send to Kevin</p>
            <p className="text-sm text-stone-500 mt-0.5">Wife always gets these; toggle this to CC Kevin too</p>
          </div>
          <button
            onClick={() => patch({ include_kevin: !settings.include_kevin })}
            className={`w-11 h-6 rounded-full transition-colors relative ${settings.include_kevin ? 'bg-orange-500' : 'bg-stone-300'}`}
          >
            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${settings.include_kevin ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </div>
      </main>
    </div>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Verify in the browser**

With `npm run dev` running, visit `http://localhost:3000/settings` (log in first if redirected to `/login`). Toggle each enable switch and change a time value; confirm the change persists after a page refresh (i.e. it round-tripped through `PATCH`/`GET`).

- [ ] **Step 5: Commit**

```bash
git add app/settings/page.tsx components/settings/WaSettingsClient.tsx
git commit -m "feat(wa): add settings page for WhatsApp push preferences

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 15: Home page tile

**Files:**
- Modify: `app/page.tsx`

**Interfaces:**
- Produces: a "Notifications" tile on `/` linking to `/settings`.

- [ ] **Step 1: Add the entry to the `features` array**

```ts
import { Receipt, Calendar, ShoppingCart, UtensilsCrossed, Bell, Plus, LogOut } from 'lucide-react'

const features = [
  {
    href: '/expenses',
    icon: Receipt,
    label: 'Expenses',
    description: 'Track receipts & spending',
    color: 'bg-orange-50 text-orange-600',
  },
  {
    href: '/calendar',
    icon: Calendar,
    label: 'Calendar',
    description: 'Family schedule',
    color: 'bg-blue-50 text-blue-600',
  },
  {
    href: '/shopping',
    icon: ShoppingCart,
    label: 'Shopping',
    description: 'Shared grocery lists',
    color: 'bg-green-50 text-green-600',
  },
  {
    href: '/meals',
    icon: UtensilsCrossed,
    label: 'Meals',
    description: 'Weekly meal planner',
    color: 'bg-amber-50 text-amber-600',
  },
  {
    href: '/settings',
    icon: Bell,
    label: 'Notifications',
    description: 'WhatsApp reminders & schedule',
    color: 'bg-purple-50 text-purple-600',
  },
]
```

(Only the `import` line and the `features` array change — the rest of `app/page.tsx` is untouched.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify in the browser**

Visit `http://localhost:3000/`. Confirm a "Notifications" tile appears and clicking it navigates to `/settings`.

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "feat(wa): add Notifications tile to home page

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Final check (not a task — run after Task 15)

Run the full test suite and typecheck once more end to end:

```bash
npx vitest run
npx tsc --noEmit
```

Expected: all `lib/**/*.test.ts` pass (including the new `lib/wa/*.test.ts` files), no type errors.

Then tell Kevin the exact test-mode URL to preview all 3 message types on his own phone before any real scheduled sends go out:

```
https://<vercel-deployment-url>/api/wa/cron?secret=<CRON_SECRET>&test=1&to=%2B6282242382604
```

(`%2B` is the URL-encoded `+`.) This requires `CRON_SECRET` and the existing `WHATSAPP_RELAY_*` vars to be set in Vercel first.
