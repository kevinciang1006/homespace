-- Existing single-row-per-(plan_date,slot) upserts need a matching unique
-- constraint; move it to include role so slot='fruit' rows (now two per
-- day: role='breakfast', role='optional') can each be upserted
-- independently. Every non-fruit slot keeps exactly one role, so this is a
-- no-op for their existing upserts once their onConflict targets add role.
alter table meal_plans drop constraint if exists meal_plans_plan_date_slot_key;
alter table meal_plans add constraint meal_plans_plan_date_slot_role_key unique (plan_date, slot, role);
