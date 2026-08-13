# Meal Planner sub-app — Design

**Date:** 2026-08-13
**Route:** `/meals` (Plan) and `/meals/dishes` (Dishes)
**Stack:** Next.js App Router (16.2.4), TypeScript, Tailwind v4, Supabase (`lib/supabase.ts`, anon key), lucide-react.

## Goal

A "Meal Planner" sub-app in Homespace that generates a rule-respecting weekly meal plan across
5 slots × 7 days from a seeded pool of 94 dishes, lets the user lock/re-roll individual cells,
and provides an editable dish library. Match the existing `/expenses` and `/shopping` look.

## Database (already created & seeded)

`dishes`: `id uuid`, `name text`, `slot text` (`utama|kuah|pelengkap|sayuran|desert`),
`protein text` (fish, chicken, pork, beef, shrimp, squid, crab, duck, egg, tofu_tempe, none, mixed),
`tier text` (`everyday|nice|special`), `method text`, `spicy boolean`, `rating int 1-5` (default 3),
`active boolean` (default true), `no_repeat_days int` nullable. 94 rows seeded.

`meal_plans`: `id uuid`, `plan_date date`, `slot text`, `dish_id uuid FK`, `dish_name text` (snapshot),
`locked boolean` (default false), `unique(plan_date, slot)`.

Slot display order: **Utama** (Main), **Kuah** (Soup), **Pelengkap** (Side), **Sayuran** (Vegetable), **Desert**.

## Architecture & file layout

```
lib/meals/
  types.ts        # Dish, MealPlan, Slot, Tier, Protein types; SLOTS order; default no-repeat windows
  engine.ts       # PURE, framework-free generation logic (no Supabase/Next imports)
  engine.test.ts  # Vitest unit tests with fixture dishes

app/meals/
  layout.tsx      # shared header + Plan/Dishes tab switch
  page.tsx        # server: fetch selected week's meal_plans + active dishes -> <PlanClient/>
  dishes/page.tsx # server: fetch all dishes -> <DishesClient/>

app/api/meals/
  generate/route.ts    # POST {weekStart} -> run engine, upsert non-locked cells, return week
  reroll/route.ts      # POST {plan_date,slot} -> re-roll one cell;
                       #   GET ?plan_date&slot&alternatives=N -> candidate list (no write)
  plan/[id]/route.ts   # PATCH -> toggle locked / swap dish for a cell
  dishes/route.ts      # POST -> add dish
  dishes/[id]/route.ts # PATCH -> inline edit

components/meals/
  PlanClient.tsx       # week grid/cards, generate button, lock + reroll controls
  DishesClient.tsx     # editable grouped table, filter/search, add-dish
```

**Engine is the core.** `engine.ts` exports pure functions operating on plain data
`(dishes, existingPlans, picksThisRun, constraints)` and returning picks. It never imports Supabase
or Next. Route handlers own all DB reads/writes and hand plain arrays to the engine. This keeps the
risky algorithm isolated and unit-testable.

## Types (`lib/meals/types.ts`)

```ts
export const SLOTS = ['utama','kuah','pelengkap','sayuran','desert'] as const
export type Slot = typeof SLOTS[number]
export const SLOT_LABELS: Record<Slot,string> = {
  utama:'Utama', kuah:'Kuah', pelengkap:'Pelengkap', sayuran:'Sayuran', desert:'Desert'
}
export type Tier = 'everyday'|'nice'|'special'
export const DEFAULT_NO_REPEAT: Record<Slot,number> =
  { utama:14, kuah:7, pelengkap:7, sayuran:7, desert:10 }

export type Dish = {
  id:string; name:string; slot:Slot; protein:string; tier:Tier;
  method:string|null; spicy:boolean; rating:number; active:boolean;
  no_repeat_days:number|null
}
export type MealPlan = {
  id:string; plan_date:string; slot:Slot; dish_id:string|null;
  dish_name:string|null; locked:boolean
}
// pick returned by the engine (before it gets an id from the DB)
export type Pick = { plan_date:string; slot:Slot; dish_id:string|null;
  dish_name:string|null; locked:boolean; note?:string }
```

## Generation algorithm (`engine.ts`)

`generateWeek({ weekStart, days, dishesBySlot, priorPlans, lockedCells, rng })` → `Pick[]` (35 cells).

1. **Context.** `days` = 7 dates from `weekStart` (Mon). `priorPlans` = plans in the lookback window
   before `weekStart` (up to the max no-repeat window, 14d). `lockedCells` are pre-placed immovable picks.

2. **Pre-assign special mains.** Choose **2 non-adjacent days** for special-tier `utama`. Honor any
   locked special already present; avoid days whose locked cells already hold a special (day cap = 1
   special). Chosen days force `tier=special` utama candidates; other days force non-special utama.
   If the special-utama pool is too small, place what's possible and attach a `note`.

3. **Fill day-by-day, slots in display order** (utama→kuah→pelengkap→sayuran→desert). For each empty
   (non-locked) cell, candidate pool = active dishes of that slot passing **hard rules** vs
   `priorPlans` + all picks already made this run (earlier days and earlier slots today) + day constraints.

4. **Weighted pick.** `weight = rating^2 * freshness`, `freshness = clamp(days_since_last / no_repeat_window, 1, 2)`
   (never-served dishes get the 2× cap). Weighted-random choose one via injected `rng` (seedable for tests).

5. **Relaxation ladder** when a pool is empty: drop R5 → drop R4 → halve the no-repeat window
   (floor 2 days) → last resort allow any active dish of the slot. **Never** relax R1 below 2 days.
   Record the relaxation level in `note`.

### Hard rules
- **R1 No-repeat window:** a dish can't reappear within N days of a prior use, checking both
  `priorPlans` (DB history) AND picks earlier in this run. N = `dish.no_repeat_days` else slot default.
- **R2 Utama protein continuity:** a day's utama protein ≠ previous day's utama protein (previous day
  from this run or, for day 0, from `priorPlans`).
- **R3 Special tiering:** special `utama` only on a pre-assigned special day; at most **1** special
  dish across ALL slots in a single day (kuah specials like Steamboat count toward this per-day cap).
  Weekly quota of 2 specials is enforced via the pre-assignment in step 2 (utama slot).
- **R4 Fried cap:** ≤2 dishes with `method='fried'` per day across all 5 slots.
- **R5 Spicy floor:** ≥2 non-spicy dishes per day — enforced as: don't pick a spicy dish if doing so
  makes "≥2 non-spicy across the day's 5 slots" impossible given remaining unfilled slots.

### Exported pure helpers (individually testable)
`passesHardRules(dish, ctx)`, `noRepeatOk(dish, ctx)`, `freshnessFactor(dish, ctx)`,
`weightedPick(candidates, rng)`, `pickForSlot(slot, ctx)` (applies rules + relaxation + weighted pick),
`preassignSpecialDays(days, locked, specialPool)`, `generateWeek(...)`.

`reroll` reuses `pickForSlot` with the target cell removed from context. `alternatives` returns the
top-N surviving candidates (highest weight first) without writing.

## API routes

- **`POST /api/meals/generate`** — body `{ weekStart:'YYYY-MM-DD' }`. Reads active dishes + prior plans
  + existing locked cells for the week; runs `generateWeek`; **upserts on `(plan_date, slot)`** skipping
  locked rows server-side; returns the full week (35 cells).
- **`POST /api/meals/reroll`** — body `{ plan_date, slot }`. Re-rolls one cell against the rest of that
  day + surrounding week; upserts (unless locked → 409/no-op); returns the new pick.
- **`GET /api/meals/reroll?plan_date=&slot=&alternatives=N`** — returns up to N candidate dishes that
  pass the hard rules for that cell, highest-weight first. No write.
- **`PATCH /api/meals/plan/[id]`** — toggle `locked`, or swap `dish_id`+`dish_name` for a cell.
- **`POST /api/meals/dishes`** — insert a new dish (defaults: rating 3, active true).
- **`PATCH /api/meals/dishes/[id]`** — inline edit any dish field.

All routes use the shared `supabase` client and return `{error}` + non-200 on failure, matching
existing shopping routes.

## UI

### `app/meals/layout.tsx`
Homespace header (title, "Hi, {name}" from `hs_session`, sign out) + Plan / Dishes tab switch
(active tab gets an orange underline). Wraps both pages.

### Plan view — `PlanClient.tsx`
- **Week bar:** `‹ Mon DD – Sun DD ›` prev/next arrows + "This week" button; **Generate Week** button
  (orange primary) POSTs `{weekStart}`, swaps in returned non-locked cells.
- **Desktop (`sm+`):** 7 day-columns × 5 slot-rows grid.
- **Mobile-first (`<sm`):** horizontal swipeable stack of per-day cards (one day card shows its 5 slots).
- **Slot cell:** dish name; tier badge (everyday=stone, nice=amber, special=orange); 🌶️ if spicy;
  special cells get a subtle orange ring so "2 specials/week" is visually obvious.
- **Cell controls** (hover on desktop, always-visible on mobile): 🔒 lock/unlock (PATCH `plan/[id]`);
  "Want something else?" dropdown of 3–5 alternatives (reroll GET) → selecting swaps just that cell
  (POST reroll, optimistic).
- Empty/unfillable cell renders an "—" placeholder, never crashes.

### Dishes view — `DishesClient.tsx`
- Filter-by-slot pills + name search box.
- Dishes grouped by slot (display order); each section has **Add dish** (inserts editable blank row).
- Columns: name (text), protein (dropdown), tier (dropdown), method (dropdown), spicy (toggle),
  rating (1–5 clickable stars), active (toggle). Each change → debounced PATCH `dishes/[id]`, optimistic.

### Home card — `app/page.tsx`
Add to `features`:
`{ href:'/meals', icon: UtensilsCrossed, label:'Meals', description:'Weekly meal planner', color:'bg-amber-50 text-amber-600' }`.
Import `UtensilsCrossed` from lucide-react. (No "Soon" badge exists to remove.)

## Data flow, error handling, edge cases

- Server components fetch initial data via shared `supabase`; clients seed local state from props and
  do optimistic writes with rollback on error (matches `ShoppingClient`).
- `dish_name` snapshot written at pick time survives later dish renames/deactivation.
- Generate filters locked rows server-side, so a stale client can't overwrite a lock.
- Edge cases: all-locked week → generate is a no-op returning existing; tiny special pool → pre-assign
  fills what it can + note; regenerating overwrites only non-locked cells.

## Testing

Add `vitest` dev dep + `"test": "vitest"` script. `engine.test.ts` covers, with fixture dishes and a
seeded RNG: R1–R5 individually, relaxation ladder order, special-day pre-assignment (exactly 2,
non-adjacent), and weighted-pick determinism. UI and routes verified manually via `next dev`.

## Non-goals (YAGNI)

- No per-pick user attribution / audit log.
- No shopping-list generation from the plan (future).
- No drag-and-drop reordering; swaps happen via reroll dropdown only.
- No auth/RLS changes — reuse existing anon-key access like shopping.
