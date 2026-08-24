import type { MealPlan } from './types'
import { daysBetween } from './dates'

export type SignalStatus = 'good' | 'neutral' | 'headsup'
export type Signal = { emoji: string; label: string; detail: string; status: SignalStatus }
export type WeekOverview = { hasPlan: boolean; verdict: string; summary: string; signals: Signal[] }

function dayName(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short' })
}
function anyAdjacent(dates: string[]): boolean {
  const s = [...dates].sort()
  return s.some((a, i) => s.some((b, j) => i < j && Math.abs(daysBetween(a, b)) === 1))
}
function list(dates: string[]): string { return [...dates].sort().map(dayName).join(' & ') }

export function computeWeekOverview(rows: MealPlan[]): WeekOverview {
  const planned = rows.filter(r => r.dish_id && !r.skipped)
  if (planned.length === 0) {
    return { hasPlan: false, verdict: 'No plan yet', summary: 'Hit Generate Week to fill this week.', signals: [] }
  }
  const mains = planned.filter(r => r.role === 'main')
  const dates = [...new Set(planned.map(r => r.plan_date))].sort()
  const mainOn = (d: string) => mains.find(m => m.plan_date === d)

  // 1. Spicy mains
  const spicyDates = mains.filter(m => m.dishes?.spicy).map(m => m.plan_date)
  const spicyAdj = anyAdjacent(spicyDates)
  const spicy: Signal = {
    emoji: '🌶️', label: 'Spicy days',
    detail: spicyDates.length === 0 ? 'No spicy mains this week'
      : spicyAdj ? `${spicyDates.length} spicy mains — back-to-back (${list(spicyDates)})`
      : `${spicyDates.length} spicy main${spicyDates.length > 1 ? 's' : ''}, nicely spread (${list(spicyDates)})`,
    status: spicyAdj ? 'headsup' : spicyDates.length >= 3 ? 'neutral' : 'good',
  }

  // 2. Specials
  const specialDates = mains.filter(m => m.dishes?.tier === 'special').map(m => m.plan_date)
  const special: Signal = {
    emoji: '⭐', label: 'Special meals',
    detail: specialDates.length === 0 ? 'No special meals'
      : `${specialDates.length} special meal${specialDates.length > 1 ? 's' : ''} — ${list(specialDates)}${specialDates.length === 2 ? ' 👌' : ''}`,
    status: specialDates.length === 2 ? 'good' : 'neutral',
  }

  // 3. Difficulty
  const hardDates = dates.filter(d => planned.some(r => r.plan_date === d && r.dishes?.difficulty === 'hard'))
  const difficulty: Signal = {
    emoji: '🔥', label: 'Difficulty',
    detail: hardDates.length === 0 ? 'Easy week — no hard cooks'
      : `${hardDates.length} hard cook${hardDates.length > 1 ? 's' : ''}${hardDates.length > 1 && !anyAdjacent(hardDates) ? ', spread out' : ''} (${list(hardDates)})`,
    status: 'good',
  }

  // 4. Saltiness
  const saltyByDay = dates.map(d => planned.filter(r => r.plan_date === d && r.dishes && r.dishes.saltiness !== 'normal').length)
  const doubleIdx = saltyByDay.findIndex(n => n >= 2)
  const saltiness: Signal = {
    emoji: '🧂', label: 'Saltiness',
    detail: doubleIdx >= 0 ? `${dayName(dates[doubleIdx])} has ${saltyByDay[doubleIdx]} salty dishes` : 'Saltiness balanced',
    status: doubleIdx >= 0 ? 'headsup' : 'good',
  }

  // 5. Fried
  const friedTotal = planned.filter(r => r.dishes?.method === 'fried').length
  const heavyFriedDay = dates.find(d => planned.filter(r => r.plan_date === d && r.dishes?.method === 'fried').length >= 2)
  const fried: Signal = {
    emoji: '🍳', label: 'Fried',
    detail: `${friedTotal} fried dish${friedTotal === 1 ? '' : 'es'} this week${heavyFriedDay ? ` — ${dayName(heavyFriedDay)} is a bit fry-heavy` : ''}`,
    status: heavyFriedDay ? 'headsup' : 'neutral',
  }

  // 6. Protein variety (mains)
  const mainProteins = dates.map(d => mainOn(d)?.dishes?.protein).filter(Boolean) as string[]
  const distinct = new Set(mainProteins).size
  const mainDates = mains.map(m => m.plan_date).sort()
  const clashDate = mainDates.find((d, i) => i > 0 &&
    Math.abs(daysBetween(mainDates[i - 1], d)) === 1 &&
    !!mainOn(d)?.dishes?.protein &&
    mainOn(d)?.dishes?.protein === mainOn(mainDates[i - 1])?.dishes?.protein)
  const protein: Signal = {
    emoji: '🥩', label: 'Protein variety',
    detail: clashDate ? `${mainOn(clashDate)?.dishes?.protein} two days running`
      : `${distinct} different protein${distinct > 1 ? 's' : ''} — great variety`,
    status: clashDate ? 'headsup' : 'good',
  }

  // 7. Soup coverage
  const soupDates = dates.filter(d => planned.some(r => r.plan_date === d &&
    ((r.slot === 'kuah' && r.dish_id) || (r.role === 'main' && r.dishes?.provides_soup))))
  const soup: Signal = {
    emoji: '🥣', label: 'Soup coverage',
    detail: `${soupDates.length} of ${dates.length} days have soup`,
    status: 'neutral',
  }

  // 8. Fruit tally — desert (dessert item) + both fruit pairings (breakfast,
  // dessert) summed per day; role-agnostic on purpose, so this needed no
  // code change when the fruit slot grew a second per-day row.
  const fruitByDay = dates.map(d => planned
    .filter(r => r.plan_date === d && (r.slot === 'fruit' || r.slot === 'desert'))
    .reduce((n, r) => n + (r.dishes?.fruit_portions ?? 0), 0))
  const daysHitting2 = fruitByDay.filter(n => n >= 2).length
  const fruit: Signal = {
    emoji: '🍎', label: 'Fruit tally',
    detail: `${daysHitting2} of ${dates.length} days hit ~2 fruit portions`,
    status: daysHitting2 >= 5 ? 'good' : 'neutral',
  }

  // 9. Breakfast treats — independent eat-out quota
  const breakfastRows = planned.filter(r => r.slot === 'breakfast')
  const bfTreatDates = [...new Set(breakfastRows.filter(r => r.dishes?.tier === 'special').map(r => r.plan_date))]
  const breakfast: Signal = {
    emoji: '🌅', label: 'Breakfast treats',
    detail: bfTreatDates.length === 0 ? 'No eat-out breakfasts this week'
      : `${bfTreatDates.length} eat-out breakfast${bfTreatDates.length > 1 ? 's' : ''} this week (${list(bfTreatDates)})`,
    status: bfTreatDates.length === 2 ? 'good' : 'neutral',
  }

  // Verdict
  const spicyDays = spicyDates.length, specialCount = specialDates.length, hardCount = hardDates.length
  let verdict: string
  if (spicyDays >= 3) verdict = 'Spicy week 🌶️'
  else if ((specialCount >= 2 && (hardCount >= 2 || friedTotal >= 6)) || friedTotal >= 7) verdict = 'Hearty week 🍖'
  else if (hardCount <= 1 && friedTotal <= 3 && spicyDays <= 1) verdict = 'Light & easy week 🥗'
  else verdict = 'Balanced week 🌿'

  const bits: string[] = []
  if (specialCount) bits.push(`${specialCount} special`)
  if (hardCount) bits.push(`${hardCount} hard cook${hardCount > 1 ? 's' : ''}`)
  if (spicyDays) bits.push(`${spicyDays} spicy`)
  const summary = bits.length ? bits.join(' · ') : 'An easy, mild week'

  return { hasPlan: true, verdict, summary, signals: [spicy, special, difficulty, saltiness, fried, protein, soup, fruit, breakfast] }
}
