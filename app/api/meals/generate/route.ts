import { supabase } from '@/lib/supabase'
import { SLOTS, type Dish, type MealPlan, type Slot } from '@/lib/meals/types'
import { generateWeek } from '@/lib/meals/engine'
import { weekDates } from '@/lib/meals/dates'

// Math.random-backed rng; engine stays pure/deterministic via injection.
const rng = () => Math.random()

export async function POST(request: Request) {
  const { weekStart } = await request.json()
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return Response.json({ error: 'weekStart (YYYY-MM-DD) required' }, { status: 400 })
  }
  const days = weekDates(weekStart)

  // history window: 14 days (max no-repeat) before weekStart
  const start = new Date(days[0]); start.setDate(start.getDate() - 14)
  const historyStart = start.toISOString().split('T')[0]

  const [{ data: dishesRaw }, { data: plansRaw }] = await Promise.all([
    supabase.from('dishes').select('*').eq('active', true),
    supabase.from('meal_plans').select('*').gte('plan_date', historyStart).lte('plan_date', days[6]),
  ])

  const allDishes = (dishesRaw ?? []) as Dish[]
  const plans = (plansRaw ?? []) as MealPlan[]
  const weekSet = new Set(days)
  const lockedCells = plans.filter(p => weekSet.has(p.plan_date) && p.locked)
  const priorPlans = plans.filter(p => !weekSet.has(p.plan_date)) // history before the week

  const dishesBySlot = Object.fromEntries(
    SLOTS.map(s => [s, allDishes.filter(d => d.slot === s)]),
  ) as Record<Slot, Dish[]>

  const picks = generateWeek({
    weekStart, days, dishesBySlot, allDishes, priorPlans, lockedCells, rng,
  })

  // Upsert non-locked picks only; locked rows are never overwritten.
  const rows = picks
    .filter(p => !p.locked)
    .map(p => ({ plan_date: p.plan_date, slot: p.slot, dish_id: p.dish_id, dish_name: p.dish_name, locked: false }))

  const { error } = await supabase.from('meal_plans').upsert(rows, { onConflict: 'plan_date,slot' })
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const { data: week } = await supabase
    .from('meal_plans').select('*, dishes(tier, spicy)').gte('plan_date', days[0]).lte('plan_date', days[6])
  return Response.json({ week: (week ?? []) as MealPlan[] })
}
