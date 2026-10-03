-- Ingredient blacklist: dishes that use a blacklisted ingredient are never
-- picked by the meal generator / rerolls.
alter table ingredients add column if not exists blacklisted boolean not null default false;
