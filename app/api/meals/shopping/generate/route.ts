import { supabase } from '@/lib/supabase'
import { weekDates } from '@/lib/meals/dates'
import { buildShoppingList, mergeShoppingItems, type DishIngredient, type ExistingShoppingItem } from '@/lib/meals/shopping'
import type { MealShoppingList, MealShoppingItem } from '@/lib/meals/types'

export async function POST(request: Request) {
  const { weekStart } = await request.json()
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return Response.json({ error: 'weekStart (YYYY-MM-DD) required' }, { status: 400 })
  }
  const days = weekDates(weekStart)

  const [{ data: plansRaw }, { data: dishesRaw }] = await Promise.all([
    supabase.from('meal_plans').select('dish_id, dish_name').gte('plan_date', days[0]).lte('plan_date', days[6]),
    supabase.from('dishes').select('id, name, ingredients, qty_amount, qty_unit, qty_note'),
  ])

  type DishRow = { id: string; name: string; ingredients: DishIngredient[] | null; qty_amount: number | null; qty_unit: string | null; qty_note: string | null }
  const dishById = new Map<string, Omit<DishRow, 'id'>>(
    (dishesRaw ?? []).map((d: DishRow) =>
      [d.id, { name: d.name, ingredients: d.ingredients, qty_amount: d.qty_amount, qty_unit: d.qty_unit, qty_note: d.qty_note }]),
  )
  const built = buildShoppingList((plansRaw ?? []) as { dish_id: string | null; dish_name: string | null }[], dishById)

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

  return Response.json({ list: list as MealShoppingList, items: (items ?? []) as MealShoppingItem[] })
}
