export const dynamic = 'force-dynamic'

import { supabase } from '@/lib/supabase'
import { currentMonday, mondayOf, weekDates } from '@/lib/meals/dates'
import { buildWeekMealsSummary, type WeekMealPlanRow } from '@/lib/meals/weekMeals'
import type { MealShoppingList, MealShoppingItem } from '@/lib/meals/types'
import ShoppingListClient from '@/components/meals/ShoppingListClient'

export default async function MealShoppingPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { week } = await searchParams
  // Snap any date in the week param to its Monday, so a deep link from the
  // WhatsApp message (or a stray non-Monday date) still opens the right week.
  const weekStart = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? mondayOf(week) : currentMonday()

  const { data: list } = await supabase.from('meal_shopping_lists')
    .select('*').eq('week_start', weekStart).maybeSingle()
  let items: MealShoppingItem[] = []
  if (list) {
    const { data } = await supabase.from('meal_shopping_items')
      .select('*').eq('list_id', list.id).order('created_at', { ascending: true })
    items = (data ?? []) as MealShoppingItem[]
  }

  const days = weekDates(weekStart)
  const { data: plansRaw } = await supabase.from('meal_plans')
    .select('plan_date, dish_name, role, skipped').gte('plan_date', days[0]).lte('plan_date', days[6])
  const meals = buildWeekMealsSummary(weekStart, (plansRaw ?? []) as WeekMealPlanRow[])

  return (
    <ShoppingListClient
      initialWeekStart={weekStart}
      initialList={(list ?? null) as MealShoppingList | null}
      initialItems={items}
      initialMeals={meals}
    />
  )
}
