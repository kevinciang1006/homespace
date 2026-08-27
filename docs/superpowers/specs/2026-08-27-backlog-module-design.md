# Backlog Module — Design Spec

**Date:** 2026-08-27
**Brief:** `docs/homespace-backlog-brief.md`
**Status:** approved for planning

A tagged personal-chore backlog plus one context-aware WhatsApp nudge per day.
Lives inside Homespace (existing repo + Supabase project `eelcqdkkefhvoloiikka`).
Reuses the existing WhatsApp push layer (`app/api/wa/cron/route.ts` + `wa_outbound`
queue + `wa_settings` singleton). No new app, no new scheduler.

**Core rule:** capture is frictionless; surfacing is cadence-aware and capped at
ONE item. The nudge fires ~19:30 Asia/Jakarta, suggests a single chore that fits
*this* slot, and stays silent if nothing fits. Notification fatigue is the
failure mode.

---

## 1. Scope

**In (v0):**

- Migration + seed: `backlog_items`, `backlog_log`, indexes, RLS, the 12 seeded items.
- `wa_settings` extension: `backlog_enabled`, `backlog_time`.
- Pure nudge engine (`lib/backlog/engine.ts`) with unit tests.
- Nudge build phase wired into the existing `app/api/wa/cron/route.ts`.
- `/backlog` page: grouped list, quick-add, per-row actions (Done / Snooze /
  Arrived), inline tag edit.
- Backlog API routes for the page's mutations.
- Home-page card linking to `/backlog`.
- `/settings` control for the backlog nudge toggle + time.

**Out (deferred):**

- v0.1 OpenClaw WhatsApp-reply skill (`done` / `X arrived` / `snooze` by reply).
- Real weather gating of `needs_dry` / `needs_daylight` items (they self-gate via
  `weekend` + `morning` tags for now).
- The once-weekly "everything's blocked" summary.

## 2. Decisions

| # | Decision |
|---|----------|
| D1 | Nudge recipient: **Kevin only** (`WA_NUMBERS.kevin`, `+6282242382604`). Not the wife, not `include_kevin`-gated. |
| D2 | Nudge language: **English**, matching the brief's sample. All other WA nudges stay Indonesian; this one is deliberately different. |
| D3 | Plumbing: **reuse** the WA cron + `wa_outbound` queue. New `WaOutboundKind` value `'backlog_nudge'`. Dedupe key `(kind, ref_date=today)`. |
| D4 | Settings live on the **`wa_settings` singleton** (`backlog_enabled bool default true`, `backlog_time text default '19:30'`), surfaced on the existing `/settings` page. |
| D5 | `last_suggested_at` + `backlog_log` `suggested` are written **at enqueue time** (first `wa_outbound` build of the day), not at send time — the generic due-sender has no per-kind hooks. Dedupe guarantees this fires once per day. |
| D6 | "Arrived" on a blocked row: set `status='ready'`, **clear `blocked_by`**, log `unblocked` with the old `blocked_by` value in `note`. |
| D6b | "Snooze" does **not** change `status` — it only sets `snooze_until = tomorrow`. The item stays `status='ready'`; the engine's `snooze_until > today` gate hides it until the date passes, then it returns on its own (self-healing, no un-snooze job). The page's "Snoozed" section = `status='ready'` rows with a future `snooze_until`. |
| D7 | Candidate filtering happens in **pure JS** (`selectNudgeCandidate`), not SQL — matches the repo's `lib/meals/engine.ts` convention and keeps it unit-testable. The route does broad fetches; the engine picks. |
| D8 | Nav: new top-level route `/backlog` + a card on the home-page grid. |
| D9 | Migration file: `migrations/2026-08-27-backlog.sql` (tables + seed + `wa_settings` columns in one file). |

## 3. Data model

### 3.1 `backlog_items`

Exactly as the brief §1:

```sql
create table if not exists backlog_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default 'other',        -- car | kitchen | home_maint | outdoor | online | errand | other
  status text not null default 'ready',          -- ready | blocked | snoozed | done | dropped
  blocked_by text,
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
```

### 3.2 `backlog_log`

```sql
create table if not exists backlog_log (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references backlog_items(id) on delete cascade,
  action text not null,                          -- suggested | done | snoozed | unblocked | skipped | created
  note text,
  created_at timestamptz not null default now()
);
```

### 3.3 Indexes + RLS

```sql
create index if not exists idx_backlog_status on backlog_items(status);
create index if not exists idx_backlog_log_item on backlog_log(item_id);

alter table backlog_items enable row level security;
alter table backlog_log  enable row level security;
create policy "Allow all access" on backlog_items for all to public using (true) with check (true);
create policy "Allow all access" on backlog_log  for all to public using (true) with check (true);
```

(Matches the `wa_settings` policy in `migrations/2026-08-23-wa-push.sql` — app-level
bcrypt auth, not Supabase Auth.)

### 3.4 Seed

The brief's 12-item `insert` (§2), verbatim, guarded:

```sql
insert into backlog_items (title, category, status, blocked_by, time_of_day, day_pref,
  needs_daylight, needs_dry, prep_ahead, lead_time_hours, mutex_group, recurring, recurrence, deadline, priority, notes)
select * from (values ...) as seed(...)
where not exists (select 1 from backlog_items);
```

### 3.5 `wa_settings` columns

```sql
alter table wa_settings add column if not exists backlog_enabled boolean not null default true;
alter table wa_settings add column if not exists backlog_time    text    not null default '19:30';
```

## 4. `lib/backlog/`

### 4.1 `types.ts`

- `BacklogCategory`, `BacklogStatus`, `TimeOfDay` (`'morning'|'afternoon'|'evening'|'night'|'any'`),
  `DayPref` (`'weekday'|'weekend'|'any'`), `BacklogAction`
  (`'suggested'|'done'|'snoozed'|'unblocked'|'skipped'|'created'`).
- `BacklogItem` — full row shape (all columns from 3.1, snake_case, matching how
  `lib/wa/types.ts` mirrors DB rows).
- `BacklogLogRow` — `{ id, item_id, action, note, created_at }`.
- `NudgeContext` — `{ slot: TimeOfDay; dayType: 'weekday'|'weekend'; today: string; now: Date; excludedMutexGroups: string[] }`.

### 4.2 `engine.ts` (pure, unit-tested)

**`selectNudgeCandidate(items: BacklogItem[], ctx: NudgeContext): BacklogItem | null`**

Input `items` is the full `status='ready'` pool. Filters, in order:

1. `snooze_until` is null or `<= ctx.today`.
2. `time_of_day` contains `'any'` or `ctx.slot`.
3. `day_pref === 'any'` or `=== ctx.dayType`.
4. Soft auto-snooze: `last_suggested_at` is null or older than 4 days before `ctx.now`.
5. `recurring === false`.
6. Mutex: `mutex_group` is null, or not in `ctx.excludedMutexGroups`. The route
   builds that list: query `backlog_log` for today's rows with action
   `suggested`/`done`, join to `backlog_items`, collect distinct non-null
   `mutex_group`. Keeps the DB join in the route and the engine pure over plain data.

Sort survivors by `priority DESC`, then `last_suggested_at ASC NULLS FIRST`.
Return `[0]` or `null`.

**`backlogTail(items: BacklogItem[], today: string): string[]`**

`items` = all non-done items (the route passes the full active set). Produces
0+ short lines, appended after the main pick:

- Each `recurring === true` item whose recurrence makes it due today (v0: treat
  `recurrence === 'daily'` as always due) → `"<title>"` reminder line.
- Each item with a `deadline` within 7 days of `today` → `"<title> — <deadline> in N days"`.
- The Taobao seed item hits both; emit ONE line combining them:
  `"Taobao: 9.9 in N days — check the pizza-oven promo"`. Implementation: when an
  item is both recurring-due and deadline-near, emit only the deadline-style line.

**`composeBacklogNudge(candidate: BacklogItem | null, tailLines: string[]): string | null`**

- Returns `null` if `candidate === null` && `tailLines.length === 0`. (Silence beats noise.)
- Header: `🔧 Evening idea: `.
- If `candidate.prep_ahead`: frame as a prep step, never as finishable now —
  `"prep the base tonight, spin tomorrow"` style, mention `lead_time_hours`
  when set (`"(~24h)"`).
- Else: direct imperative built from `title` + `notes` when `notes` adds colour
  (`"bake the banana bread tonight — those bananas are getting ripe."`).
- If `candidate === null` but `tailLines` non-empty: message is just the tail.
- Tail lines appended, each prefixed `(+ ` … `)` or as a bracketed block — final
  wording locked during implementation; keep it to one extra line per tail entry.
- Ends with `${HOMESPACE_URL}/backlog` (import `HOMESPACE_URL` from `lib/wa/config.ts`).

Message shape target:

```
🔧 Evening idea: bake the banana bread tonight — those bananas are getting ripe.
(+ Taobao: 9.9 in 13 days — check the pizza-oven promo)
https://homespace-chi.vercel.app/backlog
```

### 4.3 `queries.ts`

Thin Supabase helpers (not unit-tested — I/O, matching `lib/wa/settings.ts`):

- `fetchReadyPool(): Promise<BacklogItem[]>` — `status = 'ready'`.
- `fetchActiveItems(): Promise<BacklogItem[]>` — `status not in ('done','dropped')`, for the tail.
- `fetchExcludedMutexGroups(today): Promise<string[]>` — today's `backlog_log`
  rows (action `suggested`/`done`) joined to `backlog_items`, distinct non-null
  `mutex_group`. "Today" = `>= ` today 00:00 Asia/Jakarta as a UTC instant.
- `markSuggested(itemId, nowIso): Promise<void>` — set `last_suggested_at = nowIso`
  on the item + insert `backlog_log { item_id, action: 'suggested' }`.

## 5. Cron integration — `app/api/wa/cron/route.ts`

### 5.1 Supporting changes

- `lib/wa/types.ts`: `WaOutboundKind` gains `'backlog_nudge'`; `WaSettings` gains
  `backlog_enabled: boolean`, `backlog_time: string`.
- `lib/wa/settings.ts`: `DEFAULTS` gains `backlog_enabled: true, backlog_time: '19:30'`.
- `app/api/wa/settings/route.ts`: `FIELDS` gains `'backlog_enabled'`, `'backlog_time'`.
- `kindEnabled()` in the cron route: `if (kind === 'backlog_nudge') return settings.backlog_enabled`.

### 5.2 New build phase (added alongside weekly / daily / prep)

```
if (settings.backlog_enabled) {
  try {
    const today = jakartaToday()            // already computed above
    const slot = 'evening'                   // 19:30 → evening; derived from backlog_time bucket
    const dayType = isWeekend(today) ? 'weekend' : 'weekday'
    const pool     = await fetchReadyPool()
    const active   = await fetchActiveItems()
    const excluded = await fetchExcludedMutexGroups(today)
    const candidate = selectNudgeCandidate(pool, { slot, dayType, today, now: new Date(), excludedMutexGroups: excluded })
    const tail   = backlogTail(active, today)
    const message = composeBacklogNudge(candidate, tail)
    if (message) {
      const sendAt = jakartaDateTimeToUtcIso(today, settings.backlog_time)
      const result = await upsertOutbound('backlog_nudge', today, sendAt, [WA_NUMBERS.kevin], message)
      if (result === 'built') { await markSuggested(candidate?.id, nowIso); built++ } else skipped++
    } else skipped++
  } catch (err) { console.error('backlog_nudge build failed:', err); skipped++ }
}
```

- `slot`: v0 buckets `backlog_time` — `< 05:00` night, `< 12:00` morning,
  `< 17:00` afternoon, `< 21:00` evening, else night. Small helper in the engine
  (pure, tested): `slotForTime(hhmm): TimeOfDay`.
- `isWeekend(today)`: reuse `dowMonBased` from `lib/wa/schedule.ts` (dow 5 or 6),
  export it if not already.
- `markSuggested` only runs when `candidate` is non-null AND `result === 'built'`.
  A tail-only message (no candidate) enqueues but marks nothing.
- The generic due-sender at the bottom of the route already handles `backlog_nudge`
  rows — no change there beyond `kindEnabled`.

### 5.3 Test mode

Extend `runTestMode()` so `&test=1` also composes and sends a backlog sample
(falls back to a `SAMPLE_BACKLOG_ITEM` + `SAMPLE_TAG` when the real pool is empty),
matching how weekly/daily/prep test-mode works.

## 6. `/backlog` page

### 6.1 `app/backlog/page.tsx`

Server component. `export const dynamic = 'force-dynamic'`, `export const revalidate = 0`
(the known stale-data gotcha). Fetches all `backlog_items` ordered
`status, priority desc, created_at`. Renders `<BacklogClient initialItems={…} />`.

Own page chrome (header with the homespace wordmark + back arrow), matching
`app/settings/page.tsx` / `WaSettingsClient` — `/backlog` is top-level, not under
the `/meals` layout.

### 6.2 `components/backlog/BacklogClient.tsx` (`'use client'`)

- Local `useState` list seeded from `initialItems`; optimistic updates + `fetch`
  to the API routes, `Saving…` indicator (same pattern as `WaSettingsClient`).
- **Quick-add** box at top: title text input + category `<select>` →
  `POST /api/backlog/items`.
- Sections in order: **Ready** (`status='ready'`, no future `snooze_until`),
  **Blocked** (`status='blocked'`), **Snoozed** (`status='ready'` with
  `snooze_until > today`), **Done** (`status='done'`, collapsed by default,
  capped at ~20 most-recent). `status='dropped'` never renders.
- Row content: title, category chip, `blocked_by` (blocked rows), `notes`,
  small tag summary (time_of_day / day_pref / priority).
- Row actions:
  - Ready → **Done**, **Snooze**.
  - Blocked → **Arrived**.
  - Snoozed → **Done**, **Un-snooze** (`{ patch: { snooze_until: null } }`, no log).
  - All non-done → **Edit tags** (opens inline editor, 6.3).
- Buttons call `PATCH /api/backlog/items/[id]` with `{ action }`.

### 6.3 Inline tag edit

Expandable per-row editor (toggled by an Edit button). Editable fields:
`category`, `status`, `time_of_day` (multi-checkbox), `day_pref`, `priority`,
`blocked_by`, `deadline`, `notes`, the boolean flags (`needs_daylight`,
`needs_dry`, `prep_ahead`, `recurring`), `lead_time_hours`, `mutex_group`,
`recurrence`, `snooze_until`. Save → `PATCH /api/backlog/items/[id]` with
`{ patch: {...} }` (raw column update, no log row — or log `created`?-> no, no
log for edits in v0). Cancel discards.

Keep the editor a single focused sub-component
(`components/backlog/TagEditor.tsx`) so the row component stays small.

## 7. API routes

### 7.1 `POST /api/backlog/items`

Body `{ title: string, category?: string }`. Rejects blank title (400). Inserts
`{ title: title.trim(), category: category ?? 'other', status: 'ready' }`, then
inserts `backlog_log { item_id, action: 'created' }`. Returns the new row.

### 7.2 `PATCH /api/backlog/items/[id]`

Two shapes:

**`{ action: 'done' | 'snooze' | 'arrived' }`** — the state transitions:

| action | item update | log |
|--------|-------------|-----|
| `done` | `status='done'`, `last_done_at=now()` | `done` |
| `snooze` | `snooze_until = tomorrow` (Asia/Jakarta) — `status` unchanged | `snoozed` |
| `arrived` | `status='ready'`, `blocked_by=null` | `unblocked`, `note = <old blocked_by>` |

`tomorrow` computed with `tomorrowOf(jakartaToday())` from `lib/wa/schedule.ts`.

**`{ patch: Record<string, unknown> }`** — inline tag edit (also the Un-snooze
and drop paths). Whitelist the editable columns (section 6.3 list plus
`snooze_until`); ignore anything else; no log row. Returns the updated row.

### 7.3 Deletion

No DELETE route in v0. "Removing" an item = setting `status='dropped'` via the
tag editor's `{ patch: { status: 'dropped' } }`. Dropped items don't render in
any section.

All routes: `import { supabase } from '@/lib/supabase'`, return
`Response.json(...)`, `{ error }` + 500 on Supabase error — matching
`app/api/shopping/items/*` and `app/api/wa/settings/route.ts`.

## 8. Home page

`app/page.tsx` `features` array gains:

```ts
{ href: '/backlog', icon: <ListTodo/CheckCheck>, label: 'Backlog',
  description: 'One nudge a day for the someday pile', color: 'bg-rose-50 text-rose-600' }
```

Pick an unused `lucide-react` icon (`ListTodo` or `ClipboardList`) and an unused
colour pair.

## 9. `/settings` page

`components/settings/WaSettingsClient.tsx` `ROWS` array gains a 4th entry:

```ts
{ key: 'backlog', label: 'Backlog nudge', description: 'One evening chore suggestion that fits the moment' }
```

The existing `${key}_enabled` / `${key}_time` convention wires it up with no
other change (the row renders a time input + toggle bound to `backlog_time` /
`backlog_enabled`).

## 10. Testing

- **Unit (`lib/backlog/engine.test.ts`, vitest):**
  - `slotForTime` buckets.
  - `selectNudgeCandidate`: each filter in isolation (snooze, slot, day_pref,
    4-day auto-snooze, recurring excluded, mutex exclusion), priority + tiebreak
    ordering, empty pool → null.
  - `backlogTail`: recurring-due line, deadline-within-7 line, the combined
    Taobao case, nothing due → `[]`.
  - `composeBacklogNudge`: candidate-only, tail-only, both, neither → null,
    `prep_ahead` phrasing never implies finishable-now, always ends with
    `/backlog` URL.
- **Manual (curl + SQL), matching repo convention (no `app/api/**/*.test.ts`):**
  - Apply migration → `select count(*) from backlog_items` = 12.
  - `/backlog` page: quick-add, Done, Snooze, Arrived, tag edit each round-trip
    and reflect after reload.
  - `curl "http://localhost:3000/api/wa/cron?secret=<CRON_SECRET>&test=1&to=<phone>"`
    → backlog sample arrives.
  - Force a known-good row into the pool, run the real cron tick, confirm one
    `wa_outbound` row with `kind='backlog_nudge'`, `recipients=[kevin]`,
    `send_at` = today 19:30 Jakarta, and a `backlog_log` `suggested` row.
  - Re-run the tick → no second enqueue, no second log row.

## 11. Build order

1. Migration + seed + `wa_settings` columns (§3). Verify 12 rows, 2 new columns.
2. `lib/backlog/types.ts` + `queries.ts`.
3. `/backlog` page + `BacklogClient` + `TagEditor` + API routes (§6–7). Verify
   all mutations round-trip.
4. Home-page card (§8).
5. `lib/backlog/engine.ts` + `engine.test.ts` (§4.2, §10). Red→green.
6. Cron build phase + `lib/wa` supporting changes + test-mode sample (§5).
   Verify enqueue / dedupe / send via curl + SQL.
7. `/settings` row (§9).

## 12. Files

**New:**
- `migrations/2026-08-27-backlog.sql`
- `lib/backlog/types.ts`
- `lib/backlog/engine.ts`
- `lib/backlog/engine.test.ts`
- `lib/backlog/queries.ts`
- `app/backlog/page.tsx`
- `components/backlog/BacklogClient.tsx`
- `components/backlog/TagEditor.tsx`
- `app/api/backlog/items/route.ts`
- `app/api/backlog/items/[id]/route.ts`

**Modified:**
- `app/api/wa/cron/route.ts` (new build phase, `kindEnabled`, test mode)
- `lib/wa/types.ts` (`WaOutboundKind`, `WaSettings`)
- `lib/wa/settings.ts` (`DEFAULTS`)
- `lib/wa/schedule.ts` (export `dowMonBased` / add `isWeekend` if needed)
- `app/api/wa/settings/route.ts` (`FIELDS`)
- `app/page.tsx` (home card)
- `components/settings/WaSettingsClient.tsx` (`ROWS`)
