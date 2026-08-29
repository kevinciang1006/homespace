import { supabase } from '@/lib/supabase'
import { weekDates } from '@/lib/meals/dates'
import {
  buildShoppingListFromDishIngredients, mergeShoppingItems,
  type IngredientRef, type DishIngredientLink, type ExistingShoppingItem,
} from '@/lib/meals/shopping'
import { buildWeekMealsSummary, type WeekMealPlanRow } from '@/lib/meals/weekMeals'
import type { MealShoppingList, MealShoppingItem } from '@/lib/meals/types'

export async function POST(request: Request) {
  const { weekStart } = await request.json()
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return Response.json({ error: 'weekStart (YYYY-MM-DD) required' }, { status: 400 })
  }
  const days = weekDates(weekStart)

  const { data: plansRaw } = await supabase.from('meal_plans')
    .select('plan_date, dish_id, dish_name, role, skipped')
    .gte('plan_date', days[0]).lte('plan_date', days[6])
  const plans = (plansRaw ?? []) as (WeekMealPlanRow & { dish_id: string | null })[]
  const meals = buildWeekMealsSummary(weekStart, plans)

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
  const { data: ingredientsRaw } = ingredientIds.length
    ? await supabase.from('ingredients').select('id, name, category, default_unit, shelf_stable').in('id', ingredientIds)
    : { data: [] }
  const ingredientById = new Map<string, IngredientRef>((ingredientsRaw as IngredientRef[] ?? []).map(i => [i.id, i]))

  const built = buildShoppingListFromDishIngredients(
    plans.map(p => ({ dish_id: p.dish_id, dish_name: p.dish_name })), dishIngredientsByDish, ingredientById, dishMetaById,
  )

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
      already_have: false, checked: false, from_dishes: r.from_dishes,
    }))
    const { error } = await supabase.from('meal_shopping_items').insert(rows)
    if (error) return Response.json({ error: error.message }, { status: 500 })
  }
  if (toUpdate.length) {
    const results = await Promise.all(toUpdate.map(u =>
      supabase.from('meal_shopping_items')
        .update({ quantity: u.quantity, category: u.category, from_dishes: u.from_dishes })
        .eq('id', u.id)))
    const failed = results.find(r => r.error)
    if (failed?.error) return Response.json({ error: failed.error.message }, { status: 500 })
  }

  const { data: items } = await supabase.from('meal_shopping_items')
    .select('*').eq('list_id', list.id).order('created_at', { ascending: true })

  return Response.json({ list: list as MealShoppingList, items: (items ?? []) as MealShoppingItem[], meals })
}
