import { supabase } from '@/lib/supabase'
import { weekDates } from '@/lib/meals/dates'
import {
  buildShoppingListFromDishIngredients, mergeShoppingItems,
  type IngredientRef, type DishIngredientLink, type ExistingShoppingItem, type StockAvailability,
} from '@/lib/meals/shopping'
import { bucketStockOnHand, bucketReserved, type StockRowLite, type ReservedMovementLite } from '@/lib/stock/availability'
import type { MealShoppingList, MealShoppingItem } from '@/lib/meals/types'

// Stock isn't scoped to a specific week — a fish in the freezer covers
// whatever week needs it. Reserved (ref_type='meal_plan') is real-time
// across ALL currently-planned weeks too, so two different weeks' shopping
// lists both correctly see the same fish as partly-or-fully spoken for.
async function loadStockAvailability(): Promise<StockAvailability> {
  const [{ data: stockRaw }, { data: movementsRaw }] = await Promise.all([
    supabase.from('stock').select('ingredient_id, on_hand, unit, ingredients(satisfies_group)'),
    supabase.from('stock_movements').select('ingredient_id, kind, amount, unit')
      .eq('ref_type', 'meal_plan').in('kind', ['reserve', 'release', 'consume']),
  ])
  type StockJoinRow = { ingredient_id: string; on_hand: number; unit: string | null; ingredients: { satisfies_group: string | null }[] | { satisfies_group: string | null } | null }
  const stockRows: StockRowLite[] = ((stockRaw ?? []) as StockJoinRow[]).map(r => {
    const joined = Array.isArray(r.ingredients) ? r.ingredients[0] : r.ingredients
    return { ingredient_id: r.ingredient_id, on_hand: Number(r.on_hand), unit: r.unit, satisfies_group: joined?.satisfies_group ?? null }
  })
  return {
    stockBuckets: bucketStockOnHand(stockRows),
    reservedByIngredient: bucketReserved((movementsRaw ?? []) as ReservedMovementLite[]),
  }
}

export async function POST(request: Request) {
  const { weekStart } = await request.json()
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return Response.json({ error: 'weekStart (YYYY-MM-DD) required' }, { status: 400 })
  }
  const days = weekDates(weekStart)

  // Breakfast is excluded here on purpose — this is a shopping list, and
  // breakfast items (bubur, roti, telur rebus...) are "buy as-is" dishes with
  // no dish_ingredients anyway, so they only ever cluttered the "dishes with
  // no ingredients" bucket.
  type PlanRow = { plan_date: string; dish_id: string | null; dish_name: string | null; role: string; skipped: boolean }
  const { data: plansRaw } = await supabase.from('meal_plans')
    .select('plan_date, dish_id, dish_name, role, skipped')
    .gte('plan_date', days[0]).lte('plan_date', days[6])
    .neq('slot', 'breakfast')
  const plans = (plansRaw ?? []) as PlanRow[]

  const dishIds = [...new Set(plans.map(p => p.dish_id).filter((id): id is string => !!id))]
  const [{ data: dishesRaw }, { data: dishIngredientsRaw }] = dishIds.length
    ? await Promise.all([
        supabase.from('dishes').select('id, name, qty_amount, qty_unit, qty_note').in('id', dishIds),
        supabase.from('dish_ingredients').select('dish_id, ingredient_id, amount, unit').in('dish_id', dishIds),
      ])
    : [{ data: [] }, { data: [] }]

  type DishMetaRow = { id: string; name: string; qty_amount: number | null; qty_unit: string | null; qty_note: string | null }
  const dishMetaById = new Map<string, Omit<DishMetaRow, 'id'>>(
    (dishesRaw as DishMetaRow[] ?? []).map(d => [d.id, { name: d.name, qty_amount: d.qty_amount, qty_unit: d.qty_unit, qty_note: d.qty_note }]),
  )

  type DishIngredientRawRow = { dish_id: string; ingredient_id: string; amount: number | null; unit: string | null }
  const dishIngredientsByDish = new Map<string, DishIngredientLink[]>()
  for (const row of (dishIngredientsRaw as DishIngredientRawRow[] ?? [])) {
    const list = dishIngredientsByDish.get(row.dish_id) ?? []
    list.push({ ingredient_id: row.ingredient_id, amount: row.amount, unit: row.unit })
    dishIngredientsByDish.set(row.dish_id, list)
  }

  const ingredientIds = [...new Set((dishIngredientsRaw as DishIngredientRawRow[] ?? []).map(r => r.ingredient_id))]
  const [{ data: ingredientsRaw }, stock] = await Promise.all([
    ingredientIds.length
      ? supabase.from('ingredients').select('id, name, category, default_unit, shelf_stable, satisfies_group').in('id', ingredientIds)
      : Promise.resolve({ data: [] }),
    loadStockAvailability(),
  ])
  const ingredientById = new Map<string, IngredientRef>((ingredientsRaw as IngredientRef[] ?? []).map(i => [i.id, i]))

  const built = buildShoppingListFromDishIngredients(
    plans.map(p => ({ dish_id: p.dish_id, dish_name: p.dish_name })), dishIngredientsByDish, ingredientById, dishMetaById, stock,
  )
  // Surfaced here (not thrown) — a mixed-unit ingredient still gets a usable
  // total (see dominantUnitClass), this is just a nudge to go fix the dish
  // data that caused it.
  for (const w of built.mixedUnitWarnings ?? []) {
    console.warn(`[shopping] ${w.ingredient}: ${w.detail}`)
  }

  // upsert the list row for the week
  const { data: list, error: listErr } = await supabase.from('meal_shopping_lists')
    .upsert({ week_start: weekStart, generated_at: new Date().toISOString(), archived: false }, { onConflict: 'week_start' })
    .select().single()
  if (listErr || !list) return Response.json({ error: listErr?.message ?? 'list upsert failed' }, { status: 500 })

  // Non-destructive merge: refresh plan-derived rows, keep ✓ marks + "already have" + manual items.
  const { data: existingRaw } = await supabase.from('meal_shopping_items')
    .select('id, ingredient, from_dishes').eq('list_id', list.id)
  const { toInsert, toUpdate, toDelete } = mergeShoppingItems(
    (existingRaw ?? []) as ExistingShoppingItem[], built)

  if (toDelete.length) {
    const { error } = await supabase.from('meal_shopping_items').delete().in('id', toDelete)
    if (error) return Response.json({ error: error.message }, { status: 500 })
  }
  if (toInsert.length) {
    const rows = toInsert.map(r => ({
      list_id: list.id, ingredient: r.ingredient, quantity: r.quantity, category: r.category,
      already_have: r.already_have, checked: false, from_dishes: r.from_dishes,
    }))
    const { error } = await supabase.from('meal_shopping_items').insert(rows)
    if (error) return Response.json({ error: error.message }, { status: 500 })
  }
  if (toUpdate.length) {
    const results = await Promise.all(toUpdate.map(u =>
      supabase.from('meal_shopping_items')
        .update({ quantity: u.quantity, category: u.category, from_dishes: u.from_dishes, already_have: u.already_have })
        .eq('id', u.id)))
    const failed = results.find(r => r.error)
    if (failed?.error) return Response.json({ error: failed.error.message }, { status: 500 })
  }

  const { data: items } = await supabase.from('meal_shopping_items')
    .select('*').eq('list_id', list.id).order('created_at', { ascending: true })

  return Response.json({ list: list as MealShoppingList, items: (items ?? []) as MealShoppingItem[] })
}
