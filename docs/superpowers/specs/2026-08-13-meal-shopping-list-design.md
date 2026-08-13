# Meal Shopping List sub-app — Design

**Date:** 2026-08-13
**Route:** `/meals/shopping` (third tab under `/meals`)
**Stack:** Next.js App Router (16.2.4), TypeScript, Tailwind v4, Supabase (`lib/supabase.ts`, anon key), lucide-react, Vitest.

## Goal

A per-week shopping list under the Meal Planner, generated from that week's meal plan. It is a
persistent document per week (viewable/editable for any week, past or future), separate from the
existing ad-hoc WhatsApp shopping list. Match the existing Homespace design.

## Database (already created)

`meal_shopping_lists`: `id`, `week_start date` (unique), `generated_at`, `archived boolean`.

`meal_shopping_items`: `id`, `list_id` FK, `ingredient text`, `quantity text`, `category text`,
`already_have boolean`, `checked boolean`, `from_dishes jsonb`, `created_at`.

`dishes` now has `ingredients jsonb` — an array of `{ name, quantity, category }`. **Currently
null/empty for all 99 dishes**, so today every planned dish falls into the "add ingredients manually"
section; the aggregation path must still work for when ingredients get populated.

## Architecture & file layout

```
lib/meals/
  shopping.ts        # PURE builder: buildShoppingList(plans, dishById) -> { ingredients, dishesWithoutIngredients }
  shopping.test.ts   # Vitest unit tests
  dates.ts           # extend: add currentMonday(), shiftWeek(), mondayOf() (extracted from PlanClient/reroll)
  dates.test.ts      # extend with new helper tests

app/meals/shopping/page.tsx        # server: fetch current week's list + items -> <ShoppingListClient/>

app/api/meals/shopping/
  generate/route.ts    # POST {weekStart} -> full replace: rebuild items from plan
  route.ts             # GET ?weekStart -> { list, items }
  items/route.ts       # POST -> add manual item
  items/[id]/route.ts  # PATCH (toggle already_have/checked, edit name/quantity/category) + DELETE

components/meals/
  ShoppingListClient.tsx   # week nav, generate, grouped items, progress, add/edit/delete
  MealsTabs.tsx            # add third tab "Shopping List"
```

**`shopping.ts` is pure** — no Supabase/Next imports. Route handlers own all DB access and hand plain
data to the builder. Keeps ingredient aggregation isolated and unit-testable, mirroring `engine.ts`.

## Shared date helpers (DRY improvement)

`PlanClient.tsx` and `app/api/meals/reroll/route.ts` each inline `currentMonday`/`shiftWeek`/`mondayOf`.
Extract these into `lib/meals/dates.ts` (already pure, framework-free) and import from all three sites,
so the shopping view reuses identical week logic. Types unchanged; behavior identical.

- `currentMonday(): string` — this week's Monday (local).
- `shiftWeek(weekStart: string, deltaDays: number): string` — add days to a date string (local).
- `mondayOf(dateStr: string): string` — the Monday of the week containing `dateStr` (local).

## Builder — `lib/meals/shopping.ts`

```ts
export type DishIngredient = { name: string; quantity?: string | null; category?: string | null }
export const SHOP_CATEGORIES = ['protein', 'vegetable', 'pantry', 'other'] as const
export type ShopCategory = (typeof SHOP_CATEGORIES)[number]

export type BuiltIngredient = {
  ingredient: string          // display name (first-seen casing)
  quantity: string | null     // distinct source quantities joined with " + "
  category: ShopCategory
  from_dishes: { dish: string; quantity?: string | null }[]
}
export type BuiltList = {
  ingredients: BuiltIngredient[]
  dishesWithoutIngredients: string[]  // names of planned dishes with empty/null ingredients
}

// plans: { dish_id, dish_name }[] for the week (one per filled cell)
// dishById: Map<string, { name, ingredients: DishIngredient[] | null }>
export function buildShoppingList(
  plans: { dish_id: string | null; dish_name: string | null }[],
  dishById: Map<string, { name: string; ingredients: DishIngredient[] | null }>,
): BuiltList
```

Rules:
- Iterate planned cells with a `dish_id`. Look up the dish; read `ingredients` (default `[]`).
- **No ingredients (empty/null):** push `dish_name` to `dishesWithoutIngredients` (dedup by name).
- **Has ingredients:** for each `{name, quantity, category}`, aggregate into a map keyed by
  `name.trim().toLowerCase()`:
  - first sighting sets display `ingredient` (trimmed original casing) and `category` = normalize(category).
  - append `{ dish: dishName, quantity }` to `from_dishes`.
  - collect quantities; final `quantity` = distinct non-empty quantity strings joined with `" + "`,
    or `null` if none.
- `normalizeCategory(c)`: lowercased match against SHOP_CATEGORIES, else `'other'`.
- Return ingredients sorted by SHOP_CATEGORIES order then name; `dishesWithoutIngredients` in first-seen order.

## Data model mapping & persistence

`meal_shopping_items` holds three kinds, distinguished by `from_dishes`:
- **Aggregated ingredient** — `ingredient`, `quantity` (joined), `category` ∈ 4 buckets,
  `from_dishes = [{dish, quantity}, …]`.
- **Dish placeholder** (dish with no ingredients) — `category = 'dish'`, `ingredient = <dish name>`,
  `from_dishes = [{dish: <dish name>}]`. Renders in the "Dishes this week" section; excluded from progress.
- **Manual item** — user-added; `from_dishes = null` (identifies "manual").

`meal_shopping_lists`: `generate` upserts on `week_start`, sets `generated_at = now()`. `archived`
stays `false` (stored, no archive UI). Past weeks are earlier `week_start` rows, all readable.

## Generate = full replace + confirm

`POST /api/meals/shopping/generate { weekStart }`:
1. Read `meal_plans` for the week (Mon–Sun) with `dish_id`, `dish_name`.
2. Read all `dishes` (id, name, ingredients).
3. Run `buildShoppingList`.
4. Upsert the `meal_shopping_lists` row on `week_start` (get `list_id`).
5. **Delete ALL existing items** for `list_id`, then insert: aggregated ingredient rows +
   dish-placeholder rows (`category='dish'`).
6. Return `{ list, items }`.

Client shows a confirm dialog before regenerating when a list already exists for the week:
"This clears manually-added items and your ✓ marks." Manual items and marks are **not** preserved.

## API routes

- `POST /api/meals/shopping/generate` — `{ weekStart }` → `{ list, items }` (full replace).
- `GET /api/meals/shopping?weekStart=` → `{ list, items }` (`list` may be `null` if none yet).
- `POST /api/meals/shopping/items` — `{ list_id, ingredient, quantity?, category }` → inserted row
  (`from_dishes` null, `already_have` false, `checked` false).
- `PATCH /api/meals/shopping/items/[id]` — partial of `{ ingredient, quantity, category, already_have, checked }`.
- `DELETE /api/meals/shopping/items/[id]`.

All use the shared `supabase` client; return `{error}` + non-200 on failure, matching existing routes.

## UI — `ShoppingListClient.tsx`

- **Week bar** — `‹ Mon DD – Sun DD ›` prev/next + "This week" (shared `dates.ts` helpers). Week change
  fetches `GET /api/meals/shopping?weekStart=` and swaps state.
- **Header** — **"Generate shopping list from this week's plan"** button (orange primary) + progress pill
  **"{remaining} of {total} to buy"** where `total` = items with `category!=='dish'` and `!already_have`,
  `remaining` = those with `!checked`. Empty state (no list) shows just the Generate button.
- **Grouped items** — white rounded card per category in order protein → vegetable → pantry → other.
  Within a group, `already_have` items sink to the bottom, greyed. **Item row:** round green `checked`
  checkbox → strikethrough; inline-editable ingredient + quantity (blur saves via PATCH); category badge;
  **"Already have ✓"** toggle; delete button; tiny "for: Dish A, Dish B" caption when `from_dishes` set.
- **Add item** — inline form (name, quantity optional, category dropdown) → POST manual item.
- **Dishes this week** — bottom section listing `category='dish'` rows (name + "add ingredients manually"
  hint), each deletable. Not counted in progress.
- **Mobile-first** — single-column stacked cards; always-visible tap targets (no hover-only).

## Tab — `MealsTabs.tsx`

Add a third tab: `{ href: '/meals/shopping', label: 'Shopping List' }`. Active state via exact
`pathname === href` (unchanged logic; `/meals/shopping` won't falsely activate Plan or Dishes).

## Testing

- `lib/meals/shopping.test.ts`: aggregation by normalized name; quantity join with dedup; `from_dishes`
  accumulation; category bucketing (known + unknown→other); `dishesWithoutIngredients` collection &
  dedup; ingredient-less week yields only dish placeholders.
- `lib/meals/dates.test.ts`: `currentMonday` returns a Monday; `shiftWeek` adds days across month
  boundaries; `mondayOf` maps mid-week dates to their Monday.
- Routes + UI verified live against Supabase via `next dev` (generate, week nav, toggle, edit, delete,
  progress, confirm-on-regenerate).

## Non-goals (YAGNI)

- No archive UI / auto-archiving (field stored, unused).
- No preserving manual items or marks across regenerate (full replace, per decision).
- No unit math on quantities (join strings).
- No cross-linking to the WhatsApp/ad-hoc shopping list — this is independent.
- No auth/RLS changes — reuse anon-key access like the rest of `/meals`.
