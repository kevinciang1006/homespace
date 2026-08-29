import { addToUnitClasses, dominantUnitClass, formatUnitClass, type UnitClass } from '../meals/qty'
import { weekDates } from '../meals/dates'
import { shoppingPageUrl, dayPageUrl, mealsWeekUrl } from './config'
import { indonesianDayName } from './schedule'
import type { WeeklyShoppingItem, ShopIngredientRow, DailyPlanRow, PrepDishRow, WeeklyMealPlanRow } from './types'

// ---- Weekly shopping ---------------------------------------------------------

// Message-only grouping — deliberately finer than the app's ShopCategory
// (protein/vegetable/bumbu/pantry/other/dish): "aromatics" (chilies, garlic,
// ginger, scallion, celery, tomato, lime) read to a home cook as bumbu even
// though they're stored as category='veg' (they're fresh, not a packet), and
// fruit needs splitting out of the generic "dishes with no ingredients"
// bucket. Classified by ingredient NAME so it works regardless of whether the
// item came from a live dish_ingredients join or a persisted/raw fallback.
type MsgGroup = 'protein' | 'veg_main' | 'bumbu_packet' | 'bumbu_aromatic' | 'fruit' | 'lainnya'
const GROUP_RANK: Record<MsgGroup, number> = {
  protein: 0, veg_main: 1, bumbu_packet: 2, bumbu_aromatic: 3, fruit: 4, lainnya: 5,
}
const GROUP_HEADER: Record<MsgGroup, string> = {
  protein: '🥩 Protein', veg_main: '🥦 Sayur', bumbu_packet: '🧂 Bumbu', bumbu_aromatic: '🧂 Bumbu',
  fruit: '🍎 Buah', lainnya: '🛍️ Lainnya',
}
const AROMATIC_NAMES = new Set([
  'Cabai Rawit', 'Cabai Hijau', 'Cabai Merah Besar', 'Cabai Merah Keriting', 'Cabai Kering',
  'Bawang Putih', 'Jahe', 'Daun Bawang', 'Daun Bawang Prei', 'Seledri', 'Tomat', 'Tomat Hijau',
  'Jeruk Nipis', 'Jeruk Limau',
])
const FRUIT_KEYWORDS = [
  'apple', 'banana', 'pisang', 'jeruk', 'orange', 'pear', 'pepaya', 'papaya', 'semangka',
  'watermelon', 'mangga', 'mango', 'anggur', 'grape', 'nanas', 'pineapple', 'alpukat',
  'avocado', 'guava', 'jambu',
]

function messageGroup(ingredient: string, category: string): MsgGroup {
  const cat = category.trim().toLowerCase()
  if (cat === 'dish') {
    const lower = ingredient.toLowerCase()
    return FRUIT_KEYWORDS.some(k => lower.includes(k)) ? 'fruit' : 'lainnya'
  }
  if (cat === 'protein') return 'protein'
  if (cat === 'bumbu') return 'bumbu_packet'
  if (AROMATIC_NAMES.has(ingredient)) return 'bumbu_aromatic'
  if (cat === 'vegetable' || cat === 'veg') return 'veg_main'
  return 'lainnya'
}

// Sums items across dishes with proper unit conversion (g/kg -> g, ml/L ->
// ml; count units summed only against an exact matching unit) instead of the
// old exact-string-match grouping, which silently left "Ayam 1kg" and
// "Ayam 600g" as two separate lines. Used for the raw-shop_ingredients
// fallback path (no meal_shopping_lists row generated yet for the week).
export function sumShopIngredients(rows: ShopIngredientRow[]): WeeklyShoppingItem[] {
  const byKey = new Map<string, { ingredient: string; category: string; classes: Map<string, UnitClass> }>()
  for (const r of rows) {
    const key = r.item.trim().toLowerCase()
    let entry = byKey.get(key)
    if (!entry) { entry = { ingredient: r.item.trim(), category: r.category, classes: new Map() }; byKey.set(key, entry) }
    addToUnitClasses(entry.classes, r.amount, r.unit)
  }
  return [...byKey.values()].map(v => {
    const dominant = dominantUnitClass(v.classes)
    return { ingredient: v.ingredient, category: v.category, quantity: dominant ? formatUnitClass(dominant) : null }
  })
}

export function composeWeeklyShoppingMessage(items: WeeklyShoppingItem[], weekStart?: string): string {
  // "Lainnya" (breakfast-ish/bought-as-is items with no real ingredient
  // breakdown, e.g. leftover from before breakfast dishes were excluded from
  // the shopping build, or anything else that doesn't fit protein/veg/bumbu/
  // fruit) is deliberately left off the WhatsApp message — this is meant to
  // read as an actual market list, not a catch-all. It still shows on the
  // app's shopping page under "Dishes this week" for completeness.
  const withGroup = items
    .map(i => ({ ...i, group: messageGroup(i.ingredient, i.category) }))
    .filter(i => i.group !== 'lainnya')

  if (withGroup.length === 0) {
    return `🛒 Belum ada yang perlu dibeli minggu ini — santai dulu, ya! 💛\n${shoppingPageUrl(weekStart)}`
  }

  withGroup.sort((a, b) => GROUP_RANK[a.group] - GROUP_RANK[b.group] || a.ingredient.localeCompare(b.ingredient))

  const lines: string[] = []
  let lastHeader: string | null = null
  for (const item of withGroup) {
    const header = GROUP_HEADER[item.group]
    if (header !== lastHeader) {
      if (lastHeader !== null) lines.push('')
      lines.push(header)
      lastHeader = header
    }
    lines.push(item.quantity ? `- ${item.ingredient} ${item.quantity}` : `- ${item.ingredient}`)
  }

  return [
    '🛒 Belanja minggu ini:',
    '',
    ...lines,
    '',
    'Makasih ya 🧡',
    shoppingPageUrl(weekStart),
  ].join('\n')
}

// ---- Weekly meal overview (prepended to the shopping message) --------------
// Compact per-day line: main, then soup/veg, then dish-helper, in that order
// — matches the slot order the meal-planning engine itself uses (utama ->
// kuah -> sayuran -> pelengkap). Breakfast and fruit/dessert are deliberately
// excluded — this is "what's for dinner", not the full day.
const OVERVIEW_SLOTS = ['utama', 'kuah', 'sayuran', 'pelengkap']

function shortDay(dateStr: string): string {
  const [, m, d] = dateStr.split('-')
  return `${indonesianDayName(dateStr).slice(0, 3)} ${Number(d)}/${Number(m)}`
}

export function composeMealOverview(weekStart: string, rows: WeeklyMealPlanRow[]): string | null {
  const byDate = new Map<string, WeeklyMealPlanRow[]>()
  for (const r of rows) {
    if (r.skipped || !r.dish_name || !OVERVIEW_SLOTS.includes(r.slot)) continue
    const list = byDate.get(r.plan_date) ?? []
    list.push(r)
    byDate.set(r.plan_date, list)
  }

  const lines: string[] = []
  for (const date of weekDates(weekStart)) {
    const dayRows = byDate.get(date)
    if (!dayRows || dayRows.length === 0) continue
    const ordered = OVERVIEW_SLOTS.flatMap(slot => dayRows.filter(r => r.slot === slot).map(r => r.dish_name as string))
    if (ordered.length === 0) continue
    lines.push(`${shortDay(date)}: ${ordered.join(', ')}`)
  }
  if (lines.length === 0) return null

  return ['🍽️ Menu minggu ini:', ...lines, '', mealsWeekUrl(weekStart)].join('\n')
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
  const earliestCookDate = [...dishes].map(d => d.cook_date).sort()[0]

  return [
    '🧊 Malam ini siapkan:',
    ...clauses.map(c => `- ${c}`),
    '',
    dayPageUrl(earliestCookDate),
  ].join('\n')
}
