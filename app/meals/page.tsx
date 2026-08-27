export const dynamic = 'force-dynamic'

import { supabase } from '@/lib/supabase'
import { weekDates, mondayOf } from '@/lib/meals/dates'
import { reconcileSoup } from '@/lib/meals/reconcile'
import type { DailyStaple, MealPlan } from '@/lib/meals/types'
import PlanClient from '@/components/meals/PlanClient'

function currentMonday(): string {
  const now = new Date()
  const dow = (now.getDay() + 6) % 7
  now.setDate(now.getDate() - dow)
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export default async function MealsPlanPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { week } = await searchParams
  const weekStart = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? mondayOf(week) : currentMonday()
  const days = weekDates(weekStart)
  const [{ data }, { data: staplesData }] = await Promise.all([
    supabase.from('meal_plans').select('*, dishes(tier, spicy, richness, provides_soup, recipe_image_url, protein, saltiness, difficulty, method, slot, recipe_links, qty_amount, qty_unit, qty_note, veg_portions, fruit_portions, self_sufficient_main)')
      .gte('plan_date', days[0]).lte('plan_date', days[6]),
    supabase.from('daily_staples').select('*').order('person'),
  ])
  const initialWeek = await reconcileSoup((data ?? []) as MealPlan[])
  return <PlanClient initialWeekStart={weekStart} initialWeek={initialWeek} initialStaples={(staplesData ?? []) as DailyStaple[]} />
}
