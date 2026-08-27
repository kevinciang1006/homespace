import { supabase } from '@/lib/supabase'
import { SLOTS, type Dish, type MealPlan, type Slot, type Role } from '@/lib/meals/types'
import { candidates, composeDay, pickForSlot, pickBreakfast, breakfastCandidates, weightFor,
  fruitPoolFor, pickDessertForDay, pickBreakfastFruit, pickEveningFruitForDay,
  preassignBreakfastSpecialDays, preassignEveningFruitDays, helperCandidates, pickHelper,
  type PickContext } from '@/lib/meals/engine'
import { pickDessertBatch, DESSERT_WEEK_CAP, type DessertBatchOptions } from '@/lib/meals/dessert'
import { pickEveningFruitBatch, EVENING_FRUIT_WEEK_CAP, EVENING_FRUIT_MIN_DAYS, EVENING_FRUIT_MAX_DAYS, type EveningFruitOptions } from '@/lib/meals/eveningFruit'
import { computeCakeEligible, computeLastWeekBatchIds, computeMonthlyFruitEligible, type DessertHistoryRow } from '@/lib/meals/dessertHistory'
import { weekDates, mondayOf } from '@/lib/meals/dates'

const rng = () => Math.random()
const SELECT = '*, dishes(tier, spicy, richness, provides_soup, recipe_image_url, protein, saltiness, difficulty, method, slot, recipe_links, qty_amount, qty_unit, qty_note, veg_portions, fruit_portions)'
const DESSERT_HISTORY_LOOKBACK_WEEKS = 4

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

// `kinds` selects which slice of the week's dessert_week_items to load:
// ['dessert_batch', 'dessert_cake'] for the desert-slot batch, ['evening_fruit'] for the fruit-slot one.
async function loadWeekItems(weekStart: string, allDishes: Dish[], kinds: string[]): Promise<Dish[]> {
  const { data } = await supabase.from('dessert_week_items').select('dish_id').eq('week_start', weekStart).in('kind', kinds)
  const ids = new Set((data ?? []).map(r => r.dish_id as string))
  return allDishes.filter(d => ids.has(d.id))
}

// A day-scoped or main-scoped recompose keeps the day's existing "does this
// day show evening fruit" decision rather than re-rolling that coin flip —
// it recomposes what's IN the cells, not the week-level opportunistic plan.
function currentEveningFruitDays(plans: MealPlan[], plan_date: string): Set<string> {
  const row = plans.find(p => p.plan_date === plan_date && p.slot === 'fruit' && p.role === 'optional')
  return row?.dish_id && !row.skipped ? new Set([plan_date]) : new Set<string>()
}

async function loadDessertHistory(weekStart: string): Promise<DessertHistoryRow[]> {
  const start = new Date(weekStart)
  start.setDate(start.getDate() - 7 * DESSERT_HISTORY_LOOKBACK_WEEKS)
  const { data } = await supabase.from('dessert_week_items').select('week_start, dish_id, kind')
    .gte('week_start', start.toISOString().split('T')[0]).lt('week_start', weekStart)
  return (data ?? []) as DessertHistoryRow[]
}

function roleForSlot(slot: Slot): Role {
  return slot === 'utama' ? 'main'
    : slot === 'breakfast' ? 'breakfast'
    : (slot === 'desert' || slot === 'fruit') ? 'optional'
    : 'support'
}

// Special days = week days whose utama is special; hard days = special days plus
// any day already holding a hard dish (keeps the two quotas coordinated on reroll).
function deriveDays(week: string[], plans: MealPlan[], dishById: Map<string, Dish>) {
  const weekSet = new Set(week)
  const specialDays = new Set(week.filter(d => plans.some(p =>
    p.plan_date === d && p.slot === 'utama' && dishById.get(p.dish_id ?? '')?.tier === 'special')))
  const hardDays = new Set<string>(specialDays)
  for (const p of plans) {
    if (weekSet.has(p.plan_date) && dishById.get(p.dish_id ?? '')?.difficulty === 'hard') hardDays.add(p.plan_date)
  }
  return { specialDays, hardDays }
}

// Breakfast's already-committed special-day assignment, reconstructed from
// this week's saved plans — independent of deriveDays (dinner's specialDays).
function deriveBreakfastSpecialDays(week: string[], plans: MealPlan[], dishById: Map<string, Dish>): Set<string> {
  return new Set(week.filter(d => plans.some(p =>
    p.plan_date === d && p.slot === 'breakfast' && dishById.get(p.dish_id ?? '')?.tier === 'special')))
}

// Shared context for a single-cell breakfast reroll/alternatives lookup —
// used by both the POST reroll branch and the GET alternatives branch below.
function buildBreakfastContext(plan_date: string, allDishes: Dish[], plans: MealPlan[], week: string[]) {
  const dishById = new Map(allDishes.map(d => [d.id, d]))
  const weekSet = new Set(week)
  const breakfastSpecialDays = deriveBreakfastSpecialDays(week, plans, dishById)
  const runPicks = plans
    .filter(p => weekSet.has(p.plan_date) && !(p.plan_date === plan_date && p.slot === 'breakfast'))
    .map(p => ({ plan_date: p.plan_date, slot: p.slot as Slot, dish_id: p.dish_id, dish_name: p.dish_name,
      locked: p.locked, role: (p.role ?? 'breakfast') as Role, skipped: p.skipped ?? false }))
  const priorPlans = plans.filter(p => !weekSet.has(p.plan_date))
  const ctx: PickContext = {
    date: plan_date, slot: 'breakfast', priorPlans, runPicks, dishById,
    specialDays: new Set(), hardDays: new Set(),
    relax: { spicy: false, fried: false, hardDay: false, hardSpacing: false, proteinClash: false, spicyMainSpacing: false, noRepeatFactor: 1 },
    role: 'breakfast', spicyFloor: 1, plannedRemaining: 0,
  }
  const breakfastPool = allDishes.filter(d => d.slot === 'breakfast')
  return { ctx, breakfastPool, isSpecialDay: breakfastSpecialDays.has(plan_date) }
}

// On a provides_soup-main day the kuah slot really holds a 2nd vegetable, so it must be
// rerolled from the sayuran pool (and stored back into the kuah slot).
function poolSlotFor(slot: Slot, plan_date: string, plans: MealPlan[], allDishes: Dish[]): Slot {
  if (slot !== 'kuah') return slot
  const mainRow = plans.find(p => p.plan_date === plan_date && p.slot === 'utama')
  const mainDish = mainRow?.dish_id ? allDishes.find(d => d.id === mainRow.dish_id) : undefined
  return mainDish?.provides_soup ? 'sayuran' : 'kuah'
}

// `slot` is the storage slot (the cell being rerolled); `poolSlot` is the pool/rules slot
// to pick from (differs only for a 2nd-veg kuah slot on a wet-main day).
function buildSingleContext(plan_date: string, slot: Slot, allDishes: Dish[], plans: MealPlan[], week: string[], poolSlot: Slot = slot) {
  const dishById = new Map(allDishes.map(d => [d.id, d]))
  const weekSet = new Set(week)
  const runPicks = plans
    .filter(p => weekSet.has(p.plan_date) && !(p.plan_date === plan_date && p.slot === slot))
    .map(p => ({ plan_date: p.plan_date, slot: p.slot as Slot, dish_id: p.dish_id, dish_name: p.dish_name,
      locked: p.locked, role: p.role ?? 'support', skipped: p.skipped ?? false }))
  const priorPlans = plans.filter(p => !weekSet.has(p.plan_date))
  const { specialDays, hardDays } = deriveDays(week, plans, dishById)
  const ctx: PickContext = {
    date: plan_date, slot: poolSlot, priorPlans, runPicks, dishById, specialDays, hardDays,
    relax: { spicy: false, fried: false, hardDay: false, hardSpacing: false, proteinClash: false, spicyMainSpacing: false, noRepeatFactor: 1 },
    role: roleForSlot(poolSlot), spicyFloor: 1, plannedRemaining: 5,
  }
  return { ctx, slotDishes: allDishes.filter(d => d.slot === poolSlot) }
}

export async function POST(request: Request) {
  const body = await request.json()
  const { plan_date, slot } = body

  // ---- DAY reroll → re-compose the whole day, keeping locked cells ----
  if (body.scope === 'day') {
    if (!plan_date) return Response.json({ error: 'plan_date required' }, { status: 400 })
    const { week, allDishes, plans } = await loadWeek(plan_date)
    const dishById = new Map(allDishes.map(d => [d.id, d]))
    const weekSet = new Set(week)
    const { specialDays, hardDays } = deriveDays(week, plans, dishById)
    const dayLocked = plans.filter(p => p.plan_date === plan_date && p.locked)
    const lockedByCell = new Map(dayLocked.map(l =>
      [l.slot === 'fruit' ? `${l.plan_date}|${l.slot}|${l.role}` : `${l.plan_date}|${l.slot}`, l]))
    const runPicks = plans
      .filter(p => !(p.plan_date === plan_date && !p.locked))
      .map(p => ({ plan_date: p.plan_date, slot: p.slot as Slot, dish_id: p.dish_id, dish_name: p.dish_name,
        locked: p.locked, role: (p.role ?? 'support') as Role, skipped: p.skipped ?? false }))
    const priorPlans = plans.filter(p => !weekSet.has(p.plan_date))
    const dishesBySlot = Object.fromEntries(SLOTS.map(s => [s, allDishes.filter(d => d.slot === s)])) as Record<Slot, Dish[]>
    const breakfastSpecialDays = deriveBreakfastSpecialDays(week, plans, dishById)
    const dessertBatch = await loadWeekItems(mondayOf(plan_date), allDishes, ['dessert_batch', 'dessert_cake'])
    const eveningFruitBatch = await loadWeekItems(mondayOf(plan_date), allDishes, ['evening_fruit'])
    const eveningFruitDays = currentEveningFruitDays(plans, plan_date)
    const created = composeDay({ date: plan_date, dishesBySlot, dishById, priorPlans, runPicks, lockedByCell, specialDays, hardDays, breakfastSpecialDays, dessertBatch, eveningFruitBatch, eveningFruitDays, rng })
    await supabase.from('meal_plans').delete().eq('plan_date', plan_date).eq('locked', false)
    const toInsert = created.filter(p => !p.locked)
    if (toInsert.length) {
      const { error } = await supabase.from('meal_plans').insert(toInsert.map(p => ({
        plan_date: p.plan_date, slot: p.slot, dish_id: p.dish_id, dish_name: p.dish_name,
        locked: false, role: p.role, skipped: p.skipped })))
      if (error) return Response.json({ error: error.message }, { status: 500 })
    }
    const { data: day } = await supabase.from('meal_plans').select(SELECT).eq('plan_date', plan_date)
    return Response.json({ day: (day ?? []) as MealPlan[] })
  }

  // ---- Randomize breakfast → re-pick breakfast dish + fruit for every non-locked day ----
  if (body.scope === 'week-breakfasts') {
    const { weekStart } = body
    if (!weekStart) return Response.json({ error: 'weekStart required' }, { status: 400 })
    const week = weekDates(weekStart)
    const { data: dishesRaw } = await supabase.from('dishes').select('*').eq('active', true)
    const allDishes = (dishesRaw ?? []) as Dish[]
    const dishById = new Map(allDishes.map(d => [d.id, d]))
    const start = new Date(week[0]); start.setDate(start.getDate() - 14)
    const historyStart = start.toISOString().split('T')[0]
    const { data: plansRaw } = await supabase.from('meal_plans').select('*')
      .gte('plan_date', historyStart).lte('plan_date', week[6])
    const plans = (plansRaw ?? []) as MealPlan[]
    const weekSet = new Set(week)
    const priorPlans = plans.filter(p => !weekSet.has(p.plan_date))
    const lockedCells = plans.filter(p => weekSet.has(p.plan_date) && p.locked)
    const breakfastSpecialDays = preassignBreakfastSpecialDays(week, lockedCells, dishById, rng)
    const breakfastPool = allDishes.filter(d => d.slot === 'breakfast')
    const fruitPool = allDishes.filter(d => d.slot === 'fruit')

    const runPicks = lockedCells.map(l => ({ plan_date: l.plan_date, slot: l.slot as Slot, dish_id: l.dish_id,
      dish_name: l.dish_name, locked: true, role: (l.role ?? 'support') as Role, skipped: l.skipped ?? false }))
    const relax = { spicy: false, fried: false, hardDay: false, hardSpacing: false, proteinClash: false, spicyMainSpacing: false, noRepeatFactor: 1 }
    const toUpsert: { plan_date: string; slot: Slot; dish_id: string | null; dish_name: string | null; role: Role; skipped: boolean }[] = []
    for (const date of week) {
      const lockedBf = lockedCells.some(l => l.plan_date === date && l.slot === 'breakfast')
      const lockedBfFruit = lockedCells.some(l => l.plan_date === date && l.slot === 'fruit' && l.role === 'breakfast')
      const ctxBase = { date, priorPlans, runPicks, dishById, specialDays: new Set<string>(), hardDays: new Set<string>(), relax }
      if (!lockedBf) {
        const p = pickBreakfast(breakfastPool, { ...ctxBase, slot: 'breakfast', role: 'breakfast', spicyFloor: 1, plannedRemaining: 0 },
          breakfastSpecialDays.has(date), rng)
        runPicks.push(p)
        toUpsert.push({ plan_date: date, slot: 'breakfast', dish_id: p.dish_id, dish_name: p.dish_name, role: 'breakfast', skipped: p.skipped })
      }
      if (!lockedBfFruit) {
        const p = pickBreakfastFruit(fruitPool, { ...ctxBase, slot: 'fruit', role: 'breakfast', spicyFloor: 1, plannedRemaining: 0 }, rng)
        runPicks.push(p)
        toUpsert.push({ plan_date: date, slot: 'fruit', dish_id: p.dish_id, dish_name: p.dish_name, role: 'breakfast', skipped: p.skipped })
      }
    }
    for (const row of toUpsert) {
      const { error } = await supabase.from('meal_plans')
        .upsert({ ...row, locked: false }, { onConflict: 'plan_date,slot,role' })
      if (error) return Response.json({ error: error.message }, { status: 500 })
    }
    const { data: weekRows } = await supabase.from('meal_plans').select(SELECT).gte('plan_date', week[0]).lte('plan_date', week[6])
    return Response.json({ week: (weekRows ?? []) as MealPlan[] })
  }

  // ---- Randomize desserts → new weekly batch, redistribute non-locked desert days ----
  if (body.scope === 'week-desserts') {
    const { weekStart } = body
    if (!weekStart) return Response.json({ error: 'weekStart required' }, { status: 400 })
    const week = weekDates(weekStart)
    const { data: dishesRaw } = await supabase.from('dishes').select('*').eq('active', true)
    const allDishes = (dishesRaw ?? []) as Dish[]
    const dishById = new Map(allDishes.map(d => [d.id, d]))
    const start = new Date(week[0]); start.setDate(start.getDate() - 14)
    const historyStart = start.toISOString().split('T')[0]
    const { data: plansRaw } = await supabase.from('meal_plans').select('*')
      .gte('plan_date', historyStart).lte('plan_date', week[6])
    const plans = (plansRaw ?? []) as MealPlan[]
    const weekSet = new Set(week)
    const priorPlans = plans.filter(p => !weekSet.has(p.plan_date))
    const lockedCells = plans.filter(p => weekSet.has(p.plan_date) && p.locked)

    const dessertHistory = await loadDessertHistory(weekStart)
    const dessertOptions: DessertBatchOptions = {
      cakeEligible: computeCakeEligible(dessertHistory, weekStart),
      lastWeekBatchIds: computeLastWeekBatchIds(dessertHistory, weekStart),
    }
    const eveningFruitOptions: EveningFruitOptions = {
      monthlyEligible: computeMonthlyFruitEligible(dessertHistory, weekStart, dishById),
    }

    const lockedDessertDishIds = lockedCells.filter(l => l.slot === 'desert' && l.dish_id).map(l => l.dish_id as string)
    const dessertPool = allDishes.filter(d => d.slot === 'desert')
    const newDessertBatch = pickDessertBatch(dessertPool, lockedDessertDishIds, DESSERT_WEEK_CAP, rng, dessertOptions)

    const lockedEveningFruitDishIds = lockedCells
      .filter(l => l.slot === 'fruit' && l.role === 'optional' && l.dish_id).map(l => l.dish_id as string)
    const eveningFruitPool = fruitPoolFor('dessert', allDishes.filter(d => d.slot === 'fruit'))
    const newEveningFruitBatch = pickEveningFruitBatch(eveningFruitPool, lockedEveningFruitDishIds, EVENING_FRUIT_WEEK_CAP, rng, eveningFruitOptions)
    const eveningFruitTargetDays = EVENING_FRUIT_MIN_DAYS + Math.floor(rng() * (EVENING_FRUIT_MAX_DAYS - EVENING_FRUIT_MIN_DAYS + 1))
    const eveningFruitDays = preassignEveningFruitDays(week, eveningFruitTargetDays, rng)

    await supabase.from('dessert_weeks').upsert({ week_start: weekStart }, { onConflict: 'week_start' })
    await supabase.from('dessert_week_items').delete().eq('week_start', weekStart)
    const dessertItemRows = newDessertBatch.map(d => ({
      week_start: weekStart, dish_id: d.id, dish_name: d.name,
      kind: d.produce_role === 'dessert_cake' ? 'dessert_cake' : 'dessert_batch',
    }))
    const eveningFruitItemRows = newEveningFruitBatch.map(d => ({
      week_start: weekStart, dish_id: d.id, dish_name: d.name, kind: 'evening_fruit',
    }))
    const weekItemRows = [...dessertItemRows, ...eveningFruitItemRows]
    if (weekItemRows.length) {
      await supabase.from('dessert_week_items').insert(weekItemRows)
    }

    const runPicks = lockedCells.map(l => ({ plan_date: l.plan_date, slot: l.slot as Slot, dish_id: l.dish_id,
      dish_name: l.dish_name, locked: true, role: (l.role ?? 'support') as Role, skipped: l.skipped ?? false }))
    for (const date of week) {
      if (!lockedCells.some(l => l.plan_date === date && l.slot === 'desert')) {
        const p = pickDessertForDay(newDessertBatch, {
          date, slot: 'desert', priorPlans, runPicks, dishById, specialDays: new Set(), hardDays: new Set(),
          relax: { spicy: false, fried: false, hardDay: false, hardSpacing: false, proteinClash: false, spicyMainSpacing: false, noRepeatFactor: 1 },
          role: 'optional', spicyFloor: 1, plannedRemaining: 0,
        }, rng)
        runPicks.push(p)
        const { error } = await supabase.from('meal_plans')
          .upsert({ plan_date: date, slot: 'desert', dish_id: p.dish_id, dish_name: p.dish_name, role: 'optional', skipped: p.skipped, locked: false },
            { onConflict: 'plan_date,slot,role' })
        if (error) return Response.json({ error: error.message }, { status: 500 })
      }
      if (!lockedCells.some(l => l.plan_date === date && l.slot === 'fruit' && l.role === 'optional')) {
        const p = eveningFruitDays.has(date) && newEveningFruitBatch.length > 0
          ? pickEveningFruitForDay(newEveningFruitBatch, {
              date, slot: 'fruit', priorPlans, runPicks, dishById, specialDays: new Set(), hardDays: new Set(),
              relax: { spicy: false, fried: false, hardDay: false, hardSpacing: false, proteinClash: false, spicyMainSpacing: false, noRepeatFactor: 1 },
              role: 'optional', spicyFloor: 1, plannedRemaining: 0,
            }, rng)
          : { plan_date: date, slot: 'fruit' as Slot, dish_id: null, dish_name: null, locked: false, role: 'optional' as Role, skipped: true }
        runPicks.push(p)
        const { error } = await supabase.from('meal_plans')
          .upsert({ plan_date: date, slot: 'fruit', dish_id: p.dish_id, dish_name: p.dish_name, role: 'optional', skipped: p.skipped, locked: false },
            { onConflict: 'plan_date,slot,role' })
        if (error) return Response.json({ error: error.message }, { status: 500 })
      }
    }
    const { data: weekRows } = await supabase.from('meal_plans').select(SELECT).gte('plan_date', week[0]).lte('plan_date', week[6])
    return Response.json({ week: (weekRows ?? []) as MealPlan[] })
  }

  if (!plan_date || !SLOTS.includes(slot)) {
    return Response.json({ error: 'plan_date and valid slot required' }, { status: 400 })
  }
  const cellRole: Role | undefined = body.role
  if (slot === 'fruit' && !cellRole) {
    return Response.json({ error: 'role required for slot=fruit' }, { status: 400 })
  }
  let existingQuery = supabase.from('meal_plans').select('*').eq('plan_date', plan_date).eq('slot', slot)
  if (slot === 'fruit') existingQuery = existingQuery.eq('role', cellRole!)
  const { data: existing } = await existingQuery.maybeSingle()
  if (existing?.locked) return Response.json({ error: 'cell is locked' }, { status: 409 })

  // ---- MAIN reroll → re-compose the day ----
  if (slot === 'utama') {
    const { week, allDishes, plans } = await loadWeek(plan_date)
    const dishById = new Map(allDishes.map(d => [d.id, d]))
    const dayLocked = plans.filter(p => p.plan_date === plan_date && p.locked)
    const lockedByCell = new Map(dayLocked.map(l =>
      [l.slot === 'fruit' ? `${l.plan_date}|${l.slot}|${l.role}` : `${l.plan_date}|${l.slot}`, l]))
    const weekSet = new Set(week)
    const { specialDays, hardDays } = deriveDays(week, plans, dishById)

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

    const breakfastSpecialDays = deriveBreakfastSpecialDays(week, plans, dishById)
    const dessertBatch = await loadWeekItems(mondayOf(plan_date), allDishes, ['dessert_batch', 'dessert_cake'])
    const eveningFruitBatch = await loadWeekItems(mondayOf(plan_date), allDishes, ['evening_fruit'])
    const eveningFruitDays = currentEveningFruitDays(plans, plan_date)
    const created = composeDay({ date: plan_date, dishesBySlot, dishById, priorPlans, runPicks, lockedByCell, specialDays, hardDays, breakfastSpecialDays, dessertBatch, eveningFruitBatch, eveningFruitDays, rng })
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

  // ---- BREAKFAST reroll → independent pick honoring the week's breakfast quota ----
  if (slot === 'breakfast') {
    const { week, allDishes, plans } = await loadWeek(plan_date)
    if (body.dish_id) {
      const d = allDishes.find(x => x.id === body.dish_id)
      if (!d) return Response.json({ error: 'dish not found' }, { status: 404 })
      const { data, error } = await supabase.from('meal_plans')
        .upsert({ plan_date, slot: 'breakfast', dish_id: d.id, dish_name: d.name, locked: false, role: 'breakfast', skipped: false },
          { onConflict: 'plan_date,slot,role' }).select(SELECT).single()
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ pick: data as MealPlan })
    }
    const { ctx, breakfastPool, isSpecialDay } = buildBreakfastContext(plan_date, allDishes, plans, week)
    const p = pickBreakfast(breakfastPool, ctx, isSpecialDay, rng)
    const { data, error } = await supabase.from('meal_plans')
      .upsert({ plan_date, slot: 'breakfast', dish_id: p.dish_id, dish_name: p.dish_name, locked: false, role: 'breakfast', skipped: false },
        { onConflict: 'plan_date,slot,role' }).select(SELECT).single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ pick: data as MealPlan })
  }

  // ---- DESSERT reroll → pick from the week's existing batch, never invent a 4th type ----
  if (slot === 'desert' && !body.dish_id) {
    const { week: dsWeek, allDishes: dsAllDishes, plans: dsPlans } = await loadWeek(plan_date)
    const batch = await loadWeekItems(mondayOf(plan_date), dsAllDishes, ['dessert_batch', 'dessert_cake'])
    const { ctx } = buildSingleContext(plan_date, 'desert', dsAllDishes, dsPlans, dsWeek, 'desert')
    const p = pickDessertForDay(batch, ctx, rng)
    const { data, error } = await supabase.from('meal_plans')
      .upsert({ plan_date, slot: 'desert', dish_id: p.dish_id, dish_name: p.dish_name, locked: false, role: 'optional', skipped: p.skipped },
        { onConflict: 'plan_date,slot,role' }).select(SELECT).single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ pick: data as MealPlan })
  }

  // ---- BREAKFAST-FRUIT reroll → daily-staple alternation, not a fresh pick from the whole pool ----
  if (slot === 'fruit' && cellRole === 'breakfast' && !body.dish_id) {
    const { week: bfWeek, allDishes: bfAllDishes, plans: bfPlans } = await loadWeek(plan_date)
    const { ctx } = buildSingleContext(plan_date, 'fruit', bfAllDishes, bfPlans, bfWeek, 'fruit')
    const p = pickBreakfastFruit(bfAllDishes.filter(d => d.slot === 'fruit'), { ...ctx, role: 'breakfast' }, rng)
    const { data, error } = await supabase.from('meal_plans')
      .upsert({ plan_date, slot: 'fruit', dish_id: p.dish_id, dish_name: p.dish_name, locked: false, role: 'breakfast', skipped: p.skipped },
        { onConflict: 'plan_date,slot,role' }).select(SELECT).single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ pick: data as MealPlan })
  }

  // ---- EVENING-FRUIT reroll → pick from the week's existing batch, never invent a 3rd variation ----
  if (slot === 'fruit' && cellRole === 'optional' && !body.dish_id) {
    const { week: efWeek, allDishes: efAllDishes, plans: efPlans } = await loadWeek(plan_date)
    const batch = await loadWeekItems(mondayOf(plan_date), efAllDishes, ['evening_fruit'])
    const { ctx } = buildSingleContext(plan_date, 'fruit', efAllDishes, efPlans, efWeek, 'fruit')
    const p = pickEveningFruitForDay(batch, { ...ctx, role: 'optional' }, rng)
    const { data, error } = await supabase.from('meal_plans')
      .upsert({ plan_date, slot: 'fruit', dish_id: p.dish_id, dish_name: p.dish_name, locked: false, role: 'optional', skipped: p.skipped },
        { onConflict: 'plan_date,slot,role' }).select(SELECT).single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ pick: data as MealPlan })
  }

  // ---- PELENGKAP (fried dish-helper) reroll → pool spans BOTH 'sayuran' and
  // 'pelengkap' dish.slot values, selected by is_dish_helper — never by slot ----
  if (slot === 'pelengkap') {
    const { week: hWeek, allDishes: hAllDishes, plans: hPlans } = await loadWeek(plan_date)
    if (body.dish_id) {
      const d = hAllDishes.find(x => x.id === body.dish_id)
      if (!d) return Response.json({ error: 'dish not found' }, { status: 404 })
      const { data, error } = await supabase.from('meal_plans')
        .upsert({ plan_date, slot: 'pelengkap', dish_id: d.id, dish_name: d.name, locked: false, role: 'support', skipped: false },
          { onConflict: 'plan_date,slot,role' }).select(SELECT).single()
      if (error) return Response.json({ error: error.message }, { status: 500 })
      return Response.json({ pick: data as MealPlan })
    }
    const helperPool = hAllDishes.filter(d => d.is_dish_helper === true)
    const { ctx } = buildSingleContext(plan_date, 'pelengkap', hAllDishes, hPlans, hWeek, 'pelengkap')
    const p = pickHelper(helperPool, ctx, rng)
    const { data, error } = await supabase.from('meal_plans')
      .upsert({ plan_date, slot: 'pelengkap', dish_id: p.dish_id, dish_name: p.dish_name, locked: false, role: 'support', skipped: p.skipped },
        { onConflict: 'plan_date,slot,role' }).select(SELECT).single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ pick: data as MealPlan })
  }

  // ---- SUPPORT / OPTIONAL reroll → swap one ----
  const { week, allDishes, plans } = await loadWeek(plan_date)
  if (body.dish_id) {
    const d = allDishes.find(x => x.id === body.dish_id)
    if (!d) return Response.json({ error: 'dish not found' }, { status: 404 })
    const rowRole = slot === 'fruit' ? cellRole! : roleForSlot(slot)
    const { data, error } = await supabase.from('meal_plans')
      .upsert({ plan_date, slot, dish_id: d.id, dish_name: d.name, locked: false, role: rowRole, skipped: false },
        { onConflict: 'plan_date,slot,role' }).select(SELECT).single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ pick: data as MealPlan })
  }
  const poolSlot = poolSlotFor(slot as Slot, plan_date, plans, allDishes)
  const { ctx, slotDishes } = buildSingleContext(plan_date, slot as Slot, allDishes, plans, week, poolSlot)
  const p = pickForSlot(slotDishes, ctx, rng)
  const rowRole = roleForSlot(slot as Slot)
  const { data, error } = await supabase.from('meal_plans')
    .upsert({ plan_date, slot, dish_id: p.dish_id, dish_name: p.dish_name, locked: false, role: rowRole, skipped: false },
      { onConflict: 'plan_date,slot,role' }).select(SELECT).single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ pick: data as MealPlan })
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const plan_date = url.searchParams.get('plan_date')
  const slot = url.searchParams.get('slot') as Slot | null
  const role = url.searchParams.get('role') as Role | null
  const n = Math.min(Number(url.searchParams.get('alternatives') ?? 5) || 5, 10)
  if (!plan_date || !slot || !SLOTS.includes(slot)) {
    return Response.json({ error: 'plan_date and valid slot required' }, { status: 400 })
  }
  if (slot === 'fruit' && !role) {
    return Response.json({ error: 'role required for slot=fruit' }, { status: 400 })
  }
  const { week, allDishes, plans } = await loadWeek(plan_date)
  if (slot === 'breakfast') {
    const { ctx, breakfastPool, isSpecialDay } = buildBreakfastContext(plan_date, allDishes, plans, week)
    const pool = breakfastCandidates(breakfastPool, ctx, isSpecialDay)
      .map(d => ({ d, w: weightFor(d, ctx) }))
      .sort((a, b) => b.w - a.w)
      .slice(0, n)
      .map(({ d }) => ({ id: d.id, name: d.name }))
    return Response.json({ alternatives: pool })
  }
  if (slot === 'desert') {
    const batch = await loadWeekItems(mondayOf(plan_date), allDishes, ['dessert_batch', 'dessert_cake'])
    return Response.json({ alternatives: batch.map(d => ({ id: d.id, name: d.name })) })
  }
  if (slot === 'fruit' && role === 'optional') {
    const batch = await loadWeekItems(mondayOf(plan_date), allDishes, ['evening_fruit'])
    return Response.json({ alternatives: batch.map(d => ({ id: d.id, name: d.name })) })
  }
  if (slot === 'fruit' && role === 'breakfast') {
    const pool = fruitPoolFor('breakfast', allDishes.filter(d => d.slot === 'fruit'))
    const staples = pool.filter(d => d.produce_role === 'breakfast_fruit')
    const candidatePool = staples.length > 0 ? staples : pool
    return Response.json({ alternatives: candidatePool.map(d => ({ id: d.id, name: d.name })) })
  }
  if (slot === 'pelengkap') {
    const helperPool = allDishes.filter(d => d.is_dish_helper === true)
    const { ctx } = buildSingleContext(plan_date, 'pelengkap', allDishes, plans, week, 'pelengkap')
    const pool = helperCandidates(helperPool, ctx)
      .map(d => ({ d, w: weightFor(d, ctx) }))
      .sort((a, b) => b.w - a.w)
      .slice(0, n)
      .map(({ d }) => ({ id: d.id, name: d.name }))
    return Response.json({ alternatives: pool })
  }
  const poolSlot = poolSlotFor(slot, plan_date, plans, allDishes)
  const { ctx, slotDishes } = buildSingleContext(plan_date, slot, allDishes, plans, week, poolSlot)
  const pool = candidates(slotDishes, ctx)
    .map(d => ({ d, w: weightFor(d, ctx) }))
    .sort((a, b) => b.w - a.w)
    .slice(0, n)
    .map(({ d }) => ({ id: d.id, name: d.name }))
  return Response.json({ alternatives: pool })
}
