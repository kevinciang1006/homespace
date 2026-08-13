import { supabase } from '@/lib/supabase'
import { weekDates } from '@/lib/meals/dates'
import { buildShoppingList, type DishIngredient } from '@/lib/meals/shopping'
import type { MealShoppingList, MealShoppingItem } from '@/lib/meals/types'

export async function POST(request: Request) {
  const { weekStart } = await request.json()
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return Response.json({ error: 'weekStart (YYYY-MM-DD) required' }, { status: 400 })
  }
  const days = weekDates(weekStart)

  const [{ data: plansRaw }, { data: dishesRaw }] = await Promise.all([
    supabase.from('meal_plans').select('dish_id, dish_name').gte('plan_date', days[0]).lte('plan_date', days[6]),
    supabase.from('dishes').select('id, name, ingredients'),
  ])

  const dishById = new Map<string, { name: string; ingredients: DishIngredient[] | null }>(
    (dishesRaw ?? []).map((d: { id: string; name: string; ingredients: DishIngredient[] | null }) =>
      [d.id, { name: d.name, ingredients: d.ingredients }]),
  )
  const built = buildShoppingList((plansRaw ?? []) as { dish_id: string | null; dish_name: string | null }[], dishById)

  // upsert the list row for the week
  const { data: list, error: listErr } = await supabase.from('meal_shopping_lists')
    .upsert({ week_start: weekStart, generated_at: new Date().toISOString(), archived: false }, { onConflict: 'week_start' })
    .select().single()
  if (listErr || !list) return Response.json({ error: listErr?.message ?? 'list upsert failed' }, { status: 500 })

  // full replace: delete all existing items, then insert fresh
  await supabase.from('meal_shopping_items').delete().eq('list_id', list.id)

  const rows = [
    ...built.ingredients.map(i => ({
      list_id: list.id, ingredient: i.ingredient, quantity: i.quantity, category: i.category,
      already_have: false, checked: false, from_dishes: i.from_dishes,
    })),
    ...built.dishesWithoutIngredients.map(name => ({
      list_id: list.id, ingredient: name, quantity: null, category: 'dish',
      already_have: false, checked: false, from_dishes: [{ dish: name }],
    })),
  ]
  let items: MealShoppingItem[] = []
  if (rows.length) {
    const { data, error } = await supabase.from('meal_shopping_items').insert(rows).select()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    items = (data ?? []) as MealShoppingItem[]
  }

  return Response.json({ list: list as MealShoppingList, items })
}
