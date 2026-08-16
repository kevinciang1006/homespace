import { supabase } from '@/lib/supabase'
import { weekDates } from '@/lib/meals/dates'
import type { MealPlan } from '@/lib/meals/types'

export async function GET(request: Request) {
  const weekStart = new URL(request.url).searchParams.get('weekStart')
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return Response.json({ error: 'weekStart required' }, { status: 400 })
  }
  const days = weekDates(weekStart)
  const { data } = await supabase.from('meal_plans').select('*, dishes(tier, spicy, richness, provides_soup, recipe_image_url, protein, saltiness, difficulty, method, recipe_links)')
    .gte('plan_date', days[0]).lte('plan_date', days[6])
  return Response.json({ week: (data ?? []) as MealPlan[] })
}
