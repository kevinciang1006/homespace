import { supabase } from '@/lib/supabase'
import { SLOTS, type Dish, type MealPlan, type Slot } from '@/lib/meals/types'
import { generateWeek, validateWeek } from '@/lib/meals/engine'
import { weekDates } from '@/lib/meals/dates'

const rng = () => Math.random()

export async function POST(request: Request) {
  const { weekStart } = await request.json()
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return Response.json({ error: 'weekStart (YYYY-MM-DD) required' }, { status: 400 })
  }
  const days = weekDates(weekStart)

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
  const priorPlans = plans.filter(p => !weekSet.has(p.plan_date))

  const dishesBySlot = Object.fromEntries(
    SLOTS.map(s => [s, allDishes.filter(d => d.slot === s)]),
  ) as Record<Slot, Dish[]>

  const picks = generateWeek({ weekStart, days, dishesBySlot, allDishes, priorPlans, lockedCells, rng })

  const dishById = new Map(allDishes.map(d => [d.id, d]))
  const report = validateWeek(picks, dishById)
  if (process.env.NODE_ENV !== 'production') {
    if (report.length) console.warn(`[meal-gen] ${weekStart} rule violations:\n` + report.join('\n'))
    else console.log(`[meal-gen] ${weekStart} validation: clean ✓`)
  }

  const rows = picks.filter(p => !p.locked).map(p => ({
    plan_date: p.plan_date, slot: p.slot, dish_id: p.dish_id, dish_name: p.dish_name,
    locked: false, role: p.role, skipped: p.skipped,
  }))

  // variable row set: delete non-locked rows for the week, then insert the composed plate
  await supabase.from('meal_plans').delete()
    .gte('plan_date', days[0]).lte('plan_date', days[6]).eq('locked', false)
  if (rows.length) {
    const { error } = await supabase.from('meal_plans').insert(rows)
    if (error) return Response.json({ error: error.message }, { status: 500 })
  }

  const { data: week } = await supabase
    .from('meal_plans')
    .select('*, dishes(tier, spicy, richness, provides_soup, recipe_image_url, protein, saltiness, difficulty, method, slot, recipe_links, qty_amount, qty_unit, qty_note, veg_portions, fruit_portions)')
    .gte('plan_date', days[0]).lte('plan_date', days[6])
  return Response.json({ week: (week ?? []) as MealPlan[], report })
}
