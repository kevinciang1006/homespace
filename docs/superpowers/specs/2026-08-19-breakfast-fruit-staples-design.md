# Breakfast, evening fruit & daily staples — design

## Goal

Extend the Meal Planner beyond dinner: a generated breakfast (with its own
eat-out treat quota), a second (evening) fruit slot pushing most days toward
~2 fruit portions, and a always-on display of the household's daily dairy
staples. Dinner stays the visual and rule-engine centerpiece; breakfast is a
lighter, independent module; fruit/staples are small footers.

## Non-goals

- No nutrition tracking, calorie counting, or weekly-average math (same
  framing as the earlier quantities work).
- Daily staples are not generated, rerolled, or locked — they're a constant
  display pulled from `daily_staples`, editable only as a settings list.
- No new nav page for staples editing — it lives inline on the banner.

## Data (already in DB, seeded)

- `dishes.slot` accepts `'breakfast'` and `'fruit'` in addition to the
  existing five.
- Breakfast pool (9 dishes): `tier='everyday'` = home breakfast (eggs,
  bread, bubur); `tier='special'` = eat-out treat (nasi lemak, mie, lontong).
- Evening fruit pool, `slot='fruit'` (Pepaya/Semangka/Pisang/Jeruk "sore"),
  all `tier='everyday'` — no treat concept for fruit.
- `daily_staples` table: `{ id, name, person, frequency, note }`, seeded
  with 3 daily dairy rows (Son / Kevin / Wife).

## 1. Types & constants (`lib/meals/types.ts`)

- `SLOTS` becomes
  `['breakfast', 'utama', 'kuah', 'pelengkap', 'sayuran', 'fruit', 'desert']`
  — breakfast leads the day, fruit sits with the other end-of-day items
  before desert. This order drives the Dishes-editor section order and the
  slot sort used when persisting a generated week.
- `SLOT_LABELS` gains `breakfast: 'Breakfast'`, `fruit: 'Fruit'`.
- `DEFAULT_NO_REPEAT` gains `breakfast: 4` (per the ~4-day window called
  out in the request) and `fruit: 3` (a 4-item pool needs a short window to
  rotate cleanly through a 7-day week without exhausting itself).
- `Role` gains `'breakfast'`. Slot→role mapping (used by generation and by
  the reroll route's generic `roleForSlot`):
  - `breakfast` → `'breakfast'`
  - `fruit` → `'optional'` (paired conceptually with desert: both are
    exempt from the spicy-floor count in `spicyOk`, which is harmless
    since fruit dishes are never spicy)
  - `utama` → `'main'`, `desert` → `'optional'`, everything else →
    `'support'`
  - Keeping breakfast out of `'support'` matters: the UI's support-chip
    filter (`role === 'support'`) must not swallow the breakfast row into
    the sayuran/kuah chip pair.
- New `DailyStaple` type: `{ id: string; name: string; person: string;
  frequency: string; note: string | null }`.

## 2. Generation engine (`lib/meals/engine.ts`)

### Why breakfast needs its own rule path

The existing dinner rule functions (`friedOk`, `spicyOk`, `saltinessOk`,
`proteinClashOk`, `difficultyOk`, `spicyMainSpacingOk`, `specialOk`) all
operate cross-slot over *the whole day's picks* — that's correct for a
single cohesive dinner plate, but wrong for a meal the spec explicitly
calls "independent." Reusing `specialOk` in particular would either fail to
enforce breakfast's own 2/week cap (it only recognizes `ctx.slot ===
'utama'`) or wrongly block a special breakfast because dinner already used
its special dish that day (`dayHasSpecial` scans all slots). So breakfast
gets a small, purpose-built path instead of flowing through
`passesHardRules`.

Evening fruit does **not** need this: fruit dishes are neutral on every
cross-slot axis (`protein: 'none'`, `spicy: false`, `saltiness: 'normal'`,
never fried, `tier` always `'everyday'`), so `pickForSlot` /
`passesHardRules` already produce the right behavior for `slot: 'fruit'`
with zero new rule code — it's just another `composeDay` step, the same
shape as desert.

### New functions

- `preassignBreakfastSpecialDays(days, lockedBreakfastCells, dishById,
  rng): Set<string>` — same shape as `preassignSpecialDays` (pick 2
  non-adjacent days; locked special breakfast cells count toward the cap),
  scanning only the `breakfast` pool and locked breakfast cells. Fully
  independent of `preassignSpecialDays`'s dinner set — a day may end up in
  both, by chance.
- `breakfastSpecialOk(dish: Dish, isSpecialDay: boolean): boolean` —
  `isSpecialDay ? dish.tier === 'special' : dish.tier !== 'special'`. No
  day-cap check is needed: breakfast is a single dish, not a multi-slot
  plate.
- `pickBreakfast(pool: Dish[], ctx: PickContext, isSpecialDay: boolean,
  rng): Pick` — candidates are `active && !is_garnish && slot ===
  'breakfast' && noRepeatOk(dish, ctx) && breakfastSpecialOk(dish,
  isSpecialDay)`, weighted via the existing (slot-agnostic) `weightFor`.
  One relax step loosens the no-repeat window
  (`noRepeatFactor: 0.5`); if still empty, last resort is any active
  breakfast dish matching `isSpecialDay`, ignoring no-repeat, so the slot
  is never left empty as long as the pool has a dish of the right tier.
  `noRepeatOk`, `freshnessFactor`, `weightFor`, and `weightedPick` are all
  reused as-is — they're already slot-agnostic (dish id / rating / prior
  uses only).

### `composeDay` changes

Two new steps, both honoring `isLocked(slot)` exactly like the existing
four so day-lock and day-reroll cover them automatically:

- **Step 0, breakfast** — `pickBreakfast` using `breakfastSpecialDays.has(date)`.
- **Step 5 (last), evening fruit** — `pickForSlot(dishesBySlot.fruit, mkCtx('fruit', 'optional', 0), rng)`.

`composeDay`'s input signature gains `breakfastSpecialDays: Set<string>` (parallel to the existing `specialDays`/`hardDays` params).

### `generateWeek` / `validateWeek`

- `generateWeek` computes `breakfastSpecialDays` via
  `preassignBreakfastSpecialDays` alongside the existing preassignment
  calls, and threads it into every `composeDay` call.
- `validateWeek` gains checks (all reported the same "⚠️ ..." way as
  existing violations, so a clean week produces an empty array):
  - exactly one non-skipped breakfast per day
  - ≤2 special (eat-out) breakfasts for the week, and none adjacent
  - evening fruit present every day
  - advisory: fewer than 5 of 7 days reaching ≥2 total fruit portions
    (`desert.fruit_portions + fruit.fruit_portions`)

## 3. Generation report surfaced in the UI

- `POST /api/meals/generate` now always includes `report: string[]`
  (the `validateWeek` output) in its response, not just a dev-console log.
- `PlanClient`'s `generate()` captures `report` and renders a small
  dismissible banner under the week-nav row after a generate completes:
  "✓ Week validated" when the array is empty, otherwise the specific
  violation lines. This is what satisfies "after generating, confirm ...
  show the report."
- Day-reroll and single-slot reroll do not run this report — the spec
  scopes it to "after generating."

## 4. Daily staples — CRUD + banner

- New routes mirroring the existing dishes CRUD pattern:
  - `app/api/meals/staples/route.ts` — `GET` (list all), `POST` (create,
    defaults `frequency: 'daily'`).
  - `app/api/meals/staples/[id]/route.ts` — `PATCH` (whitelisted fields:
    `name`, `person`, `frequency`, `note`), `DELETE`.
- `lib/meals/staples.ts` (new, unit-tested): `formatStaplesLine(staples:
  DailyStaple[]): string` — groups staples that share an identical
  `name`/`note` pair across people (e.g. Kevin & Wife both "Susu /
  yogurt") into one clause, producing `"Son milk · Kevin & Wife
  milk/yogurt"` from the seeded data. Returns `''` when the list is empty.
- New `components/meals/StaplesBanner.tsx`: fetches/receives the staples
  list, renders `🥛 Daily: {formatStaplesLine(...)}` as one thin banner
  above the week grid (not per-day-card — avoids repeating it 7×), with a
  small edit affordance that expands an inline add/remove/rename list,
  saved on blur the same way `DishEditorPanel` saves free-text fields.
  Rendered once; not generated, not lockable, not rerollable.
- `app/meals/page.tsx` fetches `daily_staples` alongside the week and
  passes it to `PlanClient` as `initialStaples`.

## 5. Day card restructuring (`components/meals/PlanClient.tsx`)

Per the confirmed 3-column desktop grid (cards simply grow taller), top to
bottom on each day card:

1. 🌅 **Breakfast strip** (new) — a compact single line, not a hero: dish
   name, a small "eat-out" pill when `tier === 'special'`, and qty (via the
   existing `qtyDisplay` helper) when set. Same lock/reroll/recipe-link
   icon affordances as a support chip, sized down to match the strip.
2. 🍽️ **Dinner** — unchanged: hero main + sayuran/kuah support chips.
3. 🍎 **Fruit row** — the existing desert row extends to show both desert
   *and* evening fruit as two compact lines (each independently
   lockable/rerollable, same icon affordances as today's single desert
   row).
4. Day total (veg/fruit tally) — unchanged mechanism; naturally includes
   evening fruit's `fruit_portions` since it sums from all of the day's
   visible rows.
5. Mark cooked / Edit — unchanged.

The staples line is *not* repeated per-day-card (see §4 — one banner at
the top of the week instead).

## 6. Dishes editor

No structural changes required. `DishesClient` already iterates `SLOTS`
generically for section grouping, add/remove, and inline editing (tier,
rating, qty, etc.), so Breakfast and Fruit sections appear automatically
once `SLOTS`/`SLOT_LABELS` are extended (§1). The `provides_soup` toggle
stays hidden outside `slot === 'utama'`, which already excludes the two
new slots correctly.

## 7. Week overview (`lib/meals/overview.ts`, `WeekOverview.tsx`)

- Replace the `"Portions & calories — coming soon"` placeholder signal
  with a real 🍎 fruit-tally signal: `"X of 7 days hit ~2 fruit portions"`,
  status `good` at ≥5/7, `neutral` otherwise.
- Add a new 🌅 signal styled like the existing `special` signal: `"N
  eat-out breakfast{s} this week — {days}"` (or "No eat-out breakfasts
  this week" at 0), status `good` at exactly 2, `neutral` otherwise.

## Testing

- `lib/meals/engine.test.ts` — new cases for
  `preassignBreakfastSpecialDays` (2 non-adjacent days, independent of
  dinner's set), `pickBreakfast` (respects `breakfastSpecialOk`, no-repeat
  window, relax/last-resort fallback), `composeDay` (breakfast + fruit
  rows present, honor `isLocked`), and the new `validateWeek` checks.
- `lib/meals/staples.test.ts` (new) — `formatStaplesLine` grouping
  behavior, including the empty-list case.
- `lib/meals/overview.test.ts` — new cases for the fruit-tally and
  breakfast-treat signals.

## Files touched

**New:** `lib/meals/staples.ts` (+ test), `components/meals/StaplesBanner.tsx`,
`app/api/meals/staples/route.ts`, `app/api/meals/staples/[id]/route.ts`.

**Modified:** `lib/meals/types.ts`, `lib/meals/engine.ts` (+ test),
`lib/meals/overview.ts` (+ test), `app/api/meals/generate/route.ts`,
`app/api/meals/reroll/route.ts` (breakfast gets its own reroll branch
alongside the existing `utama` branch; fruit reuses the generic
support/optional reroll path), `app/meals/page.tsx`,
`components/meals/PlanClient.tsx`, `components/meals/DishesClient.tsx`
(only if any polish turns out to be needed once breakfast/fruit rows are
visible in practice).
