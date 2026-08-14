export const dynamic = 'force-dynamic'

import { supabase } from '@/lib/supabase'
import { weekDates } from '@/lib/meals/dates'
import type { MealPlan } from '@/lib/meals/types'
import PlanClient from '@/components/meals/PlanClient'

function currentMonday(): string {
  const now = new Date()
  const dow = (now.getDay() + 6) % 7
  now.setDate(now.getDate() - dow)
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export default async function MealsPlanPage() {
  const weekStart = currentMonday()
  const days = weekDates(weekStart)
  const { data } = await supabase.from('meal_plans').select('*, dishes(tier, spicy, richness, provides_soup, recipe_image_url, protein)')
    .gte('plan_date', days[0]).lte('plan_date', days[6])
  return <PlanClient initialWeekStart={weekStart} initialWeek={(data ?? []) as MealPlan[]} />
}
