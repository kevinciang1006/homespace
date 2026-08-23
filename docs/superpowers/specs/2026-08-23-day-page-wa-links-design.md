# Per-day meal page + WhatsApp deep links — design

## Goal

Two related changes: (A) a per-day view at `/meals/day/[date]` that shows one
day's full plan plus a "Preparation" section derived from each dish's
thaw/marinate/lead-time fields; (B) the three WhatsApp push messages become
simpler (flat shopping list, no category headers) and deep-link to the
specific page they're about instead of the homepage — the daily reminder and
prep/thaw messages link into the new day page.

## Non-goals

- No editing on the day page (no lock/reroll/mark-cooked) — it's a read-only
  view, since its primary audience is a phone tapping in from a WhatsApp
  link.
- No change to cron scheduling, dedupe, settings, or test-mode mechanics —
  only the two message bodies' text/links and one internal refactor.
- No change to the weekly shopping list's underlying data (still built from
  `meal_shopping_items` or `dishes.shop_ingredients`) — only its rendered
  format (flat vs grouped).

## Part A — `/meals/day/[date]/page.tsx`

### Data

`date` is validated against `^\d{4}-\d{2}-\d{2}$`; an invalid date renders
the same not-found treatment as `/meals/dish/[id]` for a missing dish.

Two queries, both against `meal_plans` joined to `dishes`:
1. That single date's rows — same `dishes(...)` embed as
   `app/api/meals/week/route.ts`, extended with `needs_thaw, needs_marinate,
   prep_lead_days, prep_note, bumbu_packet`. `MealPlan['dishes']` (in
   `lib/meals/types.ts`) gains these four fields (all optional, matching the
   existing style of that nested type).
2. A 14-day-ahead window (same `PREP_LOOKAHEAD_DAYS` as the cron route) for
   the look-ahead prep section — `dish_id, dish_name, plan_date, skipped,
   dishes(needs_thaw, needs_marinate, prep_lead_days, prep_note)`, filtered
   to `!skipped && dish_id is not null`.

### `lib/meals/prep.ts` (new, pure + unit-tested)

Extracted so the day page and the WA cron route share one implementation
instead of two copies of the same grouping/phrasing logic:

```ts
export type PrepCandidate = {
  dish_id: string
  dish_name: string
  cook_date: string
  needs_thaw: boolean
  needs_marinate: boolean
  prep_lead_days: number | null
  prep_note: string | null
}
export type PrepItem = Omit<PrepCandidate, 'prep_lead_days'>

export function groupPrepByDate(rows: PrepCandidate[]): Map<string, PrepItem[]>
export function prepPhrase(item: { needs_thaw: boolean; needs_marinate: boolean; prep_note: string | null }): string
```

`groupPrepByDate` is today's `buildPrepBatches` logic (in
`app/api/wa/cron/route.ts`), generalized. `prepPhrase` is today's inline
phrase derivation in `composePrepThawMessage`. `prepDateFor` — the date-math
this depends on — moves from `lib/wa/schedule.ts` to `lib/meals/dates.ts`
(it's meal-domain math, not WhatsApp-specific); `lib/wa/schedule.ts` drops
it, and the cron route's one call site imports it from `lib/meals/dates`
instead. `lib/wa/messages.ts` and its existing tests are untouched — the
cron route maps `groupPrepByDate`'s `PrepItem[]` back into the existing
`PrepDishRow[]` shape (drop `dish_id`) before calling
`composePrepThawMessage`, so the WA message-composition contract doesn't
change shape.

### Preparation section (the two sub-sections confirmed with Kevin)

- **"Today's dishes"** — for each of today's dishes with
  `needs_thaw`/`needs_marinate`, an informational recap line: dish name,
  `prepPhrase(...)`, and when it was prepped (`prepDateFor(today's cook
  date, dish.prep_lead_days)` rendered as a day name via
  `indonesianDayName`... actually English day name here, since this page's
  chrome is English like the rest of `/meals`; only the WhatsApp messages
  are Indonesian). E.g. "Babi — thaw + marinate (started Thu)".
- **"Prep tonight for upcoming days"** — the look-ahead list: every dish
  from the 14-day scan whose `groupPrepByDate` bucket is *today's* date,
  rendered as "Ayam (Mon) — thaw + marinate", each linking to that dish's
  own `/meals/day/[cook_date]`.
- Either sub-section is omitted entirely when empty; the whole Preparation
  card is omitted when both are empty.

### Rendering (`components/meals/DayView.tsx`, new, server component — no
`'use client'`, since nothing here is interactive)

Same visual language as the week grid, reusing what already exists:
`DishImage`, the tier-badge style, and `qtyDisplay` — the latter is
currently a private function inside `PlanClient.tsx`; it moves to
`lib/meals/qty.ts` (alongside `formatQty`/`formatQtyAmount`, which it
already wraps) as a named export, and `PlanClient.tsx` imports it from
there instead of defining it privately — one implementation, two
consumers.

Layout top to bottom: breakfast strip → dinner hero (main dish, larger,
image) + support chips (sayuran/kuah) → fruit/dessert line → Preparation
card → prev/next day arrows + "← Back to week" (linking to
`/meals?week=${mondayOf(date)}`).

`app/meals/page.tsx` gains a `searchParams.week` read: valid `YYYY-MM-DD` →
used as the initial `weekStart`; anything else → today's `currentMonday()`
(unchanged behavior when no query param is present, so this is purely
additive).

Per dish, when present: `recipe_links` rendered as plain external links
(`<a target="_blank">`, label = `title || url`, using the existing
`RecipeLink` type from `lib/meals/recipeLinks.ts`) — not the editable
`RecipeLinkButton` widget, since this page has no editing — and
`bumbu_packet` rendered as a small text badge (e.g. "Bumbu Rendang").

## Part B — WhatsApp message changes

### `lib/wa/config.ts` — new URL helpers

```ts
export function shoppingPageUrl(): string { return `${HOMESPACE_URL}/meals/shopping` }
export function dayPageUrl(date: string): string { return `${HOMESPACE_URL}/meals/day/${date}` }
```

### `composeWeeklyShoppingMessage` (flat list, no headers)

Items stay internally sorted protein → vegetable/veg → bumbu → other (same
`shoppingGroup` ordering as today), but rendered as one bulleted list with
no `*Protein*`/`*Sayur*`/`*Bumbu*` headings. Exact wording (matching
Kevin's example):

```
🛒 Belanja minggu ini:
- Ayam 1kg
- Ikan 1kg
- Babi 1kg
- Kangkung 500g
- Kentang 500g
- Bumbu Rendang

Makasih ya 🧡
https://homespace-chi.vercel.app/meals/shopping
```

The empty-list graceful message keeps its own wording but also links to
`shoppingPageUrl()` instead of the bare homepage.

### `composeDailyReminderMessage` (unchanged content, new link)

Only the trailing link changes, from `HOMESPACE_URL` to
`dayPageUrl(dateStr)` — the function already receives that exact date as
its first parameter, so no signature change.

### `composePrepThawMessage` (unchanged content, new link)

Only the trailing link changes, to `dayPageUrl(earliestCookDate)`, where
`earliestCookDate` is the lexicographically-smallest `cook_date` among the
batch's dishes (`YYYY-MM-DD` strings sort correctly as plain strings, so
`[...dishes].map(d => d.cook_date).sort()[0]` is sufficient — no date
parsing needed).

### Everything else in the cron route unchanged

Build/dedupe/send phases, `wa_settings`, test mode (still fires all three
via the same `?test=1&to=` query), the relay client — none of this changes;
only the two message bodies (via the composer functions above) and the one
internal `buildPrepBatches` → `groupPrepByDate` refactor.

## Testing

- `lib/meals/prep.test.ts` (new) — `groupPrepByDate` batching (same-evening
  grouping across different cook dates, skips dishes with neither flag),
  `prepPhrase` (note override, thaw-only, marinate-only, both).
- `lib/meals/dates.test.ts` — gains the `prepDateFor` cases moved from
  `lib/wa/schedule.test.ts`.
- `lib/wa/schedule.test.ts` — loses those cases; everything else unchanged.
- `lib/wa/messages.test.ts` — existing weekly-shopping cases updated for
  the flat-list format (no header assertions); existing daily/prep cases
  updated to assert the new link targets; no structural rewrite.

## Files touched

**New:** `lib/meals/prep.ts` (+ test), `app/meals/day/[date]/page.tsx`,
`components/meals/DayView.tsx`.

**Modified:** `lib/meals/types.ts` (`MealPlan['dishes']` gains 4 fields),
`lib/meals/dates.ts` (+ test) (gains `prepDateFor`), `lib/wa/schedule.ts`
(+ test) (loses `prepDateFor`), `lib/wa/config.ts` (2 new URL helpers),
`lib/wa/messages.ts` (+ test) (message format + links),
`app/api/wa/cron/route.ts` (`buildPrepBatches` refactor only),
`app/meals/page.tsx` (`searchParams.week`), `components/meals/PlanClient.tsx`
(`qtyDisplay` extracted to a shared location).
