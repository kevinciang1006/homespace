# Week Overview Panel — Design

**Date:** 2026-08-16
**Scope:** A friendly, at-a-glance "how's my week looking" panel at the top of the plan view, summarizing
the displayed week's balance from data already loaded. Informative, never error-styled.

## Data wiring

The panel needs `saltiness`, `difficulty`, `method` in addition to the fields the plan view already joins.
Add them to the dish join in all four sites and to the type:
- `app/meals/page.tsx`, `app/api/meals/week/route.ts`, `app/api/meals/generate/route.ts`,
  `app/api/meals/reroll/route.ts` (the `SELECT` const): `dishes(tier, spicy, richness, provides_soup,
  recipe_image_url, protein, saltiness, difficulty, method)`.
- `lib/meals/types.ts` `MealPlan.dishes`: add `saltiness: Saltiness; difficulty: Difficulty; method: string | null`.

No new API calls — `WeekOverview` computes from PlanClient's existing `week` state.

## Pure computation — `lib/meals/overview.ts`

```ts
export type SignalStatus = 'good' | 'neutral' | 'headsup'
export type Signal = { emoji: string; label: string; detail: string; status: SignalStatus }
export type WeekOverview = {
  hasPlan: boolean
  verdict: string          // e.g. "Balanced week 🌿"
  summary: string          // one-line, e.g. "2 special meals, 1 hard cook, nicely spread"
  signals: Signal[]
}
export function computeWeekOverview(rows: MealPlan[]): WeekOverview
```

Uses `rows` (MealPlan with `dishes` meta + `slot`/`role`/`plan_date`/`skipped`) and `daysBetween` from
`./dates`. Helpers: `main` per day = row with `role === 'main'` and a `dish_id`; short weekday label from
`plan_date` (local parse). `hasPlan = rows.some(r => r.dish_id)`.

Signals (each with emoji, label, human `detail`, status):
1. **🌶️ Spicy days** — days whose main is spicy. `detail`: count + day names; `headsup` if any two spicy
   mains on adjacent days ("2 spicy days in a row (Thu–Fri)"), else `good` ("nicely spread") / `neutral` if 0-1.
2. **⭐ Special meals** — count of special-tier mains + days. `good` if 2 ("Wed & Sat 👌"), else `neutral`.
3. **🔥 Difficulty** — count of `hard` dishes (any slot) + adjacency. `good` (easy/spread), `neutral`.
4. **🧂 Saltiness** — days with a non-normal-saltiness dish; `headsup` if any day has ≥2 ("Mon has 2 salty
   dishes"), else `good` ("balanced").
5. **🍳 Fried** — total fried (`method === 'fried'`) across the week; `headsup` note if a single day has 2,
   else `neutral`.
6. **🥩 Protein variety** — distinct main proteins; `headsup` if two same-protein mains on consecutive days
   ("Fish two days running (Sun–Mon)"), else `good` ("great variety").
7. **🥣 Soup coverage** — days with soup = a kuah dish OR a `provides_soup` main. `neutral`, informational.
8. **🍚 Portions & calories** — `detail: "coming soon"`, `status: neutral`, rendered greyed (placeholder).

**Verdict** (dominance heuristic, warm/casual):
- `spicyDays >= 3` → `"Spicy week 🌶️"`
- else `specialCount >= 2 && (hardCount >= 2 || friedTotal >= 6)` OR `friedTotal >= 7` → `"Hearty week 🍖"`
- else `hardCount <= 1 && friedTotal <= 3 && spicyDays <= 1` → `"Light & easy week 🥗"`
- else → `"Balanced week 🌿"`

`summary` = a short human join of the most notable signals.
No plan → `{ hasPlan:false, verdict:'No plan yet', summary:'Hit Generate Week to fill this week.', signals:[] }`.

## Component — `components/meals/WeekOverview.tsx`

- Full-width card (`bg-white border border-stone-200 rounded-2xl`) between the week bar and the day grid.
- **Verdict** as a DM Serif Display headline + the one-line `summary`, always visible.
- **Signal rows** (emoji, label, detail) in a responsive grid: `hidden sm:grid` (always shown on desktop),
  and on mobile shown only when `expanded`. A chevron button (visible `sm:hidden`) toggles `expanded`.
- Status dot/text color: `good` = green-600, `neutral` = stone-400, `headsup` = amber-600. **Never red.**
- Empty state (`!hasPlan`): the card shows the "No plan yet — hit Generate Week" line only.

## Wire into `PlanClient`

- `const overview = useMemo(() => computeWeekOverview(week), [week])`.
- Render `<WeekOverview overview={overview} />` between the week-selector row and the `<div className="grid …">`.
- Recomputes on week change (`loadWeek` sets `week`), generate, and reroll (all update `week`).

## Testing (`lib/meals/overview.test.ts`)

- `hasPlan` false for an empty week → verdict "No plan yet".
- Spicy-adjacent days → spicy signal `headsup`; spread → `good`.
- 2 special mains → special signal `good`.
- A day with 2 salty dishes → saltiness `headsup`.
- Two same-protein mains on consecutive days → protein `headsup`.
- Verdict heuristic: a spicy-heavy week → "Spicy week"; a light week → "Light & easy week".

## Non-goals

- No calorie/portion computation (placeholder only).
- No persistence of collapse state.
- No new endpoints.
