export const dynamic = 'force-dynamic'

import { supabase } from '@/lib/supabase'
import { currentMonday } from '@/lib/meals/dates'
import type { MealShoppingList, MealShoppingItem } from '@/lib/meals/types'
import ShoppingListClient from '@/components/meals/ShoppingListClient'

export default async function MealShoppingPage() {
  const weekStart = currentMonday()
  const { data: list } = await supabase.from('meal_shopping_lists')
    .select('*').eq('week_start', weekStart).maybeSingle()
  let items: MealShoppingItem[] = []
  if (list) {
    const { data } = await supabase.from('meal_shopping_items')
      .select('*').eq('list_id', list.id).order('created_at', { ascending: true })
    items = (data ?? []) as MealShoppingItem[]
  }
  return (
    <ShoppingListClient
      initialWeekStart={weekStart}
      initialList={(list ?? null) as MealShoppingList | null}
      initialItems={items}
    />
  )
}
