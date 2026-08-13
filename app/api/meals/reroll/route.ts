import { supabase } from '@/lib/supabase'
import { SLOTS, type Dish, type MealPlan, type Slot } from '@/lib/meals/types'
import { candidates, pickForSlot, weightFor, type PickContext } from '@/lib/meals/engine'
import { weekDates, mondayOf } from '@/lib/meals/dates'

const rng = () => Math.random()

async function buildContext(plan_date: string, slot: Slot) {
  const week = weekDates(mondayOf(plan_date))
  const start = new Date(week[0]); start.setDate(start.getDate() - 14)
  const historyStart = start.toISOString().split('T')[0]

  const [{ data: dishesRaw }, { data: plansRaw }] = await Promise.all([
    supabase.from('dishes').select('*').eq('active', true),
    supabase.from('meal_plans').select('*').gte('plan_date', historyStart).lte('plan_date', week[6]),
  ])
  const allDishes = (dishesRaw ?? []) as Dish[]
  const plans = (plansRaw ?? []) as MealPlan[]
  const dishById = new Map(allDishes.map(d => [d.id, d]))

  const weekSet = new Set(week)
  // run picks = all week plans EXCEPT the target cell
  const runPicks = plans
    .filter(p => weekSet.has(p.plan_date) && !(p.plan_date === plan_date && p.slot === slot))
    .map(p => ({ plan_date: p.plan_date, slot: p.slot as Slot, dish_id: p.dish_id, dish_name: p.dish_name, locked: p.locked }))
  const priorPlans = plans.filter(p => !weekSet.has(p.plan_date))

  // a day is "special" if its utama already holds a special dish
  const specialDays = new Set(
    week.filter(d => plans.some(p =>
      p.plan_date === d && p.slot === 'utama' && dishById.get(p.dish_id ?? '')?.tier === 'special')))

  const ctx: PickContext = {
    date: plan_date, slot, priorPlans, runPicks, dishById, specialDays,
    relax: { spicy: false, fried: false, noRepeatFactor: 1 },
  }
  const slotDishes = allDishes.filter(d => d.slot === slot)
  return { ctx, slotDishes }
}

export async function POST(request: Request) {
  const body = await request.json()
  const { plan_date, slot } = body
  if (!plan_date || !SLOTS.includes(slot)) {
    return Response.json({ error: 'plan_date and valid slot required' }, { status: 400 })
  }
  const { data: existing } = await supabase
    .from('meal_plans').select('*').eq('plan_date', plan_date).eq('slot', slot).maybeSingle()
  if (existing?.locked) return Response.json({ error: 'cell is locked' }, { status: 409 })

  // Explicit choice from the "want something else?" dropdown.
  if (body.dish_id) {
    const { data: d } = await supabase.from('dishes').select('id,name').eq('id', body.dish_id).single()
    if (!d) return Response.json({ error: 'dish not found' }, { status: 404 })
    const { data, error } = await supabase.from('meal_plans')
      .upsert({ plan_date, slot, dish_id: d.id, dish_name: d.name, locked: false }, { onConflict: 'plan_date,slot' })
      .select('*, dishes(tier, spicy)').single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ pick: data as MealPlan })
  }

  const { ctx, slotDishes } = await buildContext(plan_date, slot as Slot)
  const pick = pickForSlot(slotDishes, ctx, rng)

  const { data, error } = await supabase.from('meal_plans')
    .upsert({ plan_date, slot, dish_id: pick.dish_id, dish_name: pick.dish_name, locked: false },
      { onConflict: 'plan_date,slot' })
    .select('*, dishes(tier, spicy)').single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ pick: data as MealPlan })
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const plan_date = url.searchParams.get('plan_date')
  const slot = url.searchParams.get('slot') as Slot | null
  const n = Math.min(Number(url.searchParams.get('alternatives') ?? 5) || 5, 10)
  if (!plan_date || !slot || !SLOTS.includes(slot)) {
    return Response.json({ error: 'plan_date and valid slot required' }, { status: 400 })
  }
  const { ctx, slotDishes } = await buildContext(plan_date, slot)
  const pool = candidates(slotDishes, ctx)
    .map(d => ({ d, w: weightFor(d, ctx) }))
    .sort((a, b) => b.w - a.w)
    .slice(0, n)
    .map(({ d }) => ({ id: d.id, name: d.name }))
  return Response.json({ alternatives: pool })
}
