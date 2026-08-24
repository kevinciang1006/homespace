-- Weekly shopping list: configurable day-of-week cutoff for "this week vs next week".
-- Mon=0 .. Sun=6. Any today with dow >= weekly_cutoff_dow targets NEXT week's plan;
-- otherwise THIS week's. Default 4 = Friday (Fri/Sat/Sun -> next week).

alter table wa_settings add column if not exists weekly_cutoff_dow int not null default 4;
