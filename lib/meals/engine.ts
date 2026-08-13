import type { Dish, MealPlan, Pick, Slot } from './types'
import { SLOTS, DEFAULT_NO_REPEAT } from './types'
import { daysBetween } from './dates'

export type PickContext = {
  date: string
  slot: Slot
  priorPlans: MealPlan[]
  runPicks: Pick[]
  dishById: Map<string, Dish>
  specialDays: Set<string>
  relax: { spicy: boolean; fried: boolean; noRepeatFactor: number }
}

export function resolveDish(ctx: PickContext, dishId: string | null): Dish | undefined {
  return dishId ? ctx.dishById.get(dishId) : undefined
}

export function picksForDate(ctx: PickContext, date: string): Pick[] {
  return ctx.runPicks.filter(p => p.plan_date === date)
}

function windowFor(dish: Dish, ctx: PickContext): number {
  const base = dish.no_repeat_days ?? DEFAULT_NO_REPEAT[dish.slot]
  return Math.max(2, Math.round(base * ctx.relax.noRepeatFactor))
}

export function noRepeatOk(dish: Dish, ctx: PickContext): boolean {
  const win = windowFor(dish, ctx)
  const uses = [
    ...ctx.priorPlans.filter(p => p.dish_id === dish.id),
    ...ctx.runPicks.filter(p => p.dish_id === dish.id),
  ]
  for (const u of uses) {
    const gap = Math.abs(daysBetween(u.plan_date, ctx.date))
    if (gap < win) return false
  }
  return true
}

export function proteinOk(dish: Dish, ctx: PickContext): boolean {
  if (ctx.slot !== 'utama') return true
  // previous calendar day's utama protein (from run picks, else prior plans)
  const prevDate = prevDay(ctx.date)
  const prevPick = ctx.runPicks.find(p => p.plan_date === prevDate && p.slot === 'utama')
  let prevProtein: string | undefined
  if (prevPick) prevProtein = resolveDish(ctx, prevPick.dish_id)?.protein
  else {
    const prevPlan = ctx.priorPlans.find(p => p.plan_date === prevDate && p.slot === 'utama')
    prevProtein = prevPlan ? resolveDish(ctx, prevPlan.dish_id)?.protein : undefined
  }
  if (!prevProtein) return true
  return dish.protein !== prevProtein
}

export function specialOk(dish: Dish, ctx: PickContext): boolean {
  // day cap: at most one special dish across all slots
  const dayHasSpecial = picksForDate(ctx, ctx.date).some(
    p => resolveDish(ctx, p.dish_id)?.tier === 'special'
  )
  if (dish.tier === 'special') {
    if (dayHasSpecial) return false
    if (ctx.slot === 'utama' && !ctx.specialDays.has(ctx.date)) return false
  }
  return true
}

export function friedOk(dish: Dish, ctx: PickContext): boolean {
  if (ctx.relax.fried) return true
  if (dish.method !== 'fried') return true
  const friedCount = picksForDate(ctx, ctx.date).filter(
    p => resolveDish(ctx, p.dish_id)?.method === 'fried'
  ).length
  return friedCount < 2
}

export function spicyOk(dish: Dish, ctx: PickContext): boolean {
  if (ctx.relax.spicy) return true
  if (!dish.spicy) return true
  // slots not yet filled today AFTER this one (this pick counts as spicy)
  const filledSlots = new Set(picksForDate(ctx, ctx.date).map(p => p.slot))
  const remaining = SLOTS.filter(s => s !== ctx.slot && !filledSlots.has(s)).length
  const nonSpicySoFar = picksForDate(ctx, ctx.date).filter(
    p => resolveDish(ctx, p.dish_id)?.spicy === false
  ).length
  // if we pick spicy here, best case non-spicy = nonSpicySoFar + remaining
  return nonSpicySoFar + remaining >= 2
}

export function passesHardRules(dish: Dish, ctx: PickContext): boolean {
  return (
    dish.active &&
    dish.slot === ctx.slot &&
    noRepeatOk(dish, ctx) &&
    proteinOk(dish, ctx) &&
    specialOk(dish, ctx) &&
    friedOk(dish, ctx) &&
    spicyOk(dish, ctx)
  )
}

function prevDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() - 1)
  const yy = dt.getFullYear()
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const dd = String(dt.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}
