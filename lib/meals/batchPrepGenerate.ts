import { supabase } from '@/lib/supabase'
import { weekDates } from './dates'
import {
  groupBatchPrepByDish, deriveFruitPrepItems, deriveBatchPrepTaskDrafts,
  buildMainLines, buildSoupLines, buildVegLines,
  type BatchPrepIngredientRow, type FruitDishRow, type BatchPrepDishBlock, type FruitPrepItem, type PackingDish,
} from './batchPrep'

// Slots with their own dish_ingredients-driven cooking prep — everything
// else (breakfast/fruit/desert) is either "buy as-is" or handled by
// deriveFruitPrepItems below instead.
const COOKING_SLOTS = ['utama', 'kuah', 'sayuran', 'pelengkap']

export type GenerateBatchPrepResult = {
  dishBlocks: BatchPrepDishBlock[]
  fruitItems: FruitPrepItem[]
  created: number
  skipped: number
}

// Walks the week's planned dishes, builds the Wife (cooking) and Kevin
// (fruit/yogurt) prep blocks, and persists them as prep_tasks rows —
// deduped against whatever's already there for the week so re-running
// (a second "Generate prep list" click, or the next cron tick) never
// duplicates work. Returns the computed blocks too, so callers (the app
// route, the WA cron) can compose a message from the same data without a
// second round trip.
export async function generateWeekBatchPrep(weekStart: string, today: string): Promise<GenerateBatchPrepResult> {
  const days = weekDates(weekStart)
  type PlanRow = { plan_date: string; dish_id: string; dish_name: string | null; slot: string }
  const { data: plansRaw } = await supabase.from('meal_plans')
    .select('plan_date, dish_id, dish_name, slot')
    .gte('plan_date', days[0]).lte('plan_date', days[6])
    .eq('skipped', false).not('dish_id', 'is', null)
  const plans = (plansRaw ?? []) as PlanRow[]

  const cookingDishIds = [...new Set(plans.filter(p => COOKING_SLOTS.includes(p.slot)).map(p => p.dish_id))]
  const fruitPlans = plans.filter(p => p.slot === 'fruit' || p.slot === 'desert')
  const fruitDishIds = [...new Set(fruitPlans.map(p => p.dish_id))]

  const [{ data: dishIngredientsRaw }, { data: fruitDishesRaw }] = await Promise.all([
    cookingDishIds.length
      ? supabase.from('dish_ingredients')
          .select('dish_id, amount, unit, prep_action, prep_note, ingredients(name)')
          .in('dish_id', cookingDishIds).not('prep_action', 'is', null).neq('prep_action', 'none')
      : Promise.resolve({ data: [] as unknown[] }),
    fruitDishIds.length
      ? supabase.from('dishes').select('id, name, qty_amount, qty_unit').in('id', fruitDishIds)
      : Promise.resolve({ data: [] as unknown[] }),
  ])

  // Earliest cook_date + display name per dish, for the cooking-prep side.
  const cookMetaByDish = new Map<string, { cook_date: string; dish_name: string }>()
  for (const p of plans) {
    if (!COOKING_SLOTS.includes(p.slot)) continue
    const existing = cookMetaByDish.get(p.dish_id)
    if (!existing || p.plan_date < existing.cook_date) {
      cookMetaByDish.set(p.dish_id, { cook_date: p.plan_date, dish_name: p.dish_name ?? 'Dish' })
    }
  }

  // Same caveat as app/api/wa/cron/route.ts's buildPrepBatches: without
  // generated DB types, supabase-js can't infer the `ingredients` embed is
  // to-one, so it's typed as unknown at the boundary.
  type DishIngredientRow = {
    dish_id: string; amount: number | null; unit: string | null
    prep_action: string; prep_note: string | null; ingredients: { name: string } | null
  }
  const ingredientRows: BatchPrepIngredientRow[] = ((dishIngredientsRaw ?? []) as unknown as DishIngredientRow[])
    .filter(r => r.ingredients && cookMetaByDish.has(r.dish_id))
    .map(r => {
      const meta = cookMetaByDish.get(r.dish_id)!
      return {
        dish_id: r.dish_id, dish_name: meta.dish_name, cook_date: meta.cook_date,
        ingredient_name: r.ingredients!.name, amount: r.amount, unit: r.unit,
        prep_action: r.prep_action, prep_note: r.prep_note,
      }
    })
  const dishBlocks = groupBatchPrepByDish(ingredientRows)

  type FruitDishMeta = { id: string; name: string; qty_amount: number | null; qty_unit: string | null }
  const fruitDishMetaById = new Map<string, FruitDishMeta>(((fruitDishesRaw ?? []) as FruitDishMeta[]).map(d => [d.id, d]))
  const fruitRows: FruitDishRow[] = fruitPlans
    .filter(p => fruitDishMetaById.has(p.dish_id))
    .map(p => {
      const meta = fruitDishMetaById.get(p.dish_id)!
      return {
        dish_id: p.dish_id, dish_name: meta.name, cook_date: p.plan_date, slot: p.slot,
        qty_amount: meta.qty_amount, qty_unit: meta.qty_unit,
      }
    })
  const fruitItems = deriveFruitPrepItems(fruitRows)

  const drafts = deriveBatchPrepTaskDrafts(weekStart, today, dishBlocks, fruitItems)

  // One prep_sessions row per week — informational (prep_tasks carries the
  // actual data via week_start), kept for whatever reporting/history wants
  // a single "this week's batch prep happened on X" anchor later.
  await supabase.from('prep_sessions').upsert({ week_start: weekStart, prep_date: today }, { onConflict: 'week_start' })

  const { data: existingRaw } = await supabase.from('prep_tasks')
    .select('dish_id, instruction').eq('week_start', weekStart).eq('prep_category', 'batch_prep')
  const existingKeys = new Set((existingRaw ?? []).map(r => `${r.dish_id ?? ''}::${r.instruction ?? ''}`))
  const toInsert = drafts.filter(d => !existingKeys.has(`${d.dish_id}::${d.instruction}`))

  if (toInsert.length) {
    const { error } = await supabase.from('prep_tasks').insert(toInsert.map(d => ({
      cook_date: d.cook_date, prep_date: d.prep_date, dish_id: d.dish_id, dish_name: d.dish_name,
      prep_type: d.prep_action, instruction: d.instruction, assigned_to: d.assigned_to,
      week_start: d.week_start, prep_category: 'batch_prep', done: false,
    })))
    if (error) throw new Error(error.message)
  }

  return { dishBlocks, fruitItems, created: toInsert.length, skipped: drafts.length - toInsert.length }
}

export type WeeklyPackingList = { main: string[]; soup: string[]; veg: string[] }

// Separate read path for the WhatsApp message specifically — see
// lib/meals/batchPrep.ts's "WA packing list" section for why this needs the
// dish's FULL ingredient list (not just prep_action-tagged rows the way
// generateWeekBatchPrep's dishBlocks are scoped): a soup's line lists its
// whole bundle, including components that need no active prep at all.
// Doesn't touch prep_tasks — purely a read, composed fresh on every send.
export async function buildWeeklyPackingList(weekStart: string): Promise<WeeklyPackingList> {
  const days = weekDates(weekStart)
  type PlanRow = { plan_date: string; dish_id: string; dish_name: string | null; slot: string }
  const { data: plansRaw } = await supabase.from('meal_plans')
    .select('plan_date, dish_id, dish_name, slot')
    .gte('plan_date', days[0]).lte('plan_date', days[6])
    .eq('skipped', false).not('dish_id', 'is', null).in('slot', COOKING_SLOTS)
  const plans = (plansRaw ?? []) as PlanRow[]
  if (plans.length === 0) return { main: [], soup: [], veg: [] }

  const dishIds = [...new Set(plans.map(p => p.dish_id))]
  const [{ data: dishesRaw }, { data: ingredientsRaw }] = await Promise.all([
    supabase.from('dishes').select('id, bumbu_packet').in('id', dishIds),
    supabase.from('dish_ingredients')
      .select('dish_id, amount, unit, prep_action, prep_note, ingredients(name, category)')
      .in('dish_id', dishIds),
  ])

  const bumbuPacketByDish = new Map<string, string | null>(
    ((dishesRaw ?? []) as { id: string; bumbu_packet: string | null }[]).map(d => [d.id, d.bumbu_packet]))

  // Earliest cook_date wins for a dish repeated across the week — same
  // "prep once per unique dish" convention as generateWeekBatchPrep.
  const metaByDish = new Map<string, { slot: string; dish_name: string; cook_date: string }>()
  for (const p of plans) {
    const existing = metaByDish.get(p.dish_id)
    if (!existing || p.plan_date < existing.cook_date) {
      metaByDish.set(p.dish_id, { slot: p.slot, dish_name: p.dish_name ?? 'Dish', cook_date: p.plan_date })
    }
  }

  // Same to-one embed caveat as elsewhere in this file.
  type IngredientRow = {
    dish_id: string; amount: number | null; unit: string | null
    prep_action: string | null; prep_note: string | null; ingredients: { name: string; category: string } | null
  }
  const ingredientsByDish = new Map<string, PackingDish['ingredients']>()
  for (const r of ((ingredientsRaw ?? []) as unknown as IngredientRow[])) {
    if (!r.ingredients || !metaByDish.has(r.dish_id)) continue
    const list = ingredientsByDish.get(r.dish_id) ?? []
    list.push({
      ingredient_name: r.ingredients.name, category: r.ingredients.category,
      amount: r.amount, unit: r.unit, prep_action: r.prep_action ?? 'none', prep_note: r.prep_note,
    })
    ingredientsByDish.set(r.dish_id, list)
  }

  const dishes: PackingDish[] = [...metaByDish.entries()].map(([dish_id, meta]) => ({
    dish_id, dish_name: meta.dish_name, cook_date: meta.cook_date, slot: meta.slot,
    bumbu_packet: bumbuPacketByDish.get(dish_id) ?? null,
    ingredients: ingredientsByDish.get(dish_id) ?? [],
  }))

  return { main: buildMainLines(dishes), soup: buildSoupLines(dishes), veg: buildVegLines(dishes) }
}
