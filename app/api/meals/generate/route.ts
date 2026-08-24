import { supabase } from '@/lib/supabase'
import { SLOTS, type Dish, type MealPlan, type Slot } from '@/lib/meals/types'
import { generateWeek, validateWeek } from '@/lib/meals/engine'
import { weekDates } from '@/lib/meals/dates'
import { deriveWeekPrepTasks, type PlannedDish, type PrepTaskDraft } from '@/lib/meals/prepTasks'

const rng = () => Math.random()

// Insert-only: never updates or deletes an existing row, so a checked
// `done` is never reset when the same week is generated again.
async function syncPrepTasks(drafts: PrepTaskDraft[]) {
  if (drafts.length === 0) return
  const prepDates = [...new Set(drafts.map(d => d.prep_date))]
  const { data: existingRaw } = await supabase.from('prep_tasks')
    .select('cook_date, dish_id, prep_type, prep_date').in('prep_date', prepDates)
  const existing = (existingRaw ?? []) as { cook_date: string; dish_id: string | null; prep_type: string | null; prep_date: string }[]
  const existsAlready = (d: PrepTaskDraft) => existing.some(e =>
    d.prep_type === 'thaw_batch'
      ? e.prep_type === 'thaw_batch' && e.prep_date === d.prep_date
      : e.cook_date === d.cook_date && e.dish_id === d.dish_id && e.prep_type === d.prep_type)
  const toInsert = drafts.filter(d => !existsAlready(d))
  if (toInsert.length) {
    await supabase.from('prep_tasks').insert(toInsert.map(d => ({
      cook_date: d.cook_date, prep_date: d.prep_date, dish_id: d.dish_id, dish_name: d.dish_name,
      prep_type: d.prep_type, instruction: d.instruction, assigned_to: d.assigned_to,
    })))
  }
}

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

  // Persist the week's realized dessert batch (the distinct dessert dish_ids
  // that actually landed on the week's days) so rerolls and the day view can
  // read back "this week's 2-3 dessert types."
  const dessertDishIds = [...new Set(picks.filter(p => p.slot === 'desert' && p.dish_id).map(p => p.dish_id as string))]
  await supabase.from('dessert_weeks').upsert({ week_start: weekStart }, { onConflict: 'week_start' })
  await supabase.from('dessert_week_items').delete().eq('week_start', weekStart)
  if (dessertDishIds.length) {
    await supabase.from('dessert_week_items').insert(dessertDishIds.map(id => ({
      week_start: weekStart, dish_id: id, dish_name: dishById.get(id)?.name ?? 'Dish', kind: 'dessert',
    })))
  }

  // Persist any newly-needed prep tasks (marinate/cook-overnight/cut/portion
  // per dish, plus one consolidated weekend thaw task) for this week.
  const plannedForPrep: PlannedDish[] = picks
    .filter(p => p.dish_id && !p.skipped && dishById.get(p.dish_id)?.prep_type)
    .map(p => {
      const d = dishById.get(p.dish_id as string)!
      return {
        cook_date: p.plan_date, dish_id: p.dish_id as string, dish_name: p.dish_name ?? d.name,
        prep_type: d.prep_type, prep_lead_days: d.prep_lead_days, prep_note: d.prep_note, protein: d.protein,
      }
    })
  await syncPrepTasks(deriveWeekPrepTasks(weekStart, plannedForPrep))

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
