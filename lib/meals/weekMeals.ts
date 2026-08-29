import { weekDates } from './dates'

// A compact per-day summary of what's cooking, shown above the shopping list
// so the ingredient list has context ("what we're cooking" before "what to
// buy"). Skipped slots and slots with no dish are simply absent.
export type WeekMealDay = { date: string; main: string | null; supports: string[] }

export type WeekMealPlanRow = { plan_date: string; dish_name: string | null; role: string; skipped: boolean }

export function buildWeekMealsSummary(weekStart: string, plans: WeekMealPlanRow[]): WeekMealDay[] {
  const byDate = new Map<string, WeekMealPlanRow[]>()
  for (const p of plans) {
    if (p.skipped || !p.dish_name) continue
    const rows = byDate.get(p.plan_date) ?? []
    rows.push(p)
    byDate.set(p.plan_date, rows)
  }
  return weekDates(weekStart).map(date => {
    const rows = byDate.get(date) ?? []
    const mainRow = rows.find(r => r.role === 'main')
    const supports = rows.filter(r => r !== mainRow).map(r => r.dish_name as string)
    return { date, main: mainRow?.dish_name ?? null, supports }
  })
}
