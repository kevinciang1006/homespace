import { supabase } from '@/lib/supabase'
import { weekDates } from '@/lib/meals/dates'
import { reconcileSoup } from '@/lib/meals/reconcile'
import type { MealPlan } from '@/lib/meals/types'

export async function GET(request: Request) {
  const weekStart = new URL(request.url).searchParams.get('weekStart')
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return Response.json({ error: 'weekStart required' }, { status: 400 })
  }
  const days = weekDates(weekStart)
  const { data } = await supabase.from('meal_plans').select('*, dishes(tier, spicy, richness, provides_soup, recipe_image_url, protein, saltiness, difficulty, method, slot, recipe_links, qty_amount, qty_unit, qty_note, veg_portions, fruit_portions, self_sufficient_main)')
    .gte('plan_date', days[0]).lte('plan_date', days[6])
  const week = await reconcileSoup((data ?? []) as MealPlan[])
  return Response.json({ week })
}
