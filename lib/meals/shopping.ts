import {
  formatQtyAmount, addToUnitClasses, dominantUnitClass, formatUnitClass, type UnitClass,
} from './qty'

export type DishIngredient = { name: string; quantity?: string | null; category?: string | null }

export const SHOP_CATEGORIES = ['protein', 'vegetable', 'bumbu', 'pantry', 'other'] as const
export type ShopCategory = (typeof SHOP_CATEGORIES)[number]

export type BuiltIngredient = {
  ingredient: string
  quantity: string | null
  category: ShopCategory
  from_dishes: { dish: string; quantity?: string | null }[]
}
export type MixedUnitWarning = { ingredient: string; detail: string }
export type BuiltList = {
  ingredients: BuiltIngredient[]
  dishesWithoutIngredients: string[]
  // Populated only by buildShoppingListFromDishIngredients: ingredients whose
  // dish_ingredients rows used incompatible units (e.g. "2 pcs" in one dish,
  // "550g" in another) — a dish-data problem, not something to silently
  // string-concatenate. See dominantUnitClass in qty.ts for how the shown
  // total is chosen.
  mixedUnitWarnings?: MixedUnitWarning[]
}

export function normalizeCategory(c: string | null | undefined): ShopCategory {
  const lower = (c ?? '').trim().toLowerCase()
  if (lower === 'veg') return 'vegetable'
  return (SHOP_CATEGORIES as readonly string[]).includes(lower) ? (lower as ShopCategory) : 'other'
}

export function buildShoppingList(
  plans: { dish_id: string | null; dish_name: string | null }[],
  dishById: Map<string, {
    name: string; ingredients: DishIngredient[] | null
    qty_amount?: number | null; qty_unit?: string | null; qty_note?: string | null
  }>,
): BuiltList {
  const agg = new Map<string, BuiltIngredient & { _quantities: string[] }>()
  // Dishes bought as-is (no structured ingredients): tally how many times each
  // lands in the week so its qty_amount can be summed into a single buy line.
  const noIng = new Map<string, { name: string; count: number; qty_amount?: number | null; qty_unit?: string | null; qty_note?: string | null }>()

  for (const p of plans) {
    if (!p.dish_id) continue
    const dish = dishById.get(p.dish_id)
    if (!dish) continue
    const name = dish.name
    const ingredients = dish.ingredients ?? []

    if (ingredients.length === 0) {
      const existing = noIng.get(p.dish_id)
      if (existing) existing.count += 1
      else noIng.set(p.dish_id, { name, count: 1, qty_amount: dish.qty_amount, qty_unit: dish.qty_unit, qty_note: dish.qty_note })
      continue
    }

    for (const ing of ingredients) {
      const key = ing.name.trim().toLowerCase()
      if (!key) continue
      let row = agg.get(key)
      if (!row) {
        row = {
          ingredient: ing.name.trim(),
          quantity: null,
          category: normalizeCategory(ing.category),
          from_dishes: [],
          _quantities: [],
        }
        agg.set(key, row)
      }
      row.from_dishes.push({ dish: name, quantity: ing.quantity ?? null })
      const q = (ing.quantity ?? '').trim()
      if (q && !row._quantities.includes(q)) row._quantities.push(q)
    }
  }

  const catOrder = (c: ShopCategory) => SHOP_CATEGORIES.indexOf(c)
  const ingredients: BuiltIngredient[] = [...agg.values()]
    .map(({ _quantities, ...r }) => ({ ...r, quantity: _quantities.length ? _quantities.join(' + ') : null }))
    .sort((a, b) => catOrder(a.category) - catOrder(b.category) || a.ingredient.localeCompare(b.ingredient))

  const dishesWithoutIngredients = [...noIng.values()].map(d => {
    if (d.qty_amount != null && d.qty_unit) return `${d.name} ${formatQtyAmount(d.qty_amount * d.count, d.qty_unit)}`
    return d.name
  })

  return { ingredients, dishesWithoutIngredients }
}

// ---- Aggregation from the normalized ingredients tables --------------------
// The current source of truth for the shopping list: dish_ingredients (via a
// week's meal_plans) joined against the canonical ingredients table, instead
// of the old free-text dishes.ingredients jsonb. Same summing behavior as
// buildShoppingList (same-unit amounts are summed into one number; different
// units for the same ingredient are kept as separate "amount unit" segments
// joined with " + "), just keyed by ingredient_id instead of a normalized
// name string — the normalization already happened once, at migration time.
export type IngredientRef = { id: string; name: string; category: string | null; default_unit: string | null; shelf_stable?: boolean }
export type DishIngredientLink = { ingredient_id: string; amount: number | null; unit: string | null }

export function buildShoppingListFromDishIngredients(
  plans: { dish_id: string | null; dish_name: string | null }[],
  dishIngredientsByDish: Map<string, DishIngredientLink[]>,
  ingredientById: Map<string, IngredientRef>,
  dishMetaById: Map<string, { name: string; qty_amount?: number | null; qty_unit?: string | null; qty_note?: string | null }>,
): BuiltList {
  const agg = new Map<string, {
    ingredient: string; category: ShopCategory
    from_dishes: BuiltIngredient['from_dishes']
    classes: Map<string, UnitClass>
  }>()
  const noIng = new Map<string, { name: string; count: number; qty_amount?: number | null; qty_unit?: string | null; qty_note?: string | null }>()

  for (const p of plans) {
    if (!p.dish_id) continue
    const meta = dishMetaById.get(p.dish_id)
    const name = meta?.name ?? p.dish_name ?? 'Unknown dish'
    const links = dishIngredientsByDish.get(p.dish_id) ?? []

    if (links.length === 0) {
      const existing = noIng.get(p.dish_id)
      if (existing) existing.count += 1
      else noIng.set(p.dish_id, { name, count: 1, qty_amount: meta?.qty_amount, qty_unit: meta?.qty_unit, qty_note: meta?.qty_note })
      continue
    }

    for (const link of links) {
      const ing = ingredientById.get(link.ingredient_id)
      if (!ing) continue
      // Shelf-stable pantry items (salt, oil, garlic powder…) are things a
      // household always has — they show on the dish's own ingredient list
      // (via /api/meals/dishes/[id]/ingredients) but never on the shopping
      // list. The dish still counts as "has ingredients" (links.length was
      // already checked above), so it doesn't fall into the no-ingredients
      // fallback just because everything it needs happens to be pantry.
      if (ing.shelf_stable) continue
      let row = agg.get(ing.id)
      if (!row) {
        row = { ingredient: ing.name, category: normalizeCategory(ing.category), from_dishes: [], classes: new Map() }
        agg.set(ing.id, row)
      }
      const amount = link.amount
      const unit = link.unit ?? ing.default_unit ?? null
      row.from_dishes.push({ dish: name, quantity: amount != null && unit ? formatQtyAmount(amount, unit) : null })
      if (amount != null && unit) addToUnitClasses(row.classes, amount, unit)
    }
  }

  const catOrder = (c: ShopCategory) => SHOP_CATEGORIES.indexOf(c)
  const mixedUnitWarnings: MixedUnitWarning[] = []
  const ingredients: BuiltIngredient[] = [...agg.values()]
    .map(({ classes, ...r }) => {
      const dominant = dominantUnitClass(classes)
      if (classes.size > 1) {
        const detail = [...classes.values()]
          .map(c => `${formatUnitClass(c)} (${c.occurrences}x)`)
          .join(' vs ')
        mixedUnitWarnings.push({ ingredient: r.ingredient, detail: `mixed units: ${detail} — using ${dominant ? formatUnitClass(dominant) : '?'}` })
      }
      return { ...r, quantity: dominant ? formatUnitClass(dominant) : null }
    })
    .sort((a, b) => catOrder(a.category) - catOrder(b.category) || a.ingredient.localeCompare(b.ingredient))

  const dishesWithoutIngredients = [...noIng.values()].map(d => {
    if (d.qty_amount != null && d.qty_unit) return `${d.name} ${formatQtyAmount(d.qty_amount * d.count, d.qty_unit)}`
    return d.name
  })

  return { ingredients, dishesWithoutIngredients, mixedUnitWarnings }
}

// ---- Non-destructive regenerate --------------------------------------------
// A row the shopping list should contain, derived from the current plan.
export type ShoppingRow = {
  ingredient: string
  quantity: string | null
  category: string
  from_dishes: { dish: string; quantity?: string | null }[]
}

// Minimal shape the merge needs from an already-persisted item.
export type ExistingShoppingItem = {
  id: string
  ingredient: string
  from_dishes: { dish: string; quantity?: string | null }[] | null
}

export type ShoppingMerge = {
  toInsert: ShoppingRow[]
  toUpdate: { id: string; quantity: string | null; category: string; from_dishes: ShoppingRow['from_dishes'] }[]
  toDelete: string[]
}

// Flatten a BuiltList into the concrete rows the list should hold: aggregated
// ingredients, plus a 'dish' placeholder per dish that still has no ingredients.
export function targetRows(built: BuiltList): ShoppingRow[] {
  return [
    ...built.ingredients.map(i => ({
      ingredient: i.ingredient, quantity: i.quantity, category: i.category as string, from_dishes: i.from_dishes,
    })),
    ...built.dishesWithoutIngredients.map(name => ({
      ingredient: name, quantity: null, category: 'dish', from_dishes: [{ dish: name }],
    })),
  ]
}

// Reconcile the freshly-built rows against what's already saved, WITHOUT wiping
// user state. Manual items (from_dishes == null) are never touched. Plan-derived
// ("auto") items are matched by normalized ingredient name: matches are refreshed
// (checked/already_have are left alone by not updating them); unmatched auto rows
// are deleted; brand-new built rows are inserted.
export function mergeShoppingItems(existing: ExistingShoppingItem[], built: BuiltList): ShoppingMerge {
  const norm = (s: string) => s.trim().toLowerCase()
  const target = targetRows(built)

  const auto = existing.filter(e => e.from_dishes != null)
  const autoByKey = new Map<string, ExistingShoppingItem>()
  for (const e of auto) {
    const key = norm(e.ingredient)
    if (!autoByKey.has(key)) autoByKey.set(key, e) // first wins; extras are dropped below
  }
  const keptIds = new Set([...autoByKey.values()].map(e => e.id))

  const toInsert: ShoppingRow[] = []
  const toUpdate: ShoppingMerge['toUpdate'] = []
  const matchedKeys = new Set<string>()

  for (const row of target) {
    const key = norm(row.ingredient)
    if (matchedKeys.has(key)) continue
    matchedKeys.add(key)
    const match = autoByKey.get(key)
    if (match) toUpdate.push({ id: match.id, quantity: row.quantity, category: row.category, from_dishes: row.from_dishes })
    else toInsert.push(row)
  }

  const toDelete = auto
    .filter(e => !keptIds.has(e.id) || !matchedKeys.has(norm(e.ingredient)))
    .map(e => e.id)

  return { toInsert, toUpdate, toDelete }
}
