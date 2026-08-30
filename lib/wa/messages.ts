import { addToUnitClasses, dominantUnitClass, formatUnitClass, type UnitClass } from '../meals/qty'
import { weekDates } from '../meals/dates'
import {
  classifyShoppingGroup, sectionOf, shoppingSubRank, SHOPPING_GROUP_RANK, SHOPPING_SECTION_EMOJI, SHOPPING_SECTION_LABEL,
} from '../meals/shoppingGroups'
import { shoppingPageUrl, dayPageUrl, mealsWeekUrl, prepPageUrl } from './config'
import { indonesianDayName } from './schedule'
import type {
  WeeklyShoppingItem, ShopIngredientRow, DailyPlanRow, PrepDishRow, WeeklyMealPlanRow,
  FruitPrepItemRow,
} from './types'

// ---- Weekly shopping ---------------------------------------------------------

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
  // "Lainnya" (bought-as-is items with no real ingredient breakdown that
  // aren't fruit — e.g. a dessert) is dropped from the message entirely, same
  // as the app's shopping page — this is meant to read as an actual market
  // list, not a catch-all.
  const withGroup = items
    .map(i => ({ ...i, group: classifyShoppingGroup(i.ingredient, i.category) }))
    .filter(i => i.group !== 'lainnya')

  if (withGroup.length === 0) {
    return `🛒 Belum ada yang perlu dibeli minggu ini — santai dulu, ya! 💛\n${shoppingPageUrl(weekStart)}`
  }

  withGroup.sort((a, b) =>
    SHOPPING_GROUP_RANK[a.group] - SHOPPING_GROUP_RANK[b.group]
    || shoppingSubRank(sectionOf(a.group), a.ingredient) - shoppingSubRank(sectionOf(b.group), b.ingredient)
    || a.ingredient.localeCompare(b.ingredient))

  const lines: string[] = []
  let lastSection: string | null = null
  for (const item of withGroup) {
    const section = sectionOf(item.group)
    if (section !== lastSection) {
      if (lastSection !== null) lines.push('')
      lines.push(`${SHOPPING_SECTION_EMOJI[section]} ${SHOPPING_SECTION_LABEL[section]}`)
      lastSection = section
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

// ---- Weekly batch prep (post-shopping) ---------------------------------------
// Two independent messages for the SAME weekly prep session: Wife gets a
// short packing list grouped by COURSE, Kevin gets the fruit/yogurt
// portioning. The Wife message is deliberately terse — one line per bag —
// NOT one block per dish with every ingredient spelled out; that read as a
// wall of text once soups grew a 3-4 ingredient star+base. lib/meals/
// batchPrep.ts's buildMainLines/buildSoupLines/buildVegLines do the actual
// "what goes on this line" work; this just numbers and sections them.

function courseSection(label: string, lines: string[]): string | null {
  if (lines.length === 0) return null
  return [`*${label}*`, ...lines.map((l, i) => `${i + 1}. ${l}`)].join('\n')
}

export function composeBatchPrepWifeMessage(
  packingList: { main: string[]; soup: string[]; veg: string[] }, weekStart: string,
): string | null {
  const sections = [
    courseSection('Main', packingList.main),
    courseSection('Soup', packingList.soup),
    courseSection('Veg', packingList.veg),
  ].filter((s): s is string => s !== null)
  if (sections.length === 0) return null
  return [
    '🔪 Prep minggu ini:',
    '',
    sections.join('\n\n'),
    '',
    'Makasih ya 🧡',
    prepPageUrl(weekStart, 'wife'),
  ].join('\n')
}

function stepText(step: { instruction: string; amount_display: string | null }): string {
  return step.amount_display ? `${step.instruction} (${step.amount_display})` : step.instruction
}

export function composeBatchPrepKevinMessage(fruitItems: FruitPrepItemRow[], weekStart: string): string | null {
  if (fruitItems.length === 0) return null
  const lines = fruitItems.map(item => `• ${stepText(item)}`)
  return [
    '🍌 Prep buah minggu ini:',
    '',
    ...lines,
    '',
    prepPageUrl(weekStart, 'kevin'),
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
  const earliestCookDate = [...dishes].map(d => d.cook_date).sort()[0]

  return [
    '🧊 Malam ini siapkan:',
    ...clauses.map(c => `- ${c}`),
    '',
    dayPageUrl(earliestCookDate),
  ].join('\n')
}
