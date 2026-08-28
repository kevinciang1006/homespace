-- Claude Code "you left me hanging" nudge: one pending row per waiting session.
-- Spec: docs/superpowers/specs/2026-08-28-cc-hang-nudge-design.md

create table if not exists cc_pending_prompts (
  session_id     text primary key,      -- from hook payload; natural upsert key
  cwd            text,                   -- project path, for "which repo" in the nudge
  message        text,                   -- notification / last question text
  status         text not null default 'pending',   -- pending | resolved
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  last_nudged_at timestamptz,
  resolved_at    timestamptz
);

alter table cc_pending_prompts enable row level security;
create policy "Allow all access" on cc_pending_prompts for all to public using (true) with check (true);
