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
