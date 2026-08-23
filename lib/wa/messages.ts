import { formatQtyAmount } from '../meals/qty'
import { HOMESPACE_URL, shoppingPageUrl, dayPageUrl } from './config'
import { indonesianDayName } from './schedule'
import type { WeeklyShoppingItem, ShopIngredientRow, DailyPlanRow, PrepDishRow } from './types'

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
  if (items.length === 0) {
    return `🛒 Belum ada yang perlu dibeli minggu ini — santai dulu, ya! 💛\n${shoppingPageUrl()}`
  }

  const sorted = [...items].sort(
    (a, b) => GROUP_ORDER.indexOf(shoppingGroup(a.category)) - GROUP_ORDER.indexOf(shoppingGroup(b.category)),
  )
  const lines = sorted.map(item => (item.quantity ? `${item.ingredient} ${item.quantity}` : item.ingredient))

  return [
    '🛒 Belanja minggu ini:',
    ...lines.map(l => `- ${l}`),
    '',
    'Makasih ya 🧡',
    shoppingPageUrl(),
  ].join('\n')
}

// ---- Daily meal reminder ------------------------------------------------------

export function composeDailyReminderMessage(dateStr: string, rows: DailyPlanRow[]): string | null {
  const planned = rows.filter(r => r.dish_id && !r.skipped)
  if (planned.length === 0) return null

  const breakfast = planned.find(r => r.slot === 'breakfast')?.dish_name
  const main = planned.find(r => r.role === 'main')?.dish_name
  const supports = planned.filter(r => r.role === 'support').map(r => r.dish_name).filter((n): n is string => !!n)
  const fruit = planned.find(r => r.slot === 'fruit')?.dish_name

  if (!breakfast && !main && supports.length === 0 && !fruit) return null

  const lines: string[] = [`🌤️ Besok, ${indonesianDayName(dateStr)}:`, '']
  if (breakfast) lines.push(`🌅 Sarapan: ${breakfast}`)
  if (main) lines.push(`🍽️ Makan malam: ${main}${supports.length ? ` + ${supports.join(', ')}` : ''}`)
  else if (supports.length) lines.push(`🍽️ Makan malam: ${supports.join(', ')}`)
  if (fruit) lines.push(`🍎 Buah: ${fruit}`)
  lines.push('', 'Selamat malam! 💛', dayPageUrl(dateStr))

  return lines.join('\n')
}

// ---- Prep / thaw reminder -----------------------------------------------------

export function composePrepThawMessage(dishes: PrepDishRow[]): string | null {
  if (dishes.length === 0) return null

  const clauses = dishes.map(d => {
    const phrase = d.prep_note?.trim()
      || (d.needs_thaw && d.needs_marinate ? 'thaw + marinate'
        : d.needs_thaw ? 'thaw'
        : d.needs_marinate ? 'marinate' : 'siapkan')
    return `${d.dish_name} (${indonesianDayName(d.cook_date)}) — ${phrase}`
  })

  return [
    '🧊 Malam ini siapkan:',
    ...clauses.map(c => `- ${c}`),
    '',
    HOMESPACE_URL,
  ].join('\n')
}
