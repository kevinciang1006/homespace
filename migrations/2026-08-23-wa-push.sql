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
