export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { shiftWeek, mondayOf } from '@/lib/meals/dates'
import { deriveWeekPrepTasks, type PlannedDish } from '@/lib/meals/prepTasks'
import { reconcileSoup } from '@/lib/meals/reconcile'
import type { MealPlan, PrepTask } from '@/lib/meals/types'
import DayView from '@/components/meals/DayView'

const DISHES_SELECT = 'tier, spicy, richness, provides_soup, recipe_image_url, protein, saltiness, difficulty, method, ' +
  'slot, recipe_links, qty_amount, qty_unit, qty_note, veg_portions, fruit_portions, ' +
  'needs_thaw, needs_marinate, prep_lead_days, prep_note, bumbu_packet, prep_type, shop_ingredients'

function longDayName(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

// Ensures this week's prep_tasks exist (backfills weeks generated before
// this feature shipped). A no-op once the week has any prep_tasks rows —
// never re-derives or overwrites an already-generated week.
async function ensurePrepTasksExist(weekStart: string) {
  const weekEnd = shiftWeek(weekStart, 6)
  const weekendBefore = shiftWeek(weekStart, -1)
  const { data: existing } = await supabase.from('prep_tasks').select('id')
    .gte('prep_date', weekendBefore).lte('prep_date', weekEnd).limit(1)
  if (existing && existing.length > 0) return

  const { data: weekPlans } = await supabase.from('meal_plans')
    .select(`plan_date, dish_id, dish_name, skipped, dishes(prep_type, prep_lead_days, prep_note, protein, name)`)
    .gte('plan_date', weekStart).lte('plan_date', weekEnd).eq('skipped', false).not('dish_id', 'is', null)
  type Row = { plan_date: string; dish_id: string; dish_name: string | null
    dishes: { prep_type: string | null; prep_lead_days: number | null; prep_note: string | null; protein: string; name: string } | null }
  const planned: PlannedDish[] = ((weekPlans ?? []) as unknown as Row[])
    .filter(r => r.dishes?.prep_type)
    .map(r => ({
      cook_date: r.plan_date, dish_id: r.dish_id, dish_name: r.dish_name ?? r.dishes!.name,
      prep_type: r.dishes!.prep_type, prep_lead_days: r.dishes!.prep_lead_days,
      prep_note: r.dishes!.prep_note, protein: r.dishes!.protein,
    }))
  const drafts = deriveWeekPrepTasks(weekStart, planned)
  if (drafts.length) {
    await supabase.from('prep_tasks').insert(drafts.map(d => ({
      cook_date: d.cook_date, prep_date: d.prep_date, dish_id: d.dish_id, dish_name: d.dish_name,
      prep_type: d.prep_type, instruction: d.instruction, assigned_to: d.assigned_to,
    })))
  }
}

export default async function DayPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return (
      <div className="text-center py-16">
        <p className="text-stone-500">Invalid date.</p>
        <Link href="/meals" className="text-orange-600 hover:text-orange-700 text-sm mt-2 inline-block">← Back to plan</Link>
      </div>
    )
  }

  await ensurePrepTasksExist(mondayOf(date))

  const [{ data: dayRows }, { data: prepRows }] = await Promise.all([
    supabase.from('meal_plans').select(`*, dishes(${DISHES_SELECT})`).eq('plan_date', date),
    supabase.from('prep_tasks').select('*').eq('prep_date', date).order('created_at'),
  ])

  const rows = await reconcileSoup((dayRows ?? []) as MealPlan[])
  const prepTasks = (prepRows ?? []) as PrepTask[]

  return (
    <DayView
      date={date} dayName={longDayName(date)} rows={rows} prepTasks={prepTasks}
      prevDate={shiftWeek(date, -1)} nextDate={shiftWeek(date, 1)}
      backToWeekHref={`/meals?week=${mondayOf(date)}`}
    />
  )
}
