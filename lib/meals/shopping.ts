export type DishIngredient = { name: string; quantity?: string | null; category?: string | null }

export const SHOP_CATEGORIES = ['protein', 'vegetable', 'pantry', 'other'] as const
export type ShopCategory = (typeof SHOP_CATEGORIES)[number]

export type BuiltIngredient = {
  ingredient: string
  quantity: string | null
  category: ShopCategory
  from_dishes: { dish: string; quantity?: string | null }[]
}
export type BuiltList = {
  ingredients: BuiltIngredient[]
  dishesWithoutIngredients: string[]
}

export function normalizeCategory(c: string | null | undefined): ShopCategory {
  const lower = (c ?? '').trim().toLowerCase()
  return (SHOP_CATEGORIES as readonly string[]).includes(lower) ? (lower as ShopCategory) : 'other'
}

export function buildShoppingList(
  plans: { dish_id: string | null; dish_name: string | null }[],
  dishById: Map<string, { name: string; ingredients: DishIngredient[] | null }>,
): BuiltList {
  const agg = new Map<string, BuiltIngredient & { _quantities: string[] }>()
  const noIng: string[] = []
  const noIngSeen = new Set<string>()

  for (const p of plans) {
    if (!p.dish_id) continue
    const dish = dishById.get(p.dish_id)
    if (!dish) continue
    const name = dish.name
    const ingredients = dish.ingredients ?? []

    if (ingredients.length === 0) {
      if (!noIngSeen.has(name)) { noIngSeen.add(name); noIng.push(name) }
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

  return { ingredients, dishesWithoutIngredients: noIng }
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
