import { supabase } from '@/lib/supabase'
import type { MealShoppingList, MealShoppingItem } from '@/lib/meals/types'

export async function GET(request: Request) {
  const weekStart = new URL(request.url).searchParams.get('weekStart')
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return Response.json({ error: 'weekStart required' }, { status: 400 })
  }
  const { data: list } = await supabase.from('meal_shopping_lists')
    .select('*').eq('week_start', weekStart).maybeSingle()
  if (!list) return Response.json({ list: null, items: [] })

  const { data: items } = await supabase.from('meal_shopping_items')
    .select('*').eq('list_id', list.id).order('created_at', { ascending: true })
  return Response.json({ list: list as MealShoppingList, items: (items ?? []) as MealShoppingItem[] })
}
