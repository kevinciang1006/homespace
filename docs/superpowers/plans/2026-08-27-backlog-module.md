# Backlog Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tagged personal-chore backlog with a `/backlog` management page plus one context-aware WhatsApp nudge per day, capped at a single suggestion.

**Architecture:** Two Supabase tables (`backlog_items`, `backlog_log`). A pure, unit-tested engine (`lib/backlog/engine.ts`) picks at most one item that fits the current slot/day and composes the message. A new build phase inside the existing WhatsApp cron route (`app/api/wa/cron/route.ts`) enqueues a `wa_outbound` row (deduped on `(kind, ref_date=today)`) which the existing due-sender delivers to Kevin. A `/backlog` Next.js page + two API routes are the mutation surface.

**Tech Stack:** Next.js 16 App Router (route handlers + RSC), `@supabase/supabase-js` (existing `lib/supabase.ts` client), vitest, Tailwind, `lucide-react`.

**Spec:** `docs/superpowers/specs/2026-08-27-backlog-module-design.md`

## Global Constraints

- Supabase project: `eelcqdkkefhvoloiikka` (name "Homespace"). Migrations are applied via the Supabase MCP `apply_migration` tool (records migration history) AND kept as a `.sql` file in `migrations/` (repo's own record). Verify with the MCP `execute_sql` tool.
- RLS policy pattern (copied verbatim from `migrations/2026-08-23-wa-push.sql`): `create policy "Allow all access" on <table> for all to public using (true) with check (true);` — the app uses bcrypt password auth, not Supabase Auth. Never invent a new policy.
- Asia/Jakarta is fixed UTC+7, no DST. Never use the server process's local timezone for date/time math — use the helpers in `lib/wa/schedule.ts` (`jakartaToday`, `tomorrowOf`, `jakartaDateTimeToUtcIso`).
- Vitest only covers `lib/**/*.test.ts` (see `vitest.config.ts`). API routes and pages are verified manually (curl + SQL + browser) — there are no `app/api/**/*.test.ts` anywhere in this repo; do not add any.
- The nudge recipient is **Kevin only** — `WA_NUMBERS.kevin` (`+6282242382604`) from `lib/wa/config.ts`. Not the wife, not `include_kevin`-gated.
- The nudge is in **English** (every other WA message in this repo is Indonesian — this one is deliberately different).
- The nudge message always ends with `${HOMESPACE_URL}/backlog` (`HOMESPACE_URL` from `lib/wa/config.ts`).
- The cron route must stay safe to call every ~30 min: re-running must never double-enqueue (guaranteed by `upsertOutbound`'s `(kind, ref_date)` dedupe) and must be cheap when there's nothing to do.
- "Capped at ONE item" and "silent when nothing fits" are the product's whole point — `composeBacklogNudge` returns `null` (→ nothing enqueued) when there's no candidate and no tail.
- Run `npx tsc --noEmit` and `npm test` before every commit that touches `.ts`/`.tsx`.
- End every commit message with:
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`

---

## File Structure

**New files:**

| File | Responsibility |
|------|----------------|
| `migrations/2026-08-27-backlog.sql` | Tables, indexes, RLS, seed, `wa_settings` columns |
| `lib/backlog/types.ts` | Row + context TypeScript types (mirrors DB shape) |
| `lib/backlog/engine.ts` | Pure: `slotForTime`, `selectNudgeCandidate`, `backlogTail`, `composeBacklogNudge` |
| `lib/backlog/engine.test.ts` | Vitest unit tests for the engine |
| `lib/backlog/queries.ts` | Supabase I/O helpers used by the cron route (`fetchReadyPool`, `fetchActiveItems`, `fetchExcludedMutexGroups`, `markSuggested`) |
| `app/api/backlog/items/route.ts` | `POST` — quick-add |
| `app/api/backlog/items/[id]/route.ts` | `PATCH` — `{ action }` transitions and `{ patch }` tag edits |
| `app/backlog/page.tsx` | RSC — fetch all items, render client |
| `components/backlog/BacklogClient.tsx` | `'use client'` — sections, quick-add, row actions |
| `components/backlog/TagEditor.tsx` | `'use client'` — inline per-row tag editor |

**Modified files:**

| File | Change |
|------|--------|
| `lib/wa/types.ts` | `WaOutboundKind` += `'backlog_nudge'`; `WaSettings` += `backlog_enabled`, `backlog_time` |
| `lib/wa/settings.ts` | `DEFAULTS` += `backlog_enabled: true`, `backlog_time: '19:30'` |
| `lib/wa/schedule.ts` | export `isWeekend(dateStr: string): boolean` |
| `app/api/wa/settings/route.ts` | `FIELDS` += `'backlog_enabled'`, `'backlog_time'` |
| `app/api/wa/cron/route.ts` | new `backlog_nudge` build phase; `kindEnabled` branch; test-mode sample |
| `app/page.tsx` | new Backlog card in the `features` grid |
| `components/settings/WaSettingsClient.tsx` | new `backlog` row in `ROWS` |

---

## Task 1: Migration — tables, seed, `wa_settings` columns

**Files:**
- Create: `migrations/2026-08-27-backlog.sql`

**Interfaces:**
- Produces: tables `backlog_items` and `backlog_log` (columns per spec §3), indexes `idx_backlog_status` / `idx_backlog_log_item`, 12 seeded rows, and `wa_settings.backlog_enabled boolean not null default true` + `wa_settings.backlog_time text not null default '19:30'`.

- [ ] **Step 1: Write the migration file**

Create `migrations/2026-08-27-backlog.sql` with exactly this content:

```sql
-- Backlog module: tagged personal-chore backlog + one daily context-aware nudge.
-- Brief: docs/homespace-backlog-brief.md
-- Spec:  docs/superpowers/specs/2026-08-27-backlog-module-design.md

create table if not exists backlog_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default 'other',        -- car | kitchen | home_maint | outdoor | online | errand | other
  status text not null default 'ready',          -- ready | blocked | snoozed | done | dropped
  blocked_by text,                               -- free text, e.g. 'awaiting: spiral mixer'
  time_of_day text[] not null default '{any}',   -- morning | afternoon | evening | night | any
  day_pref text not null default 'any',          -- weekday | weekend | any
  needs_daylight boolean not null default false,
  needs_dry boolean not null default false,
  prep_ahead boolean not null default false,
  lead_time_hours int,
  mutex_group text,
  recurring boolean not null default false,
  recurrence text,
  deadline date,
  priority int not null default 0,
  last_suggested_at timestamptz,
  last_done_at timestamptz,
  snooze_until date,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists backlog_log (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references backlog_items(id) on delete cascade,
  action text not null,                          -- suggested | done | snoozed | unblocked | skipped | created
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_backlog_status on backlog_items(status);
create index if not exists idx_backlog_log_item on backlog_log(item_id);

alter table backlog_items enable row level security;
alter table backlog_log  enable row level security;
create policy "Allow all access" on backlog_items for all to public using (true) with check (true);
create policy "Allow all access" on backlog_log  for all to public using (true) with check (true);

-- Seed: the 12 starting items (brief §2). Guarded so re-applying is a no-op.
do $$
begin
  if not exists (select 1 from backlog_items) then
    insert into backlog_items
      (title, category, status, blocked_by, time_of_day, day_pref, needs_daylight, needs_dry, prep_ahead, lead_time_hours, mutex_group, recurring, recurrence, deadline, priority, notes)
    values
      ('Clean car windows',                    'car',        'ready',   null,                     '{morning}',           'weekend', true,  true,  false, null, 'car_clean', false, null,    null,         1, 'mold/mushroom spots forming'),
      ('Clean car interior',                   'car',        'ready',   null,                     '{morning,afternoon}', 'weekend', true,  false, false, null, 'car_clean', false, null,    null,         0, 'keep separate from window day'),
      ('Prepare pizza poolish',                'kitchen',    'ready',   null,                     '{evening}',           'any',     false, false, true,  12,   null,        false, null,    null,         0, 'preferment; doable before mixer arrives'),
      ('Pizza dough experiments (2-3 var.)',   'kitchen',    'blocked', 'awaiting: spiral mixer', '{evening}',           'any',     false, false, true,  null, null,        false, null,    null,         0, 'start after spiral mixer arrives'),
      ('Bake banana bread',                    'kitchen',    'ready',   null,                     '{evening,night}',     'any',     false, false, false, null, null,        false, null,    null,         1, 'use the aging bananas'),
      ('Ninja Creami - chocolate',             'kitchen',    'blocked', 'awaiting: Callebaut',    '{any}',               'any',     false, false, true,  24,   null,        false, null,    null,         0, 'wait for Callebaut'),
      ('Ninja Creami - rainbow (for son)',     'kitchen',    'ready',   null,                     '{any}',               'any',     false, false, true,  24,   null,        false, null,    null,         2, 'son keeps asking; prep base, freeze 24h, spin'),
      ('Ninja Creami - mango sorbet',          'kitchen',    'ready',   null,                     '{any}',               'any',     false, false, true,  24,   null,        false, null,    null,         0, 'prep base, freeze 24h, spin'),
      ('Clean Dreame robot',                   'home_maint', 'ready',   null,                     '{any}',               'any',     false, false, false, null, null,        false, null,    null,         0, 'quick maintenance'),
      ('Wash motorcycle',                      'outdoor',    'ready',   null,                     '{morning}',           'weekend', true,  true,  false, null, null,        false, null,    null,         1, 'overdue'),
      ('Check Taobao for pizza oven promo',    'online',     'ready',   null,                     '{any}',               'any',     false, false, false, null, null,        true,  'daily', '2026-09-09', 0, '9.9 sale; buy oven if promo'),
      ('Marinade meals (vacuum seal)',         'kitchen',    'blocked', 'awaiting: vacuum sealer','{evening}',           'any',     false, false, false, null, null,        false, null,    null,         0, 'ties into meal plan');
  end if;
end $$;

alter table wa_settings add column if not exists backlog_enabled boolean not null default true;
alter table wa_settings add column if not exists backlog_time    text    not null default '19:30';
```

Note: the two "Ninja Creami — X" and any em-dash titles from the brief are written with a plain hyphen `-` here to avoid any encoding surprise in SQL; the brief's intent is preserved.

- [ ] **Step 2: Apply it to the live project**

Use the Supabase MCP `apply_migration` tool with `project_id: eelcqdkkefhvoloiikka`, `name: backlog_module`, and the SQL above as `query`.

- [ ] **Step 3: Verify**

Run via Supabase MCP `execute_sql` (same project):

```sql
select count(*) from backlog_items;
```
Expected: `12`.

```sql
select title, category, status, time_of_day, day_pref, priority from backlog_items order by priority desc, title;
```
Expected: 12 rows; `Ninja Creami - rainbow (for son)` has priority 2; the 3 blocked rows are `Pizza dough experiments...`, `Ninja Creami - chocolate`, `Marinade meals...`.

```sql
select column_name, data_type, column_default from information_schema.columns
where table_name = 'wa_settings' and column_name in ('backlog_enabled','backlog_time');
```
Expected: 2 rows — `backlog_enabled` (boolean, default true), `backlog_time` (text, default `'19:30'::text`).

```sql
select polname from pg_policies where tablename in ('backlog_items','backlog_log');
```
Expected: `Allow all access` for both tables.

- [ ] **Step 4: Commit**

```bash
git add migrations/2026-08-27-backlog.sql
git commit -m "feat(backlog): migration — backlog_items + backlog_log + seed

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: `lib/backlog/types.ts`

**Files:**
- Create: `lib/backlog/types.ts`

**Interfaces:**
- Produces: `BacklogCategory`, `BacklogStatus`, `TimeOfDay`, `DayPref`, `BacklogAction`, `BacklogItem`, `BacklogLogRow`, `NudgeContext`.

- [ ] **Step 1: Write the file**

Create `lib/backlog/types.ts`:

```ts
export type BacklogCategory =
  | 'car' | 'kitchen' | 'home_maint' | 'outdoor' | 'online' | 'errand' | 'other'

export type BacklogStatus = 'ready' | 'blocked' | 'snoozed' | 'done' | 'dropped'

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night' | 'any'

export type DayPref = 'weekday' | 'weekend' | 'any'

export type BacklogAction =
  | 'suggested' | 'done' | 'snoozed' | 'unblocked' | 'skipped' | 'created'

// Mirrors a backlog_items row (snake_case), same convention as lib/wa/types.ts.
// Date/timestamp columns come back from supabase-js as ISO strings.
export type BacklogItem = {
  id: string
  title: string
  category: BacklogCategory
  status: BacklogStatus
  blocked_by: string | null
  time_of_day: TimeOfDay[]
  day_pref: DayPref
  needs_daylight: boolean
  needs_dry: boolean
  prep_ahead: boolean
  lead_time_hours: number | null
  mutex_group: string | null
  recurring: boolean
  recurrence: string | null
  deadline: string | null        // 'YYYY-MM-DD'
  priority: number
  last_suggested_at: string | null
  last_done_at: string | null
  snooze_until: string | null    // 'YYYY-MM-DD'
  notes: string | null
  created_at: string
}

export type BacklogLogRow = {
  id: string
  item_id: string | null
  action: BacklogAction
  note: string | null
  created_at: string
}

// Everything the pure nudge engine needs about "now", computed by the caller.
export type NudgeContext = {
  slot: TimeOfDay                 // which time-of-day bucket the nudge fires in
  dayType: 'weekday' | 'weekend'
  today: string                  // 'YYYY-MM-DD' in Asia/Jakarta
  now: Date                      // real instant, for the 4-day auto-snooze math
  excludedMutexGroups: string[]  // mutex_groups already suggested/done today
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/backlog/types.ts
git commit -m "feat(backlog): row + context types

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: `lib/backlog/engine.ts` — pure nudge logic (TDD)

**Files:**
- Create: `lib/backlog/engine.ts`
- Test: `lib/backlog/engine.test.ts`

**Interfaces:**
- Consumes: `BacklogItem`, `NudgeContext`, `TimeOfDay` from `./types`; `HOMESPACE_URL` from `../wa/config`; `daysBetween` from `../meals/dates`.
- Produces:
  - `slotForTime(hhmm: string): TimeOfDay`
  - `selectNudgeCandidate(items: BacklogItem[], ctx: NudgeContext): BacklogItem | null`
  - `backlogTail(items: BacklogItem[], today: string): string[]`
  - `composeBacklogNudge(candidate: BacklogItem | null, tailLines: string[]): string | null`

- [ ] **Step 1: Write the failing test**

Create `lib/backlog/engine.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { BacklogItem, NudgeContext } from './types'
import { slotForTime, selectNudgeCandidate, backlogTail, composeBacklogNudge } from './engine'

function item(over: Partial<BacklogItem> & { id: string; title: string }): BacklogItem {
  return {
    category: 'other', status: 'ready', blocked_by: null,
    time_of_day: ['any'], day_pref: 'any',
    needs_daylight: false, needs_dry: false, prep_ahead: false, lead_time_hours: null,
    mutex_group: null, recurring: false, recurrence: null, deadline: null, priority: 0,
    last_suggested_at: null, last_done_at: null, snooze_until: null, notes: null,
    created_at: '2026-08-01T00:00:00Z',
    ...over,
  }
}

function ctx(over: Partial<NudgeContext> = {}): NudgeContext {
  return {
    slot: 'evening', dayType: 'weekday', today: '2026-08-27',
    now: new Date('2026-08-27T12:30:00Z'), excludedMutexGroups: [],
    ...over,
  }
}

describe('slotForTime', () => {
  it('buckets clock times into time-of-day', () => {
    expect(slotForTime('03:00')).toBe('night')
    expect(slotForTime('08:15')).toBe('morning')
    expect(slotForTime('13:00')).toBe('afternoon')
    expect(slotForTime('19:30')).toBe('evening')
    expect(slotForTime('22:45')).toBe('night')
  })
})

describe('selectNudgeCandidate', () => {
  it('returns null for an empty pool', () => {
    expect(selectNudgeCandidate([], ctx())).toBeNull()
  })

  it('picks a matching ready item', () => {
    const got = selectNudgeCandidate([item({ id: 'a', title: 'Bake banana bread' })], ctx())
    expect(got?.id).toBe('a')
  })

  it('excludes items whose snooze_until is still in the future', () => {
    const got = selectNudgeCandidate(
      [item({ id: 'a', title: 'X', snooze_until: '2026-08-28' })],
      ctx({ today: '2026-08-27' }),
    )
    expect(got).toBeNull()
  })

  it('includes an item whose snooze_until is today or past', () => {
    const got = selectNudgeCandidate(
      [item({ id: 'a', title: 'X', snooze_until: '2026-08-27' })],
      ctx({ today: '2026-08-27' }),
    )
    expect(got?.id).toBe('a')
  })

  it('excludes items whose time_of_day does not include the slot (and is not "any")', () => {
    const got = selectNudgeCandidate(
      [item({ id: 'a', title: 'X', time_of_day: ['morning'] })],
      ctx({ slot: 'evening' }),
    )
    expect(got).toBeNull()
  })

  it('excludes weekend-only items on a weekday', () => {
    const got = selectNudgeCandidate(
      [item({ id: 'a', title: 'X', day_pref: 'weekend' })],
      ctx({ dayType: 'weekday' }),
    )
    expect(got).toBeNull()
  })

  it('excludes recurring items from the main pick', () => {
    const got = selectNudgeCandidate(
      [item({ id: 'a', title: 'Taobao', recurring: true, recurrence: 'daily' })],
      ctx(),
    )
    expect(got).toBeNull()
  })

  it('soft-auto-snoozes items suggested within the last 4 days', () => {
    const recent = new Date('2026-08-25T00:00:00Z').toISOString() // 2 days before now
    const got = selectNudgeCandidate(
      [item({ id: 'a', title: 'X', last_suggested_at: recent })],
      ctx({ now: new Date('2026-08-27T00:00:00Z') }),
    )
    expect(got).toBeNull()
  })

  it('re-allows items last suggested more than 4 days ago', () => {
    const old = new Date('2026-08-20T00:00:00Z').toISOString() // 7 days before now
    const got = selectNudgeCandidate(
      [item({ id: 'a', title: 'X', last_suggested_at: old })],
      ctx({ now: new Date('2026-08-27T00:00:00Z') }),
    )
    expect(got?.id).toBe('a')
  })

  it('excludes items in a mutex group already suggested/done today', () => {
    const got = selectNudgeCandidate(
      [item({ id: 'a', title: 'Clean car interior', mutex_group: 'car_clean' })],
      ctx({ excludedMutexGroups: ['car_clean'] }),
    )
    expect(got).toBeNull()
  })

  it('orders by priority desc, then oldest last_suggested_at first (nulls first)', () => {
    const items = [
      item({ id: 'lowprio', title: 'low', priority: 0 }),
      item({ id: 'hi-recent', title: 'hi recent', priority: 2, last_suggested_at: '2026-08-01T00:00:00Z' }),
      item({ id: 'hi-never', title: 'hi never', priority: 2, last_suggested_at: null }),
    ]
    const got = selectNudgeCandidate(items, ctx({ now: new Date('2026-09-15T00:00:00Z') }))
    expect(got?.id).toBe('hi-never')
  })
})

describe('backlogTail', () => {
  it('is empty when nothing is recurring-due or deadline-near', () => {
    expect(backlogTail([item({ id: 'a', title: 'X' })], '2026-08-27')).toEqual([])
  })

  it('emits a countdown line for a deadline within 7 days', () => {
    const lines = backlogTail(
      [item({ id: 'a', title: 'Check Taobao for pizza oven promo', deadline: '2026-09-02' })],
      '2026-08-27',
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('Check Taobao for pizza oven promo')
    expect(lines[0]).toContain('6 days')
  })

  it('does not emit a countdown for a deadline more than 7 days out', () => {
    const lines = backlogTail(
      [item({ id: 'a', title: 'X', deadline: '2026-09-30' })],
      '2026-08-27',
    )
    expect(lines).toEqual([])
  })

  it('emits a plain reminder for a daily-recurring item with no near deadline', () => {
    const lines = backlogTail(
      [item({ id: 'a', title: 'Water the plants', recurring: true, recurrence: 'daily' })],
      '2026-08-27',
    )
    expect(lines).toEqual(['Water the plants'])
  })

  it('for an item that is both recurring-due and deadline-near, emits ONE (countdown) line', () => {
    const lines = backlogTail(
      [item({ id: 'a', title: 'Check Taobao for pizza oven promo', recurring: true, recurrence: 'daily', deadline: '2026-09-02' })],
      '2026-08-27',
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('6 days')
  })
})

describe('composeBacklogNudge', () => {
  it('returns null when there is no candidate and no tail', () => {
    expect(composeBacklogNudge(null, [])).toBeNull()
  })

  it('frames a direct item as "<title> tonight" with the note appended', () => {
    const msg = composeBacklogNudge(item({ id: 'a', title: 'Bake banana bread', notes: 'use the aging bananas' }), [])
    expect(msg).toContain('🔧 Evening idea: bake banana bread tonight')
    expect(msg).toContain('use the aging bananas')
    expect(msg!.endsWith('/backlog')).toBe(true)
  })

  it('frames a prep_ahead item as a prep step that never implies finishable-now, mentioning lead time', () => {
    const msg = composeBacklogNudge(
      item({ id: 'a', title: 'Ninja Creami - rainbow (for son)', prep_ahead: true, lead_time_hours: 24 }),
      [],
    )
    expect(msg).toMatch(/prep .* tonight/i)
    expect(msg).toContain('24h')
    expect(msg).not.toMatch(/\btonight\b.*\bspin (it )?tonight\b/i)
  })

  it('appends tail lines and can be tail-only', () => {
    const msg = composeBacklogNudge(null, ['Check Taobao for pizza oven promo — 6 days left'])
    expect(msg).toContain('Check Taobao for pizza oven promo — 6 days left')
    expect(msg!.endsWith('/backlog')).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- lib/backlog/engine.test.ts`
Expected: FAIL — `engine.ts` has no such exports / module not found.

- [ ] **Step 3: Write the implementation**

Create `lib/backlog/engine.ts`:

```ts
import type { BacklogItem, NudgeContext, TimeOfDay } from './types'
import { HOMESPACE_URL } from '../wa/config'
import { daysBetween } from '../meals/dates'

const AUTO_SNOOZE_DAYS = 4
const DEADLINE_WINDOW_DAYS = 7
const DAY_MS = 86_400_000

// Maps a wall-clock "HH:MM" to its time-of-day bucket. 19:30 -> 'evening'.
export function slotForTime(hhmm: string): TimeOfDay {
  const h = Number(hhmm.split(':')[0])
  if (h < 5) return 'night'
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  if (h < 21) return 'evening'
  return 'night'
}

// Picks at most one backlog item that fits *this* slot/day, or null.
// `items` is the full status='ready' pool; every other status is caller-filtered.
export function selectNudgeCandidate(items: BacklogItem[], ctx: NudgeContext): BacklogItem | null {
  const excluded = new Set(ctx.excludedMutexGroups)

  const eligible = items.filter(it => {
    if (it.status !== 'ready') return false
    if (it.snooze_until && it.snooze_until > ctx.today) return false
    if (!it.time_of_day.includes('any') && !it.time_of_day.includes(ctx.slot)) return false
    if (it.day_pref !== 'any' && it.day_pref !== ctx.dayType) return false
    if (it.recurring) return false
    if (it.last_suggested_at) {
      const ageMs = ctx.now.getTime() - new Date(it.last_suggested_at).getTime()
      if (ageMs < AUTO_SNOOZE_DAYS * DAY_MS) return false
    }
    if (it.mutex_group && excluded.has(it.mutex_group)) return false
    return true
  })

  eligible.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority
    const at = a.last_suggested_at ? new Date(a.last_suggested_at).getTime() : -Infinity
    const bt = b.last_suggested_at ? new Date(b.last_suggested_at).getTime() : -Infinity
    return at - bt // oldest (and null = -Infinity) first
  })

  return eligible[0] ?? null
}

function countdown(today: string, deadline: string): string {
  const n = daysBetween(today, deadline)
  if (n <= 0) return 'today'
  return `${n} day${n === 1 ? '' : 's'} left`
}

// Zero or more short lines appended after the main pick: near-deadline countdowns
// and daily-recurring reminders. An item that is both gets ONE line (the countdown).
export function backlogTail(items: BacklogItem[], today: string): string[] {
  const lines: string[] = []
  for (const it of items) {
    const near = it.deadline != null
      && daysBetween(today, it.deadline) >= 0
      && daysBetween(today, it.deadline) <= DEADLINE_WINDOW_DAYS
    const recurringDue = it.recurring && it.recurrence === 'daily'
    if (near) {
      lines.push(`${it.title} — ${countdown(today, it.deadline!)}`)
    } else if (recurringDue) {
      lines.push(it.title)
    }
  }
  return lines
}

function phraseFor(it: BacklogItem): string {
  const detail = it.notes?.trim() ? ` — ${it.notes.trim()}` : ''
  if (it.prep_ahead) {
    const lead = it.lead_time_hours ? ` (~${it.lead_time_hours}h ahead)` : ''
    return `prep ${it.title.toLowerCase()} tonight, finish it later${lead}${detail}`
  }
  return `${it.title.toLowerCase()} tonight${detail}`
}

// The final message, or null when there's genuinely nothing to say.
export function composeBacklogNudge(candidate: BacklogItem | null, tailLines: string[]): string | null {
  if (!candidate && tailLines.length === 0) return null

  const parts: string[] = []
  if (candidate) parts.push(`🔧 Evening idea: ${phraseFor(candidate)}`)
  for (const line of tailLines) parts.push(`(+ ${line})`)
  parts.push(`${HOMESPACE_URL}/backlog`)
  return parts.join('\n')
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- lib/backlog/engine.test.ts`
Expected: PASS (all ~25 assertions).

- [ ] **Step 5: Full typecheck + test suite**

Run: `npx tsc --noEmit && npm test`
Expected: no errors; the full suite still green.

- [ ] **Step 6: Commit**

```bash
git add lib/backlog/engine.ts lib/backlog/engine.test.ts
git commit -m "feat(backlog): pure nudge engine — select, tail, compose

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: API routes — `POST /api/backlog/items` + `PATCH /api/backlog/items/[id]`

**Files:**
- Create: `app/api/backlog/items/route.ts`
- Create: `app/api/backlog/items/[id]/route.ts`

**Interfaces:**
- Consumes: `supabase` from `@/lib/supabase`; `jakartaToday`, `tomorrowOf` from `@/lib/wa/schedule`.
- Produces: HTTP endpoints the `/backlog` page calls —
  - `POST /api/backlog/items` body `{ title: string, category?: string }` → new `BacklogItem` JSON (400 on blank title).
  - `PATCH /api/backlog/items/[id]` body `{ action: 'done' | 'snooze' | 'arrived' }` OR `{ patch: Record<string, unknown> }` → updated `BacklogItem` JSON.

- [ ] **Step 1: Write the POST route**

Create `app/api/backlog/items/route.ts`:

```ts
import { supabase } from '@/lib/supabase'

const CATEGORIES = ['car', 'kitchen', 'home_maint', 'outdoor', 'online', 'errand', 'other']

export async function POST(request: Request) {
  const { title, category } = await request.json()
  if (!title?.trim()) {
    return Response.json({ error: 'title required' }, { status: 400 })
  }
  const cat = CATEGORIES.includes(category) ? category : 'other'

  const { data, error } = await supabase
    .from('backlog_items')
    .insert({ title: title.trim(), category: cat, status: 'ready' })
    .select()
    .single()
  if (error) return Response.json({ error: error.message }, { status: 500 })

  await supabase.from('backlog_log').insert({ item_id: data.id, action: 'created' })
  return Response.json(data)
}
```

- [ ] **Step 2: Write the PATCH route**

Create `app/api/backlog/items/[id]/route.ts`:

```ts
import { supabase } from '@/lib/supabase'
import { jakartaToday, tomorrowOf } from '@/lib/wa/schedule'

// Columns the inline tag editor is allowed to write directly.
const EDITABLE = [
  'title', 'category', 'status', 'blocked_by', 'time_of_day', 'day_pref',
  'needs_daylight', 'needs_dry', 'prep_ahead', 'lead_time_hours', 'mutex_group',
  'recurring', 'recurrence', 'deadline', 'priority', 'snooze_until', 'notes',
]

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json()

  if (typeof body.action === 'string') return handleAction(id, body.action)

  if (body.patch && typeof body.patch === 'object') {
    const patch = Object.fromEntries(
      Object.entries(body.patch).filter(([k]) => EDITABLE.includes(k)),
    )
    const { data, error } = await supabase
      .from('backlog_items').update(patch).eq('id', id).select().single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json(data)
  }

  return Response.json({ error: 'expected { action } or { patch }' }, { status: 400 })
}

async function handleAction(id: string, action: string) {
  if (action === 'done') {
    const { data, error } = await supabase.from('backlog_items')
      .update({ status: 'done', last_done_at: new Date().toISOString() })
      .eq('id', id).select().single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    await supabase.from('backlog_log').insert({ item_id: id, action: 'done' })
    return Response.json(data)
  }

  if (action === 'snooze') {
    const tomorrow = tomorrowOf(jakartaToday())
    const { data, error } = await supabase.from('backlog_items')
      .update({ snooze_until: tomorrow }) // status stays 'ready' — self-healing
      .eq('id', id).select().single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    await supabase.from('backlog_log').insert({ item_id: id, action: 'snoozed' })
    return Response.json(data)
  }

  if (action === 'arrived') {
    const { data: cur } = await supabase.from('backlog_items')
      .select('blocked_by').eq('id', id).single()
    const { data, error } = await supabase.from('backlog_items')
      .update({ status: 'ready', blocked_by: null })
      .eq('id', id).select().single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    await supabase.from('backlog_log')
      .insert({ item_id: id, action: 'unblocked', note: cur?.blocked_by ?? null })
    return Response.json(data)
  }

  return Response.json({ error: `unknown action: ${action}` }, { status: 400 })
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual verification (dev server + curl)**

Start the dev server (`npm run dev`) in a separate terminal, then:

```bash
# quick-add
curl -s -XPOST localhost:3000/api/backlog/items \
  -H 'content-type: application/json' -d '{"title":"  Test item  ","category":"errand"}' | jq
# -> row with title "Test item", category "errand", status "ready"

# grab an id from the seed (a ready, non-blocked one), e.g. "Bake banana bread"
ID=$(curl ... ) # or read from Supabase; then:

# done
curl -s -XPATCH "localhost:3000/api/backlog/items/$ID" \
  -H 'content-type: application/json' -d '{"action":"done"}' | jq '.status, .last_done_at'
# -> "done", a timestamp

# tag edit
curl -s -XPATCH "localhost:3000/api/backlog/items/$ID" \
  -H 'content-type: application/json' -d '{"patch":{"priority":5,"status":"ready"}}' | jq '.priority, .status'
# -> 5, "ready"
```

Then in Supabase `execute_sql`:
```sql
select action, note from backlog_log order by created_at desc limit 5;
```
Expected: `created`, `done` entries present; an `unblocked` entry (once you test `arrived` on a blocked seed row) carries the old `blocked_by` text in `note`.

Clean up the test row:
```sql
delete from backlog_items where title = 'Test item';
```
(and reset any seed row you mutated, e.g. `update backlog_items set status='ready', last_done_at=null, priority=1 where title='Bake banana bread';`)

- [ ] **Step 5: Commit**

```bash
git add app/api/backlog/items/route.ts "app/api/backlog/items/[id]/route.ts"
git commit -m "feat(backlog): quick-add + action/patch API routes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: `/backlog` page — RSC + client + tag editor + home card

**Files:**
- Create: `app/backlog/page.tsx`
- Create: `components/backlog/BacklogClient.tsx`
- Create: `components/backlog/TagEditor.tsx`
- Modify: `app/page.tsx` (add the Backlog card)

**Interfaces:**
- Consumes: `supabase` from `@/lib/supabase`; `BacklogItem`, `BacklogCategory`, `BacklogStatus`, `TimeOfDay` from `@/lib/backlog/types`; the API routes from Task 4.
- Produces: a navigable page at `/backlog`.

- [ ] **Step 1: Write the server component**

Create `app/backlog/page.tsx`:

```tsx
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { supabase } from '@/lib/supabase'
import type { BacklogItem } from '@/lib/backlog/types'
import BacklogClient from '@/components/backlog/BacklogClient'

export default async function BacklogPage() {
  const { data } = await supabase
    .from('backlog_items')
    .select('*')
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
  return <BacklogClient initialItems={(data ?? []) as BacklogItem[]} />
}
```

- [ ] **Step 2: Write the tag editor**

Create `components/backlog/TagEditor.tsx`:

```tsx
'use client'
import { useState } from 'react'
import type { BacklogItem, TimeOfDay } from '@/lib/backlog/types'

const CATEGORIES = ['car', 'kitchen', 'home_maint', 'outdoor', 'online', 'errand', 'other']
const STATUSES = ['ready', 'blocked', 'snoozed', 'done', 'dropped']
const DAY_PREFS = ['any', 'weekday', 'weekend']
const TIMES: TimeOfDay[] = ['morning', 'afternoon', 'evening', 'night', 'any']

export default function TagEditor({ item, onSave, onCancel }: {
  item: BacklogItem
  onSave: (patch: Partial<BacklogItem>) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<BacklogItem>(item)
  const set = <K extends keyof BacklogItem>(k: K, v: BacklogItem[K]) =>
    setDraft(d => ({ ...d, [k]: v }))

  function toggleTime(t: TimeOfDay) {
    const has = draft.time_of_day.includes(t)
    set('time_of_day', (has
      ? draft.time_of_day.filter(x => x !== t)
      : [...draft.time_of_day, t]) as TimeOfDay[])
  }

  function save() {
    onSave({
      title: draft.title.trim(),
      category: draft.category,
      status: draft.status,
      blocked_by: draft.blocked_by?.trim() || null,
      time_of_day: draft.time_of_day.length ? draft.time_of_day : (['any'] as TimeOfDay[]),
      day_pref: draft.day_pref,
      needs_daylight: draft.needs_daylight,
      needs_dry: draft.needs_dry,
      prep_ahead: draft.prep_ahead,
      lead_time_hours: draft.lead_time_hours,
      mutex_group: draft.mutex_group?.trim() || null,
      recurring: draft.recurring,
      recurrence: draft.recurrence?.trim() || null,
      deadline: draft.deadline || null,
      priority: Number(draft.priority) || 0,
      snooze_until: draft.snooze_until || null,
      notes: draft.notes?.trim() || null,
    })
  }

  const field = 'border border-stone-200 rounded-lg px-2 py-1 text-sm w-full'

  return (
    <div className="mt-3 grid gap-3 rounded-lg bg-stone-50 border border-stone-200 p-3 text-sm">
      <label className="grid gap-1">
        <span className="text-xs text-stone-500">Title</span>
        <input className={field} value={draft.title} onChange={e => set('title', e.target.value)} />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1">
          <span className="text-xs text-stone-500">Category</span>
          <select className={field} value={draft.category}
            onChange={e => set('category', e.target.value as BacklogItem['category'])}>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-stone-500">Status</span>
          <select className={field} value={draft.status}
            onChange={e => set('status', e.target.value as BacklogItem['status'])}>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>

      <label className="grid gap-1">
        <span className="text-xs text-stone-500">Blocked by</span>
        <input className={field} value={draft.blocked_by ?? ''}
          onChange={e => set('blocked_by', e.target.value)} placeholder="awaiting: …" />
      </label>

      <div className="grid gap-1">
        <span className="text-xs text-stone-500">Time of day</span>
        <div className="flex flex-wrap gap-2">
          {TIMES.map(t => (
            <button key={t} type="button" onClick={() => toggleTime(t)}
              className={`px-2 py-1 rounded-full text-xs border ${
                draft.time_of_day.includes(t)
                  ? 'bg-orange-500 text-white border-orange-500'
                  : 'bg-white text-stone-600 border-stone-200'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1">
          <span className="text-xs text-stone-500">Day preference</span>
          <select className={field} value={draft.day_pref}
            onChange={e => set('day_pref', e.target.value as BacklogItem['day_pref'])}>
            {DAY_PREFS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-stone-500">Priority</span>
          <input type="number" className={field} value={draft.priority}
            onChange={e => set('priority', Number(e.target.value) as BacklogItem['priority'])} />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1">
          <span className="text-xs text-stone-500">Deadline</span>
          <input type="date" className={field} value={draft.deadline ?? ''}
            onChange={e => set('deadline', e.target.value as BacklogItem['deadline'])} />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-stone-500">Snooze until</span>
          <input type="date" className={field} value={draft.snooze_until ?? ''}
            onChange={e => set('snooze_until', e.target.value as BacklogItem['snooze_until'])} />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1">
          <span className="text-xs text-stone-500">Lead time (hours)</span>
          <input type="number" className={field} value={draft.lead_time_hours ?? ''}
            onChange={e => set('lead_time_hours',
              (e.target.value === '' ? null : Number(e.target.value)) as BacklogItem['lead_time_hours'])} />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-stone-500">Mutex group</span>
          <input className={field} value={draft.mutex_group ?? ''}
            onChange={e => set('mutex_group', e.target.value as BacklogItem['mutex_group'])} />
        </label>
      </div>

      <label className="grid gap-1">
        <span className="text-xs text-stone-500">Recurrence (e.g. "daily")</span>
        <input className={field} value={draft.recurrence ?? ''}
          onChange={e => set('recurrence', e.target.value as BacklogItem['recurrence'])} />
      </label>

      <div className="flex flex-wrap gap-4">
        {(['needs_daylight', 'needs_dry', 'prep_ahead', 'recurring'] as const).map(k => (
          <label key={k} className="flex items-center gap-1.5 text-xs text-stone-600">
            <input type="checkbox" checked={draft[k]} onChange={e => set(k, e.target.checked)} />
            {k.replace(/_/g, ' ')}
          </label>
        ))}
      </div>

      <label className="grid gap-1">
        <span className="text-xs text-stone-500">Notes</span>
        <textarea className={field} rows={2} value={draft.notes ?? ''}
          onChange={e => set('notes', e.target.value)} />
      </label>

      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-sm text-stone-500 hover:bg-stone-200">
          Cancel
        </button>
        <button onClick={save} className="px-3 py-1.5 rounded-lg text-sm bg-orange-500 text-white hover:bg-orange-600">
          Save
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Write the client**

Create `components/backlog/BacklogClient.tsx`:

```tsx
'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, Clock, PackageCheck, Pencil, Plus, RotateCcw } from 'lucide-react'
import type { BacklogItem } from '@/lib/backlog/types'
import TagEditor from './TagEditor'

const CATEGORIES = ['car', 'kitchen', 'home_maint', 'outdoor', 'online', 'errand', 'other']

function todayJakarta(): string {
  const shifted = new Date(Date.now() + 7 * 3600_000)
  return shifted.toISOString().slice(0, 10)
}

type Section = { key: string; title: string; items: BacklogItem[] }

export default function BacklogClient({ initialItems }: { initialItems: BacklogItem[] }) {
  const [items, setItems] = useState<BacklogItem[]>(initialItems)
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showDone, setShowDone] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newCategory, setNewCategory] = useState('other')
  const today = todayJakarta()

  const sections = useMemo<Section[]>(() => {
    const snoozed = items.filter(i => i.status === 'ready' && i.snooze_until && i.snooze_until > today)
    const ready = items.filter(i => i.status === 'ready' && !(i.snooze_until && i.snooze_until > today))
    const blocked = items.filter(i => i.status === 'blocked')
    const done = items.filter(i => i.status === 'done')
      .sort((a, b) => (b.last_done_at ?? '').localeCompare(a.last_done_at ?? ''))
      .slice(0, 20)
    return [
      { key: 'ready', title: 'Ready', items: ready },
      { key: 'blocked', title: 'Blocked', items: blocked },
      { key: 'snoozed', title: 'Snoozed', items: snoozed },
      { key: 'done', title: 'Done', items: done },
    ]
  }, [items, today])

  function replace(row: BacklogItem) {
    setItems(list => list.map(i => (i.id === row.id ? row : i)))
  }

  async function act(id: string, action: 'done' | 'snooze' | 'arrived') {
    setBusy(true)
    try {
      const res = await fetch(`/api/backlog/items/${id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (res.ok) replace(await res.json())
    } finally { setBusy(false) }
  }

  async function savePatch(id: string, patch: Partial<BacklogItem>) {
    setBusy(true)
    try {
      const res = await fetch(`/api/backlog/items/${id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ patch }),
      })
      if (res.ok) { replace(await res.json()); setEditingId(null) }
    } finally { setBusy(false) }
  }

  async function addItem() {
    if (!newTitle.trim()) return
    setBusy(true)
    try {
      const res = await fetch('/api/backlog/items', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: newTitle, category: newCategory }),
      })
      if (res.ok) {
        setItems(list => [await res.json(), ...list])
        setNewTitle('')
      }
    } finally { setBusy(false) }
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="bg-white border-b border-stone-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link href="/" className="text-stone-400 hover:text-stone-600 transition-colors">
            <ArrowLeft size={18} />
          </Link>
          <h1 className="text-xl font-semibold text-stone-900" style={{ fontFamily: 'DM Serif Display, serif' }}>
            Backlog
          </h1>
          {busy && <span className="text-xs text-stone-400 ml-auto">Saving…</span>}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        <div className="flex gap-2">
          <input
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addItem() }}
            placeholder="Add something to the pile…"
            className="flex-1 border border-stone-200 rounded-lg px-3 py-2 text-sm"
          />
          <select value={newCategory} onChange={e => setNewCategory(e.target.value)}
            className="border border-stone-200 rounded-lg px-2 py-2 text-sm">
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button onClick={addItem} disabled={busy}
            className="px-3 py-2 rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50">
            <Plus size={16} />
          </button>
        </div>

        {sections.map(section => {
          if (section.items.length === 0) return null
          const collapsed = section.key === 'done' && !showDone
          return (
            <section key={section.key}>
              <button
                className="text-xs font-medium uppercase tracking-wide text-stone-400 mb-2"
                onClick={() => section.key === 'done' && setShowDone(s => !s)}
              >
                {section.title} ({section.items.length}){section.key === 'done' ? (showDone ? ' ▾' : ' ▸') : ''}
              </button>
              {!collapsed && (
                <div className="space-y-2">
                  {section.items.map(it => (
                    <div key={it.id} className="bg-white border border-stone-200 rounded-xl p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium text-stone-900">{it.title}</p>
                          <p className="text-xs text-stone-400 mt-0.5">
                            {it.category}
                            {it.priority > 0 && ` · priority ${it.priority}`}
                            {it.day_pref !== 'any' && ` · ${it.day_pref}`}
                            {!it.time_of_day.includes('any') && ` · ${it.time_of_day.join('/')}`}
                          </p>
                          {it.blocked_by && <p className="text-xs text-amber-600 mt-1">{it.blocked_by}</p>}
                          {it.notes && <p className="text-sm text-stone-500 mt-1">{it.notes}</p>}
                          {it.snooze_until && it.snooze_until > today &&
                            <p className="text-xs text-stone-400 mt-1">snoozed until {it.snooze_until}</p>}
                        </div>
                        <div className="flex shrink-0 gap-1">
                          {section.key !== 'done' && (
                            <button title="Edit tags" onClick={() => setEditingId(id => id === it.id ? null : it.id)}
                              className="p-1.5 rounded-lg text-stone-400 hover:bg-stone-100">
                              <Pencil size={15} />
                            </button>
                          )}
                          {section.key === 'blocked' && (
                            <button title="Arrived / unblock" onClick={() => act(it.id, 'arrived')}
                              className="p-1.5 rounded-lg text-green-600 hover:bg-green-50">
                              <PackageCheck size={15} />
                            </button>
                          )}
                          {(section.key === 'ready' || section.key === 'snoozed') && (
                            <button title="Mark done" onClick={() => act(it.id, 'done')}
                              className="p-1.5 rounded-lg text-green-600 hover:bg-green-50">
                              <Check size={15} />
                            </button>
                          )}
                          {section.key === 'ready' && (
                            <button title="Snooze to tomorrow" onClick={() => act(it.id, 'snooze')}
                              className="p-1.5 rounded-lg text-stone-400 hover:bg-stone-100">
                              <Clock size={15} />
                            </button>
                          )}
                          {section.key === 'snoozed' && (
                            <button title="Un-snooze" onClick={() => savePatch(it.id, { snooze_until: null })}
                              className="p-1.5 rounded-lg text-stone-400 hover:bg-stone-100">
                              <RotateCcw size={15} />
                            </button>
                          )}
                        </div>
                      </div>
                      {editingId === it.id && (
                        <TagEditor
                          item={it}
                          onSave={patch => savePatch(it.id, patch)}
                          onCancel={() => setEditingId(null)}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </main>
    </div>
  )
}
```

- [ ] **Step 4: Add the home-page card**

In `app/page.tsx`, add `ListTodo` to the `lucide-react` import, and add this entry to the `features` array (after the Meals entry, before Notifications):

```tsx
  {
    href: '/backlog',
    icon: ListTodo,
    label: 'Backlog',
    description: 'One nudge a day for the someday pile',
    color: 'bg-rose-50 text-rose-600',
  },
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Manual verification (browser)**

With `npm run dev` running, open `http://localhost:3000/backlog`:
- The 12 seed items render: Ready (7), Blocked (3 — pizza dough, chocolate creami, marinade meals), Snoozed (0, section hidden), Done (0, hidden).
- Quick-add "Test chore" / errand → appears at top of Ready instantly; reload → still there.
- On a Ready row, click the clock (Snooze) → row moves to a new "Snoozed" section showing "snoozed until <tomorrow>"; reload → still snoozed.
- Un-snooze that row → back in Ready.
- On a Blocked row, click the box (Arrived) → moves to Ready, `blocked_by` text gone; reload → persists.
- Click the pencil on a Ready row → editor opens; change priority to 9, Save → row's meta line shows "priority 9"; reload → persists.
- Click Done on the test row → moves into Done; expand Done section (click header) to see it.
- Home page (`/`) shows a "Backlog" card linking to `/backlog`.

Clean up: `delete from backlog_items where title in ('Test chore');` and reset any seed rows you mutated.

- [ ] **Step 7: Commit**

```bash
git add app/backlog components/backlog app/page.tsx
git commit -m "feat(backlog): /backlog page — sections, quick-add, actions, tag editor

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: Cron integration — `queries.ts` + `lib/wa` wiring + build phase + test mode

**Files:**
- Create: `lib/backlog/queries.ts`
- Modify: `lib/wa/types.ts`
- Modify: `lib/wa/settings.ts`
- Modify: `lib/wa/schedule.ts`
- Modify: `app/api/wa/settings/route.ts`
- Modify: `app/api/wa/cron/route.ts`

**Interfaces:**
- Consumes: `supabase` from `@/lib/supabase`; `jakartaDateTimeToUtcIso` from `@/lib/wa/schedule`; `selectNudgeCandidate`, `backlogTail`, `composeBacklogNudge`, `slotForTime` from `@/lib/backlog/engine`; `WA_NUMBERS` from `@/lib/wa/config`; existing `upsertOutbound` / `jakartaToday` in the cron route.
- Produces:
  - `fetchReadyPool(): Promise<BacklogItem[]>`
  - `fetchActiveItems(): Promise<BacklogItem[]>`
  - `fetchExcludedMutexGroups(sinceIso: string): Promise<string[]>`
  - `markSuggested(itemId: string, nowIso: string): Promise<void>`
  - `isWeekend(dateStr: string): boolean` (from `lib/wa/schedule.ts`)
  - a `wa_outbound` row with `kind='backlog_nudge'` when a nudge is due.

- [ ] **Step 1: Write `lib/backlog/queries.ts`**

```ts
import { supabase } from '@/lib/supabase'
import type { BacklogItem } from './types'

export async function fetchReadyPool(): Promise<BacklogItem[]> {
  const { data } = await supabase.from('backlog_items').select('*').eq('status', 'ready')
  return (data ?? []) as BacklogItem[]
}

export async function fetchActiveItems(): Promise<BacklogItem[]> {
  const { data } = await supabase.from('backlog_items').select('*')
    .not('status', 'in', '(done,dropped)')
  return (data ?? []) as BacklogItem[]
}

// mutex_groups belonging to items that were suggested or done since `sinceIso`
// (today 00:00 Asia/Jakarta as a UTC instant) — those groups are off-limits today.
export async function fetchExcludedMutexGroups(sinceIso: string): Promise<string[]> {
  const { data } = await supabase.from('backlog_log')
    .select('backlog_items(mutex_group)')
    .in('action', ['suggested', 'done'])
    .gte('created_at', sinceIso)
  type Row = { backlog_items: { mutex_group: string | null } | null }
  const groups = ((data ?? []) as unknown as Row[])
    .map(r => r.backlog_items?.mutex_group)
    .filter((g): g is string => !!g)
  return [...new Set(groups)]
}

export async function markSuggested(itemId: string, nowIso: string): Promise<void> {
  await supabase.from('backlog_items').update({ last_suggested_at: nowIso }).eq('id', itemId)
  await supabase.from('backlog_log').insert({ item_id: itemId, action: 'suggested' })
}
```

- [ ] **Step 2: Extend `lib/wa/types.ts`**

Change the `WaOutboundKind` union and add two `WaSettings` fields:

```ts
export type WaOutboundKind = 'weekly_shopping' | 'daily_reminder' | 'prep_thaw' | 'backlog_nudge'
```

In `WaSettings`, add after `prep_time`:

```ts
  backlog_enabled: boolean
  backlog_time: string
```

- [ ] **Step 3: Extend `lib/wa/settings.ts` DEFAULTS**

```ts
const DEFAULTS = {
  weekly_enabled: true, weekly_time: '09:00', weekly_cutoff_dow: 4,
  daily_enabled: true, daily_time: '17:30',
  prep_enabled: true, prep_time: '19:30',
  backlog_enabled: true, backlog_time: '19:30',
  include_kevin: false,
}
```

- [ ] **Step 4: Export `isWeekend` from `lib/wa/schedule.ts`**

`dowMonBased` is already defined in that file (module-private, `Mon=0 .. Sun=6`). Add below it:

```ts
// Saturday or Sunday in Asia/Jakarta terms.
export function isWeekend(dateStr: string): boolean {
  return dowMonBased(dateStr) >= 5
}
```

- [ ] **Step 5: Extend `app/api/wa/settings/route.ts` FIELDS**

```ts
const FIELDS = [
  'weekly_enabled', 'weekly_time', 'weekly_cutoff_dow', 'daily_enabled', 'daily_time',
  'prep_enabled', 'prep_time', 'backlog_enabled', 'backlog_time', 'include_kevin',
]
```

- [ ] **Step 6: Wire the build phase into `app/api/wa/cron/route.ts`**

Add imports at the top (alongside the existing ones):

```ts
import { WA_NUMBERS } from '@/lib/wa/config'
import { isWeekend } from '@/lib/wa/schedule'
import { selectNudgeCandidate, backlogTail, composeBacklogNudge, slotForTime } from '@/lib/backlog/engine'
import { fetchReadyPool, fetchActiveItems, fetchExcludedMutexGroups, markSuggested } from '@/lib/backlog/queries'
import type { BacklogItem } from '@/lib/backlog/types'
```

Update `kindEnabled`:

```ts
function kindEnabled(kind: WaOutboundKind, settings: WaSettings): boolean {
  if (kind === 'weekly_shopping') return settings.weekly_enabled
  if (kind === 'daily_reminder') return settings.daily_enabled
  if (kind === 'prep_thaw') return settings.prep_enabled
  return settings.backlog_enabled
}
```

In the `GET` handler, add this block **after** the `if (settings.prep_enabled) { … }` block and **before** the `const { data: due } = await supabase.from('wa_outbound')…` sender:

```ts
  if (settings.backlog_enabled) {
    try {
      const slot = slotForTime(settings.backlog_time)
      const dayType = isWeekend(today) ? 'weekend' : 'weekday'
      const nowIso = new Date().toISOString()
      const sinceIso = jakartaDateTimeToUtcIso(today, '00:00')
      const [pool, active, excludedMutexGroups] = await Promise.all([
        fetchReadyPool(), fetchActiveItems(), fetchExcludedMutexGroups(sinceIso),
      ])
      const candidate = selectNudgeCandidate(pool, {
        slot, dayType, today, now: new Date(), excludedMutexGroups,
      })
      const message = composeBacklogNudge(candidate, backlogTail(active, today))
      if (message) {
        const sendAt = jakartaDateTimeToUtcIso(today, settings.backlog_time)
        const result = await upsertOutbound('backlog_nudge', today, sendAt, [WA_NUMBERS.kevin], message)
        if (result === 'built') {
          if (candidate) await markSuggested(candidate.id, nowIso)
          built++
        } else {
          skipped++
        }
      } else {
        skipped++
      }
    } catch (err) {
      console.error('backlog_nudge build failed:', err)
      skipped++
    }
  }
```

- [ ] **Step 7: Add a test-mode sample to `runTestMode` in the same file**

Add this constant near the other `SAMPLE_*` constants:

```ts
const SAMPLE_BACKLOG_ITEM: BacklogItem = {
  id: 'sample', title: 'Bake banana bread', category: 'kitchen', status: 'ready',
  blocked_by: null, time_of_day: ['any'], day_pref: 'any',
  needs_daylight: false, needs_dry: false, prep_ahead: false, lead_time_hours: null,
  mutex_group: null, recurring: false, recurrence: null, deadline: null, priority: 1,
  last_suggested_at: null, last_done_at: null, snooze_until: null,
  notes: 'use the aging bananas', created_at: '2026-08-01T00:00:00Z',
}
```

In `runTestMode`, after the `prepMessage` block and before the send loop, add:

```ts
  const backlogPool = await fetchReadyPool()
  const backlogActive = await fetchActiveItems()
  const backlogCandidate = selectNudgeCandidate(backlogPool, {
    slot: slotForTime('19:30'),
    dayType: isWeekend(today) ? 'weekend' : 'weekday',
    today, now: new Date(), excludedMutexGroups: [],
  })
  const backlogMessage = composeBacklogNudge(backlogCandidate, backlogTail(backlogActive, today))
    ?? (composeBacklogNudge(SAMPLE_BACKLOG_ITEM, [])! + SAMPLE_TAG)
```

And add `['backlog_nudge', backlogMessage]` to the `for (const [kind, message] of [ … ] as const)` array in that function.

- [ ] **Step 8: Typecheck + tests**

Run: `npx tsc --noEmit && npm test`
Expected: no errors; full suite green (no new tests here — engine tests from Task 3 cover the pure parts).

- [ ] **Step 9: Manual verification — test mode**

With `npm run dev` running and `CRON_SECRET` known (`grep CRON_SECRET .env.local`):

```bash
curl -s "http://localhost:3000/api/wa/cron?secret=<SECRET>&test=1&to=<your-whatsapp-+62...>" | jq
```
Expected: JSON `{ sent: { weekly_shopping: true, daily_reminder: true, prep_thaw: true, backlog_nudge: true } }`, and a WhatsApp message arrives starting `🔧 Evening idea:` and ending with `.../backlog`. With the untouched seed pool, the candidate is "Ninja Creami - rainbow (for son)" (priority 2, prep_ahead) → phrased as a prep step mentioning 24h; plus a tail line for the Taobao 9.9 deadline.

- [ ] **Step 10: Manual verification — real enqueue + dedupe**

```bash
curl -s "http://localhost:3000/api/wa/cron?secret=<SECRET>" | jq
```
Then in Supabase `execute_sql`:

```sql
select kind, ref_date, send_at, recipients, sent, message from wa_outbound
where kind = 'backlog_nudge' order by created_at desc limit 1;
```
Expected: one row, `recipients = {+6282242382604}`, `send_at` = today 19:30 Asia/Jakarta converted to UTC (12:30Z), `sent = false`, `message` starts `🔧 Evening idea:`.

```sql
select bi.title, bl.action from backlog_log bl
join backlog_items bi on bi.id = bl.item_id
where bl.action = 'suggested' order by bl.created_at desc limit 1;
```
Expected: one `suggested` row for the candidate; that item's `last_suggested_at` is now set.

Run the same curl again:
```bash
curl -s "http://localhost:3000/api/wa/cron?secret=<SECRET>" | jq
```
```sql
select count(*) from wa_outbound where kind = 'backlog_nudge' and ref_date = current_date;
select count(*) from backlog_log where action = 'suggested';
```
Expected: both counts unchanged — no second enqueue, no second log row (dedupe works).

Clean up the test enqueue so it doesn't actually send:
```sql
delete from wa_outbound where kind = 'backlog_nudge' and sent = false;
update backlog_items set last_suggested_at = null where title = 'Ninja Creami - rainbow (for son)';
delete from backlog_log where action = 'suggested';
```

- [ ] **Step 11: Commit**

```bash
git add lib/backlog/queries.ts lib/wa/types.ts lib/wa/settings.ts lib/wa/schedule.ts \
  app/api/wa/settings/route.ts app/api/wa/cron/route.ts
git commit -m "feat(backlog): daily nudge — cron build phase, dedupe, test mode

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: `/settings` — backlog nudge toggle + time

**Files:**
- Modify: `components/settings/WaSettingsClient.tsx`

**Interfaces:**
- Consumes: `WaSettings` (now with `backlog_enabled` / `backlog_time` from Task 6); the existing `/api/wa/settings` PATCH (already whitelists the new fields from Task 6 Step 5).
- Produces: a 4th toggle+time row on `/settings`.

- [ ] **Step 1: Add the row**

In `components/settings/WaSettingsClient.tsx`, extend the `Row` type's `key` union and the `ROWS` array:

```ts
type Row = {
  key: 'weekly' | 'daily' | 'prep' | 'backlog'
  label: string
  description: string
}

const ROWS: Row[] = [
  { key: 'weekly', label: 'Weekly shopping list', description: 'Saturday morning, a flat ingredient list' },
  { key: 'daily', label: 'Daily meal reminder', description: "Tomorrow's meals, sent the evening before" },
  { key: 'prep', label: 'Prep/thaw reminder', description: 'Batches same-evening thaw & marinate prep' },
  { key: 'backlog', label: 'Backlog nudge', description: 'One evening chore suggestion that fits the moment' },
]
```

No other change — the existing `${key}_enabled` / `${key}_time` rendering loop wires `backlog_enabled` / `backlog_time` automatically.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Manual verification (browser)**

With `npm run dev`, open `http://localhost:3000/settings`:
- A "Backlog nudge" row appears with a time input showing `19:30` and an orange (enabled) toggle.
- Change the time to `20:00` → network tab shows `PATCH /api/wa/settings` with `{ backlog_time: "20:00" }`; reload → still `20:00`.
- Toggle it off → `{ backlog_enabled: false }`; reload → still off. Toggle back on.

Reset:
```sql
update wa_settings set backlog_time = '19:30', backlog_enabled = true;
```

- [ ] **Step 4: Commit**

```bash
git add components/settings/WaSettingsClient.tsx
git commit -m "feat(backlog): settings row for the backlog nudge

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck + test suite**

Run: `npx tsc --noEmit && npm test`
Expected: clean; engine tests green.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no new errors in `lib/backlog/**`, `components/backlog/**`, `app/backlog/**`.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build succeeds; `/backlog` listed as a route (ƒ dynamic).

- [ ] **Step 4: End-to-end smoke (browser + curl)**

- `/` → Backlog card → `/backlog` loads with seed data.
- Quick-add, Done, Snooze, Un-snooze, Arrived, tag-edit each persist across reload (per Task 5 Step 6).
- `curl "…/api/wa/cron?secret=<SECRET>&test=1&to=<phone>"` → backlog sample delivered.
- Confirm no stray unsent `wa_outbound` `backlog_nudge` rows and no stray `suggested` log rows remain from testing:
  ```sql
  select * from wa_outbound where kind='backlog_nudge';
  select * from backlog_log where action='suggested';
  ```
  Delete any left over from manual runs.

- [ ] **Step 5: Confirm seed integrity**

```sql
select count(*) from backlog_items;                                  -- 12 (+ any real adds)
select title from backlog_items where last_suggested_at is not null; -- none, unless a real nudge has fired
```

- [ ] **Step 6: Final commit (if anything changed) / done**

If steps produced fixes, commit them. Otherwise the feature is complete across Tasks 1–7.

---

## Self-Review

**1. Spec coverage:**

| Spec section | Task |
|--------------|------|
| §3.1–3.4 tables/indexes/RLS/seed | Task 1 |
| §3.5 `wa_settings` columns | Task 1 (Step 1), Task 6 (types/defaults/FIELDS) |
| §4.1 types | Task 2 |
| §4.2 `slotForTime` / `selectNudgeCandidate` / `backlogTail` / `composeBacklogNudge` | Task 3 |
| §4.3 `queries.ts` (`fetchReadyPool`, `fetchActiveItems`, `fetchExcludedMutexGroups`, `markSuggested`) | Task 6 |
| §5.1 `WaOutboundKind` / `WaSettings` / `DEFAULTS` / `FIELDS` / `kindEnabled` | Task 6 |
| §5.2 build phase + enqueue-time `markSuggested` | Task 6 |
| §5.3 test mode sample | Task 6 (Step 7) |
| §6.1 `app/backlog/page.tsx` (force-dynamic, revalidate 0) | Task 5 |
| §6.2 `BacklogClient` sections + quick-add + actions | Task 5 |
| §6.3 `TagEditor` inline edit | Task 5 |
| §7.1 `POST /api/backlog/items` | Task 4 |
| §7.2 `PATCH /api/backlog/items/[id]` (`action` + `patch`) | Task 4 |
| §7.3 drop via `patch` (no DELETE route) | Task 4 (EDITABLE includes `status`) |
| §8 home-page card | Task 5 (Step 4) |
| §9 `/settings` row | Task 7 |
| §10 unit + manual tests | Task 3 (unit), Tasks 4/5/6/7 (manual), Task 8 (full pass) |
| D1 Kevin-only recipient | Task 6 (`[WA_NUMBERS.kevin]`) |
| D2 English | Task 3 (`composeBacklogNudge`) |
| D5 mark at enqueue | Task 6 (Step 6, `result === 'built'`) |
| D6 Arrived clears `blocked_by`, logs old value | Task 4 (`handleAction` `arrived`) |
| D6b Snooze keeps `status='ready'` | Task 4 (`handleAction` `snooze`), Task 5 (sections) |

No gaps.

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N" — every code step has literal content. Manual-verification steps name exact curls, SQL, and expected values.

**3. Type consistency:**
- `selectNudgeCandidate(items, ctx)` — 2 args, same signature in Task 3 (def + tests), Task 6 (build phase + test mode).
- `NudgeContext` fields (`slot`, `dayType`, `today`, `now`, `excludedMutexGroups`) — identical in Task 2 (def), Task 3 (tests), Task 6 (call sites).
- `composeBacklogNudge(candidate, tailLines)` returns `string | null` — Task 3 def, Task 6 uses `?? (… + SAMPLE_TAG)` and `if (message)`.
- `markSuggested(itemId, nowIso)` — Task 6 def and call match.
- `fetchExcludedMutexGroups(sinceIso)` — Task 6 def takes an ISO string; build phase passes `jakartaDateTimeToUtcIso(today, '00:00')`. ✓
- `isWeekend(dateStr)` — added in Task 6 Step 4, used in the same task's Steps 6–7. ✓
- `BacklogItem` shape used by the `SAMPLE_BACKLOG_ITEM` literal (Task 6) matches the Task 2 definition field-for-field.
- API route `{ action }` values `'done' | 'snooze' | 'arrived'` — Task 4 def, Task 5 `act()` calls. ✓
- `WaOutboundKind` gains `'backlog_nudge'` (Task 6 Step 2) before it's used in `upsertOutbound('backlog_nudge', …)` (Task 6 Step 6) and `kindEnabled` (Step 6). ✓

Consistent.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-08-27-backlog-module.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
