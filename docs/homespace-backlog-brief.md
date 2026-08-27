# Homespace — Backlog Module (build brief)

A tagged backlog + one daily context-aware WhatsApp nudge. Lives **inside Homespace**
(repo + existing Supabase project `eelcqdkkefhvoloiikka`), reusing `homespace-relay`
(PM2 / Tailscale Funnel) for the outbound message. No new app, no Atlas.

Core rule: **capture is frictionless; surfacing is cadence-aware and capped at ONE item.**
The nudge fires ~19:30 Asia/Jakarta (after the 5:30pm meal reminder, after work stops),
suggests a single chore that fits *this* slot, and stays silent if nothing fits.
Notification fatigue is the failure mode — protect against it, not just ship the cron.

---

## 1. Migration

```sql
create table if not exists backlog_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default 'other',        -- car | kitchen | home_maint | outdoor | online | errand | other
  status text not null default 'ready',          -- ready | blocked | snoozed | done | dropped
  blocked_by text,                               -- free text, e.g. 'awaiting: spiral mixer'
  time_of_day text[] not null default '{any}',   -- morning | afternoon | evening | night | any
  day_pref text not null default 'any',          -- weekday | weekend | any
  needs_daylight boolean not null default false,
  needs_dry boolean not null default false,      -- weather-gated (car wash, windows, motorcycle)
  prep_ahead boolean not null default false,     -- 2-step: prep now, finish later (creami base, poolish)
  lead_time_hours int,                           -- e.g. 24 for creami freeze
  mutex_group text,                              -- items sharing a group never suggested same day
  recurring boolean not null default false,
  recurrence text,                               -- 'daily' etc
  deadline date,
  priority int not null default 0,               -- higher surfaces first
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
```

> **RLS:** mirror whatever your other Homespace tables use. You're on app-level password
> auth (bcrypt), not Supabase Auth, so copy the existing anon policy pattern — don't invent
> a new one.

## 2. Seed (your 12 items, tagged)

```sql
insert into backlog_items
(title, category, status, blocked_by, time_of_day, day_pref, needs_daylight, needs_dry, prep_ahead, lead_time_hours, mutex_group, recurring, recurrence, deadline, priority, notes) values
('Clean car windows',                    'car',        'ready',   null,                     '{morning}',           'weekend', true,  true,  false, null, 'car_clean', false, null,    null,         1, 'mold/mushroom spots forming'),
('Clean car interior',                   'car',        'ready',   null,                     '{morning,afternoon}', 'weekend', true,  false, false, null, 'car_clean', false, null,    null,         0, 'keep separate from window day'),
('Prepare pizza poolish',                'kitchen',    'ready',   null,                     '{evening}',           'any',     false, false, true,  12,   null,        false, null,    null,         0, 'preferment; doable before mixer arrives'),
('Pizza dough experiments (2-3 var.)',   'kitchen',    'blocked', 'awaiting: spiral mixer', '{evening}',           'any',     false, false, true,  null, null,        false, null,    null,         0, 'start after spiral mixer arrives'),
('Bake banana bread',                    'kitchen',    'ready',   null,                     '{evening,night}',     'any',     false, false, false, null, null,        false, null,    null,         1, 'use the aging bananas'),
('Ninja Creami — chocolate',             'kitchen',    'blocked', 'awaiting: Callebaut',    '{any}',               'any',     false, false, true,  24,   null,        false, null,    null,         0, 'wait for Callebaut'),
('Ninja Creami — rainbow (for son)',     'kitchen',    'ready',   null,                     '{any}',               'any',     false, false, true,  24,   null,        false, null,    null,         2, 'son keeps asking; prep base, freeze 24h, spin'),
('Ninja Creami — mango sorbet',          'kitchen',    'ready',   null,                     '{any}',               'any',     false, false, true,  24,   null,        false, null,    null,         0, 'prep base, freeze 24h, spin'),
('Clean Dreame robot',                   'home_maint', 'ready',   null,                     '{any}',               'any',     false, false, false, null, null,        false, null,    null,         0, 'quick maintenance'),
('Wash motorcycle',                      'outdoor',    'ready',   null,                     '{morning}',           'weekend', true,  true,  false, null, null,        false, null,    null,         1, 'overdue'),
('Check Taobao for pizza oven promo',    'online',     'ready',   null,                     '{any}',               'any',     false, false, false, null, null,        true,  'daily', '2026-09-09', 0, '9.9 sale; buy oven if promo'),
('Marinade meals (vacuum seal)',         'kitchen',    'blocked', 'awaiting: vacuum sealer','{evening}',           'any',     false, false, false, null, null,        false, null,    null,         0, 'ties into meal plan');
```

## 3. Nudge engine (daily 19:30 Asia/Jakarta, in the relay)

**Context:** `slot` from now (19:30 → `evening`); `day_type` = `weekend` if Sat/Sun else `weekday`.

**Main candidate pool** (pick exactly one):
```
status = 'ready'
AND (snooze_until IS NULL OR snooze_until <= current_date)
AND ('any' = ANY(time_of_day) OR :slot = ANY(time_of_day))
AND (day_pref = 'any' OR day_pref = :day_type)
AND (last_suggested_at IS NULL OR last_suggested_at < now() - interval '4 days')  -- soft auto-snooze
AND recurring = false
AND (mutex_group IS NULL OR mutex_group NOT IN (:groups_done_or_suggested_today))
ORDER BY priority DESC, last_suggested_at ASC NULLS FIRST
LIMIT 1;
```

**Phrasing:**
- `prep_ahead = true` → frame as a prep step: "prep the base tonight, spin tomorrow" (mention `lead_time_hours`). Never imply it's finishable now.
- else → direct: "bake the banana bread tonight."

**After sending the main item:** `last_suggested_at = now()`, insert `backlog_log` action `suggested`.

**Recurring / deadline tail** (separate from the single pick, appended as one line):
- Any `recurring` item due today (Taobao) → append a short reminder.
- `deadline` within 7 days → add a countdown ("9.9 in N days").

**Empty pool → send nothing.** Silence beats noise. (Later: a once-weekly "everything's blocked / weekend-only — N items waiting on deliveries" summary.)

**Message shape:**
```
🔧 Evening idea: bake the banana bread tonight — those bananas are getting ripe.
(+ Taobao: 9.9 in 13 days — check the pizza-oven promo)
```

**Weather gate:** `needs_dry` / `needs_daylight` items are already `weekend` + `morning`, so
they self-gate for v0. Wiring real weather (skip nudging car wash if rain forecast) is v0.1.

## 4. Homespace `/backlog` page

List grouped by status (Ready / Blocked / Done). Per row: **Done**, **Snooze** (→ `snooze_until = tomorrow`),
and for blocked rows **Arrived** (→ `status='ready'`, log `unblocked`). Plus a quick-add box and inline tag edit.

- Server component fetching live data: set `export const dynamic = 'force-dynamic'` and
  `export const revalidate = 0` (your known stale-data gotcha).
- This is the mutation surface for v0 — you manage state here, WhatsApp only pushes out.

## 5. Build order

1. Migration + seed (§1–2).
2. `/backlog` page (§4) — verify you can flip statuses and quick-add.
3. Relay cron 19:30 (§3) — reuse the existing meal-reminder send path; test by forcing the query to return a known row.
4. **v0.1** — OpenClaw reply skill so WhatsApp replies mutate the backlog without opening the web app:
   - `done` → status `done`, `last_done_at = now()`
   - `X arrived` → blocked item where `blocked_by ILIKE '%X%'` → `ready` (unblocks pizza dough / chocolate creami / marinade meals)
   - `snooze` / `not today` → `snooze_until = tomorrow`
