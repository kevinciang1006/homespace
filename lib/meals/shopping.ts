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
