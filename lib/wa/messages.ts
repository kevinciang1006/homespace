import { formatQtyAmount } from '../meals/qty'
import { HOMESPACE_URL } from './config'
import type { WeeklyShoppingItem, ShopIngredientRow } from './types'

// ---- Weekly shopping ---------------------------------------------------------

type ShoppingGroup = 'Protein' | 'Sayur' | 'Bumbu' | 'Lainnya'
const GROUP_ORDER: ShoppingGroup[] = ['Protein', 'Sayur', 'Bumbu', 'Lainnya']

function shoppingGroup(category: string): ShoppingGroup {
  const c = category.trim().toLowerCase()
  if (c === 'protein') return 'Protein'
  if (c === 'vegetable' || c === 'veg') return 'Sayur'
  if (c === 'bumbu') return 'Bumbu'
  return 'Lainnya' // pantry | other | dish | anything unrecognized
}

// Sums duplicate items (case-insensitive name match, same unit) drafted from
// dishes.shop_ingredients across a week's meal_plans, into the same shape a
// real meal_shopping_items query returns.
export function sumShopIngredients(rows: ShopIngredientRow[]): WeeklyShoppingItem[] {
  const byKey = new Map<string, { ingredient: string; category: string; total: number; unit: string }>()
  for (const r of rows) {
    const key = `${r.item.trim().toLowerCase()}|${r.unit}`
    const existing = byKey.get(key)
    if (existing) existing.total += r.amount
    else byKey.set(key, { ingredient: r.item.trim(), category: r.category, total: r.amount, unit: r.unit })
  }
  return [...byKey.values()].map(v => ({
    ingredient: v.ingredient,
    category: v.category,
    quantity: formatQtyAmount(v.total, v.unit),
  }))
}

export function composeWeeklyShoppingMessage(items: WeeklyShoppingItem[]): string {
  const groups = new Map<ShoppingGroup, string[]>()
  for (const item of items) {
    const g = shoppingGroup(item.category)
    const line = item.quantity ? `${item.ingredient} ${item.quantity}` : item.ingredient
    const list = groups.get(g) ?? []
    list.push(line)
    groups.set(g, list)
  }

  if (groups.size === 0) {
    return `🛒 Belum ada yang perlu dibeli minggu ini — santai dulu, ya! 💛\n${HOMESPACE_URL}`
  }

  const sections = GROUP_ORDER
    .filter(g => groups.has(g))
    .map(g => `*${g}*\n${groups.get(g)!.map(l => `- ${l}`).join('\n')}`)

  return [
    '🛒 Belanja minggu ini ya:',
    '',
    sections.join('\n\n'),
    '',
    'Makasih banyak! 💛',
    HOMESPACE_URL,
  ].join('\n')
}
