import type { Dish } from './types'

// A row from dessert_week_items, however the caller fetched it (join not required —
// callers pass a dishById map for anything needing cadence/produce_role).
export type DessertHistoryRow = { week_start: string; dish_id: string; kind: string }

function weeksBefore(weekStart: string, n: number): string {
  const d = new Date(weekStart)
  d.setDate(d.getDate() - 7 * n)
  return d.toISOString().split('T')[0]
}

// No dessert_cake anywhere in the last `cooldownWeeks` weeks (not counting
// this week itself) → a cake can compete for one of this week's slots.
export function computeCakeEligible(history: DessertHistoryRow[], weekStart: string, cooldownWeeks = 3): boolean {
  const cutoff = weeksBefore(weekStart, cooldownWeeks)
  return !history.some(h => h.kind === 'dessert_cake' && h.week_start >= cutoff && h.week_start < weekStart)
}

// The immediately preceding week's dessert batch (staples + any cake) —
// deprioritized (not excluded) in this week's pick so it doesn't just repeat.
export function computeLastWeekBatchIds(history: DessertHistoryRow[], weekStart: string): string[] {
  const lastWeek = weeksBefore(weekStart, 1)
  return history
    .filter(h => h.week_start === lastWeek && (h.kind === 'dessert_batch' || h.kind === 'dessert_cake'))
    .map(h => h.dish_id)
}

// No monthly-cadence evening fruit shown in the last `cooldownWeeks` weeks
// → a monthly fruit (Apple/Jeruk/Pear) is eligible again this week.
export function computeMonthlyFruitEligible(
  history: DessertHistoryRow[], weekStart: string, dishById: Map<string, Dish>, cooldownWeeks = 2,
): boolean {
  const cutoff = weeksBefore(weekStart, cooldownWeeks)
  return !history.some(h =>
    h.kind === 'evening_fruit' && h.week_start >= cutoff && h.week_start < weekStart &&
    dishById.get(h.dish_id)?.cadence === 'monthly')
}
