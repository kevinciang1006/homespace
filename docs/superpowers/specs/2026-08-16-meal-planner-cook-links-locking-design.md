# Meal Planner: Overview relocation, Cook tracking, Recipe links, Locking/Rerolling — Design

**Date:** 2026-08-16
**Branch:** `fix/dishes-editor`

Four independent changes to the Homespace Meal Planner. Meals stay the primary focus.
Design language: stone palette, orange accent, DM Serif Display headings, white cards
(`border border-stone-200 rounded-2xl`), mobile-first, signal colors green/stone/amber —
**never red**. Data via `lib/supabase.ts` (anon role); session via `hs_session` cookie.

---

## 1. Relocate the Week Overview panel

**Goal:** the 7-day meal grid is the first and primary thing on the plan view; the overview is secondary and collapsed.

- In `components/meals/PlanClient.tsx`, move `<WeekOverview>` from above the day grid to **below** it. Above the grid: only the week selector + Build/Generate buttons.
- Convert `WeekOverview` to a **collapsed-by-default accordion at every breakpoint**. Today it is forced-open on `sm+` via `hidden sm:grid`; replace that with a single `expanded` state (default `false`) that controls the signal grid at all sizes.
- Header (always visible, tappable): `📊 Week overview` label + the verdict text + chevron. Expanding reveals the signal grid + summary.
- Empty-week state stays the existing minimal one-liner, also rendered below the grid.
- **No change to `lib/meals/overview.ts`** — placement + default-collapsed only.

## 2. Cook tracking — plan vs actual

**DB (exists):** `cook_log(cook_date, slot, planned_dish_id, planned_dish_name, actual_dish_id, actual_dish_name, cooked bool, note, logged_by, unique(cook_date, slot))`.

**New route `app/api/meals/cook-log/route.ts`:**
- `GET ?weekStart=YYYY-MM-DD` → returns cook_log rows whose `cook_date` is within that week. Used to render the ✓ state per day.
- `POST` body:
  - `{ cook_date }` (no entries) → "cooked as planned": read that day's non-skipped `meal_plans` rows, upsert one cook_log row per slot with `actual_* = planned_*`, `cooked = true`.
  - `{ cook_date, entries: [{ slot, planned_dish_id, planned_dish_name, actual_dish_id, actual_dish_name, cooked, note? }] }` → edit mode: upsert exactly these rows.
  - Upsert on conflict `(cook_date, slot)`. `logged_by` read server-side from the `hs_session` cookie (JSON `{id,name}` → use `name`).

**UI:**
- `PlanClient` fetches the week's cook-log alongside the plan (on initial load + after `loadWeek`) into a `Map<cook_date, CookEntry[]>`, passed down to each `DayPlate`.
- Each `DayPlate` footer gets a **"✓ Cooked"** button. One tap → POST `{ cook_date }` → mark logged; card shows a subtle logged state (small ✓ badge, e.g. green check near the day name). Re-openable.
- An **"Edit"** affordance opens `CookLogSheet` (a lightweight modal/overlay): one row per planned slot showing planned dish, with:
  - a dropdown of that slot's pool (reuse `GET /api/meals/reroll?plan_date&slot&alternatives`) to change the **actual** dish, **or** a free-text `actual_dish_name` field;
  - a **"didn't cook / ate out"** toggle → `cooked = false`.
  - Save → POST `{ cook_date, entries }`.
- Minimal UI — the common case is one tap ("cooked as planned").

## 3. Recipe links per dish

**DB (exists):** `dishes.recipe_links jsonb` — array of `{ url, title, source }`.

- New pure module `lib/meals/recipeLinks.ts`: `type RecipeLink = { url: string; title?: string; source: RecipeSource }`, `type RecipeSource = 'youtube'|'instagram'|'tiktok'|'web'`, and `detectSource(url: string): RecipeSource` (domain sniff; unit-tested).
- `lib/meals/types.ts`: add `recipe_links?: RecipeLink[] | null` to `Dish`, and to `MealPlan.dishes` join meta.
- Add `recipe_links` to the dishes join `SELECT` in all four query sites: `app/meals/page.tsx`, `app/api/meals/week/route.ts`, `app/api/meals/generate/route.ts`, `app/api/meals/reroll/route.ts` (`SELECT` const). Add `recipe_links` to the dishes PATCH `FIELDS` in `app/api/meals/dishes/[id]/route.ts`.
- **Dishes editor** (`DishesClient` row): a "Recipe links" section per dish — list each link with a source icon + a remove (×) button; an input to paste a URL (+ optional title) and an Add button. Add/remove writes the **whole array** via PATCH `recipe_links`.
- **Plan card** (`MainHero`, `SupportChip`, `DesertRow`): if a dish has `recipe_links?.length`, show a small link icon. Tap → exactly one link opens directly in a new tab (`target="_blank" rel="noopener"`); multiple → a small popover list of titled links. Also a quick **"＋ recipe"** control on the dish that opens a tiny inline input to append a link and PATCH that dish's `recipe_links` (reads current array from the joined meta, appends, writes back).

## 4. Locking + rerolling

**(a) Fix per-slot reroll for ALL slots.** Root-cause first (systematic-debugging). Leading hypothesis: `SupportChip`'s container is `rounded-xl overflow-hidden` while its alternatives popover renders at `top-full` (outside the card box), so `overflow-hidden` clips the popover and the reroll menu is invisible. Fix the clipping (e.g. drop `overflow-hidden` and clip only the image, or render the popover without being clipped) for `SupportChip` and `DesertRow`. Verify the swap picks a valid new dish for that exact slot (the endpoint already handles this via `pickForSlot`).

**(b) Per-day reroll.** A shuffle button on each `DayPlate` header. Extend `POST /api/meals/reroll` with a `scope: 'day'` branch: load the week, build `lockedByCell` from ALL locked rows in that day (main included if locked), `composeDay`, delete only `.eq('locked', false)` for the day, insert the composed non-locked rows, return `{ day }`. Client updates via existing `replaceDay`.

**(c) Per-day lock.** A lock button on each `DayPlate` header. New route `app/api/meals/day-lock/route.ts` (`POST { plan_date, locked }`) → update all that day's `meal_plans` rows' `locked`. "Day locked" = every (non-skipped) row for the day is locked; the button toggles them all together. Individual slot locks still work independently (a day can have some slots locked without the whole day being locked). A locked day gets a distinct visual: orange border/tint + a lock badge in the header; the per-day reroll button is disabled while the day is locked.

**(d) Locking precedence.** Generate Week and per-day reroll both delete only `locked = false` rows and skip locked cells, so any locked slot or locked day survives untouched. Generate already does this; per-day reroll follows the same rule. Per-slot/per-day reroll of a locked target is a no-op (locked = never touched).

---

## Files touched (summary)

- `components/meals/PlanClient.tsx` — relocate overview; cook-log fetch + map; wire day controls.
- `components/meals/WeekOverview.tsx` — accordion, collapsed default all breakpoints.
- `components/meals/CookLogSheet.tsx` *(new)* — per-day cook edit modal.
- `components/meals/DishesClient.tsx` — recipe-links editor section.
- `lib/meals/recipeLinks.ts` *(new)* + test — `detectSource`, types.
- `lib/meals/types.ts` — `recipe_links` on `Dish` + join meta.
- `app/api/meals/cook-log/route.ts` *(new)* — GET/POST cook log.
- `app/api/meals/day-lock/route.ts` *(new)* — POST day lock toggle.
- `app/api/meals/reroll/route.ts` — `scope:'day'` branch; add `recipe_links` to SELECT.
- `app/api/meals/{generate,week}/route.ts`, `app/meals/page.tsx` — add `recipe_links` to join SELECT.
- `app/api/meals/dishes/[id]/route.ts` — `recipe_links` in PATCH FIELDS.

## Testing

- `lib/meals/recipeLinks.test.ts` — `detectSource` across youtube/youtu.be/instagram/tiktok/plain domains.
- Manual/live verification for each acceptance item (a)–(e) from the request.
- Existing engine + overview tests must stay green.
