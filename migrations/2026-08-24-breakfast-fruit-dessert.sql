-- The 6 desert-slot rows that are actually plain fruits move to the fruit
-- slot, joining the shared fruit pool used for both breakfast pairing and
-- dessert pairing. They keep their existing images.
update dishes set slot = 'fruit' where slot = 'desert' and fruit_context = 'any';

-- Prevent duplicate batch entries on a regenerate.
alter table dessert_week_items add constraint dessert_week_items_week_dish_key unique (week_start, dish_id);

-- cook_log currently uniques on (cook_date, slot), which breaks once a day
-- can hold two slot='fruit' rows (breakfast-fruit, dessert-fruit). Add role
-- and re-key the constraint to (cook_date, slot, role). Table is empty
-- today, so no backfill is needed.
alter table cook_log add column if not exists role text;
alter table cook_log drop constraint if exists cook_log_cook_date_slot_key;
alter table cook_log add constraint cook_log_cook_date_slot_role_key unique (cook_date, slot, role);
