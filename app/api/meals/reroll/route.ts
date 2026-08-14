import { supabase } from '@/lib/supabase'
import { SLOTS, type Dish, type MealPlan, type Slot, type Role } from '@/lib/meals/types'
import { candidates, composeDay, pickForSlot, weightFor, type PickContext } from '@/lib/meals/engine'
import { weekDates, mondayOf } from '@/lib/meals/dates'

const rng = () => Math.random()
const SELECT = '*, dishes(tier, spicy, richness, provides_soup, recipe_image_url)'

async function loadWeek(plan_date: string) {
  const week = weekDates(mondayOf(plan_date))
  const start = new Date(week[0]); start.setDate(start.getDate() - 14)
  const historyStart = start.toISOString().split('T')[0]
  const [{ data: dishesRaw }, { data: plansRaw }] = await Promise.all([
    supabase.from('dishes').select('*').eq('active', true),
    supabase.from('meal_plans').select('*').gte('plan_date', historyStart).lte('plan_date', week[6]),
  ])
  return {
    week,
    allDishes: (dishesRaw ?? []) as Dish[],
    plans: (plansRaw ?? []) as MealPlan[],
  }
}

function roleForSlot(slot: Slot): Role {
  return slot === 'utama' ? 'main' : slot === 'desert' ? 'optional' : 'support'
}

function buildSingleContext(plan_date: string, slot: Slot, allDishes: Dish[], plans: MealPlan[], week: string[]) {
  const dishById = new Map(allDishes.map(d => [d.id, d]))
  const weekSet = new Set(week)
  const runPicks = plans
    .filter(p => weekSet.has(p.plan_date) && !(p.plan_date === plan_date && p.slot === slot))
    .map(p => ({ plan_date: p.plan_date, slot: p.slot as Slot, dish_id: p.dish_id, dish_name: p.dish_name,
      locked: p.locked, role: p.role ?? 'support', skipped: p.skipped ?? false }))
  const priorPlans = plans.filter(p => !weekSet.has(p.plan_date))
  const specialDays = new Set(
    week.filter(d => plans.some(p => p.plan_date === d && p.slot === 'utama' && dishById.get(p.dish_id ?? '')?.tier === 'special')))
  const ctx: PickContext = {
    date: plan_date, slot, priorPlans, runPicks, dishById, specialDays,
    relax: { spicy: false, fried: false, noRepeatFactor: 1 },
    role: roleForSlot(slot), spicyFloor: 1, plannedRemaining: 5,
  }
  return { ctx, slotDishes: allDishes.filter(d => d.slot === slot) }
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

  // ---- MAIN reroll → re-compose the day ----
  if (slot === 'utama') {
    const { week, allDishes, plans } = await loadWeek(plan_date)
    const dishById = new Map(allDishes.map(d => [d.id, d]))
    const dayLocked = plans.filter(p => p.plan_date === plan_date && p.locked)
    const lockedByCell = new Map(dayLocked.map(l => [`${l.plan_date}|${l.slot}`, l]))
    const weekSet = new Set(week)
    const specialDays = new Set(
      week.filter(d => plans.some(p => p.plan_date === d && p.slot === 'utama' && dishById.get(p.dish_id ?? '')?.tier === 'special')))

    // runPicks = whole week EXCEPT this day's non-locked rows
    const runPicks = plans
      .filter(p => !(p.plan_date === plan_date && !p.locked))
      .map(p => ({ plan_date: p.plan_date, slot: p.slot as Slot, dish_id: p.dish_id, dish_name: p.dish_name,
        locked: p.locked, role: (p.role ?? 'support') as Role, skipped: p.skipped ?? false }))
    const priorPlans = plans.filter(p => !weekSet.has(p.plan_date))

    // explicit main choice → fix it: pre-place as a pick and treat utama as locked for the compose
    let fixedMain: { id: string; name: string } | null = null
    if (body.dish_id) {
      const chosen = dishById.get(body.dish_id)
      if (!chosen) return Response.json({ error: 'dish not found' }, { status: 404 })
      fixedMain = { id: chosen.id, name: chosen.name }
      const mainPick = { plan_date, slot: 'utama' as Slot, dish_id: chosen.id, dish_name: chosen.name,
        locked: false, role: 'main' as Role, skipped: false }
      runPicks.push(mainPick)
      lockedByCell.set(`${plan_date}|utama`, { ...mainPick, id: '' } as unknown as MealPlan)
    }

    const dishesBySlot = Object.fromEntries(
      SLOTS.map(s => [s, allDishes.filter(d => d.slot === s)]),
    ) as Record<Slot, Dish[]>

    const created = composeDay({ date: plan_date, dishesBySlot, dishById, priorPlans, runPicks, lockedByCell, specialDays, rng })
    const toInsert = [...created]
    if (fixedMain) toInsert.unshift({ plan_date, slot: 'utama' as Slot, dish_id: fixedMain.id,
      dish_name: fixedMain.name, locked: false, role: 'main' as Role, skipped: false })

    // delete the day's non-locked rows, insert the freshly composed set
    await supabase.from('meal_plans').delete().eq('plan_date', plan_date).eq('locked', false)
    if (toInsert.length) {
      const { error } = await supabase.from('meal_plans').insert(toInsert.map(p => ({
        plan_date: p.plan_date, slot: p.slot, dish_id: p.dish_id, dish_name: p.dish_name,
        locked: false, role: p.role, skipped: p.skipped,
      })))
      if (error) return Response.json({ error: error.message }, { status: 500 })
    }
    const { data: day } = await supabase.from('meal_plans').select(SELECT).eq('plan_date', plan_date)
    return Response.json({ day: (day ?? []) as MealPlan[] })
  }

  // ---- SUPPORT / OPTIONAL reroll → swap one ----
  const { week, allDishes, plans } = await loadWeek(plan_date)
  if (body.dish_id) {
    const d = allDishes.find(x => x.id === body.dish_id)
    if (!d) return Response.json({ error: 'dish not found' }, { status: 404 })
    const { data, error } = await supabase.from('meal_plans')
      .upsert({ plan_date, slot, dish_id: d.id, dish_name: d.name, locked: false, role: roleForSlot(slot), skipped: false },
        { onConflict: 'plan_date,slot' }).select(SELECT).single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ pick: data as MealPlan })
  }
  const { ctx, slotDishes } = buildSingleContext(plan_date, slot as Slot, allDishes, plans, week)
  const p = pickForSlot(slotDishes, ctx, rng)
  const { data, error } = await supabase.from('meal_plans')
    .upsert({ plan_date, slot, dish_id: p.dish_id, dish_name: p.dish_name, locked: false, role: roleForSlot(slot as Slot), skipped: false },
      { onConflict: 'plan_date,slot' }).select(SELECT).single()
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
  const { week, allDishes, plans } = await loadWeek(plan_date)
  const { ctx, slotDishes } = buildSingleContext(plan_date, slot, allDishes, plans, week)
  const pool = candidates(slotDishes, ctx)
    .map(d => ({ d, w: weightFor(d, ctx) }))
    .sort((a, b) => b.w - a.w)
    .slice(0, n)
    .map(({ d }) => ({ id: d.id, name: d.name }))
  return Response.json({ alternatives: pool })
}
