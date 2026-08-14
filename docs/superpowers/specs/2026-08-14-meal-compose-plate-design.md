# Meal Planner — Compose-a-Plate Redesign

**Date:** 2026-08-14
**Scope:** Rewrite generation (`app/api/meals/generate`, `reroll`), the engine's day assembly, and the plan view (`components/meals/PlanClient.tsx`) from "fill 5 fixed slots" to "compose a plate of ~3 dishes around one main."

## Goal

Each day is a composed plate — one protagonist **main**, a small number of **support** dishes sized by
the main's richness, and an **optional** desert — rendered as a hero-card layout. Replaces the equal-slot
grid.

## DB (already migrated)

`dishes` adds:
- `provides_soup boolean` — main is wet enough to replace a separate soup (12 utama dishes today).
- `richness 'light'|'medium'|'heavy'` — how filling (mains today: 29 medium, 9 heavy, 6 light).
- (`recipe_image_url` exists but is **null for all 99 dishes** → hero card shows a designed placeholder.)

`meal_plans` adds:
- `role 'main'|'support'|'optional'` — main is protagonist; desert is optional.
- `skipped boolean` — slot intentionally empty (soup when the main provides it); no dish.

## Composition algorithm (`lib/meals/engine.ts`)

`generateWeek` is rewritten to compose each day rather than fill 5 slots. Per day:

```
composeDay(date, ctx):
  1. main = pickForSlot('utama')  → role 'main'
       (existing utama rules: protein != yesterday's utama; 2 special/week non-adjacent via
        pre-assignment; rating^2 × freshness weighted; no-repeat window)
  2. extra = { heavy: 0, medium: 1, light: 1 }[main.richness]   // supports beyond the always-veg
  3. if main.provides_soup:
        emit kuah row { skipped: true, dish: null, role: 'support' }   // not budgeted, not counted
  4. veg = pickForSlot('sayuran')  → role 'support'   // ALWAYS included, free (does not consume extra)
     if extra >= 1:
        side = pickForSlot('pelengkap', preferNonFried = main.method === 'fried')  → role 'support'
        if side is null (pool empty) AND !main.provides_soup:
           soup = pickForSlot('kuah')  → role 'support'   // fallback only when no side fits
  5. desert = pickForSlot('desert')  → role 'optional'   // always, de-emphasized
```

Result per day: **1 main + 1 veg + (0–1 side/soup) + 1 desert**, plus a `skipped` kuah row only when
the main provides soup. Slots not chosen get **no row** (no assumption that all 5 slots exist).

Outcomes by richness (confirmed): heavy → Main + Veg; medium/light → Main + Veg + Side. Desert always.
Soup as its own card is rare by design (lowest priority; usually replaced by the "broth from main" note
or simply absent).

### Hard rules (still enforced inside each `pickForSlot`)
- **No-repeat window** per slot (DB history + picks this run), `dish.no_repeat_days` else slot default.
- **Utama protein** ≠ previous day's utama protein.
- **Special tier**: 2 special mains/week via pre-assignment, non-adjacent; ≤1 special across a day.
- **Fried cap**: ≤2 `method='fried'` dishes/day, counting ALL chosen dishes including desert.
- **Spicy (adapted)**: at least **1 non-spicy** dish among the day's main+supports (desert excluded from
  the check). Replaces the old "≥2 non-spicy" which assumed 5 slots. A spicy pick is rejected only when
  it would make the plate all-spicy given remaining planned picks; relaxation may drop it for tiny pools.
- **Relaxation ladder** unchanged in spirit (drop spicy → drop fried → halve no-repeat, floor 2 days).

### Types
`Pick` and `MealPlan` gain `role: 'main'|'support'|'optional'` and `skipped: boolean`.
`composeDay` returns `Pick[]` for the day; `generateWeek` concatenates 7 days.

## Persistence (`app/api/meals/generate/route.ts`)

1. Read active dishes (incl. `richness`, `provides_soup`, `method`, `recipe_image_url`) + prior plans
   (history window) + the week's existing rows.
2. Locked rows in the week are read first and passed as fixed inputs: a locked main fixes that day's
   richness/budget; locked supports count toward the plate and are not re-picked.
3. Run `generateWeek` with an injected RNG.
4. **Delete all non-locked `meal_plans` rows for the week**, then **insert** the composed rows
   (variable count) + `skipped` kuah rows. (Replaces the old fixed 35-row upsert.)
5. Return the full week (join dish meta for the UI).

## Reroll (`app/api/meals/reroll/route.ts`)

- **Reroll MAIN → re-compose the day.** Body `{ plan_date, slot: 'utama' }`. Keep the day's locked rows
  and the existing desert; delete the day's non-locked main+support rows; pick a new main; recompute
  budget + soup-skip; refill veg/side/soup around locked dishes; upsert. Return `{ day: MealPlan[] }`.
- **Reroll a support/optional → swap one.** Body `{ plan_date, slot }` (or `{ …, dish_id }` for an
  explicit choice) → single-slot re-pick against the rest of the day. Return `{ pick: MealPlan }`.
- `GET ?plan_date&slot&alternatives=N` → candidate list, unchanged.

## Plan UI (`components/meals/PlanClient.tsx`)

Week bar + Generate Week unchanged. Replace the equal-slot grid with **day plates**:

- **Layout:** desktop = responsive grid of day cards (1–3 cols by width); mobile = vertical stack of
  full-width plates.
- **MAIN hero:** large card, 16:9 image from `recipe_image_url` else a designed placeholder (stone→orange
  gradient + `UtensilsCrossed` glyph + name). Name prominent (DM Serif Display), tier + 🌶️ badges,
  special-tier orange ring. Lock + "want something else?" overlaid (always-visible on mobile). Reroll
  here re-composes the whole plate (calls the main-reroll → `{ day }`, replaces the day).
- **SUPPORT row:** horizontally scrollable row of small thumbnails (veg, side, soup), muted/secondary:
  slot label + name + tiny badges, each with its own lock + reroll (single-cell swap).
- **Soup-skipped note:** when the main provides soup, a subtle chip in the support row —
  "🥣 broth from the main — no extra soup" — instead of an empty slot.
- **Desert:** tiny muted single-line row at the bottom (`· desert: {name}`) with lock + reroll on
  hover/tap. Present but barely there.
- **Empty day:** soft placeholder plate before generation.
- Page fetch joins `dishes(tier, spicy, richness, provides_soup, recipe_image_url)` + `role`, `skipped`.

## Testing (`lib/meals/engine.test.ts`)

Rewrite generation tests for the compose model, with fixture dishes + seeded RNG:
- each day has exactly one `role='main'`.
- heavy main → main + veg only (no side/soup dish); medium/light → main + veg + exactly one support.
- `provides_soup` main → a `skipped` kuah row and no soup dish.
- desert always present, `role='optional'`.
- fried cap ≤2/day (incl. desert); at least 1 non-spicy in main+supports.
- special mains still 2/week, non-adjacent.
Keep hard-rule unit tests; update the spicy test to the new "at least 1 non-spicy" floor.
Routes + UI verified live against Supabase.

## Non-goals (YAGNI)

- No changes to Dishes or Shopping List views (shopping still reads whatever dishes are planned).
- No image upload flow; `recipe_image_url` is displayed if present, placeholder otherwise.
- No calorie/needs_thaw/recipe_steps usage in this pass.
- No auth/RLS changes.
