export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { shiftWeek, mondayOf, prepDateFor } from '@/lib/meals/dates'
import { groupPrepByDate, prepPhrase, type PrepCandidate } from '@/lib/meals/prep'
import { reconcileSoup } from '@/lib/meals/reconcile'
import type { MealPlan } from '@/lib/meals/types'
import DayView, { type TodayPrepItem, type UpcomingPrepItem } from '@/components/meals/DayView'

const DISHES_SELECT = 'tier, spicy, richness, provides_soup, recipe_image_url, protein, saltiness, difficulty, method, ' +
  'slot, recipe_links, qty_amount, qty_unit, qty_note, veg_portions, fruit_portions, ' +
  'needs_thaw, needs_marinate, prep_lead_days, prep_note, bumbu_packet'

const PREP_LOOKAHEAD_DAYS = 14

function shortDayName(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short' })
}
function longDayName(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
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

  const until = shiftWeek(date, PREP_LOOKAHEAD_DAYS)
  const [{ data: dayRows }, { data: lookaheadRows }] = await Promise.all([
    supabase.from('meal_plans').select(`*, dishes(${DISHES_SELECT})`).eq('plan_date', date),
    supabase.from('meal_plans')
      .select('plan_date, dish_id, dish_name, skipped, dishes(needs_thaw, needs_marinate, prep_lead_days, prep_note)')
      .gte('plan_date', date).lte('plan_date', until).eq('skipped', false).not('dish_id', 'is', null),
  ])

  const rows = await reconcileSoup((dayRows ?? []) as MealPlan[])

  // Today's own dishes that needed thaw/marinate — informational recap.
  const todayPrep: TodayPrepItem[] = rows
    .filter(r => r.dish_id && !r.skipped && (r.dishes?.needs_thaw || r.dishes?.needs_marinate))
    .map(r => {
      const needsThaw = !!r.dishes?.needs_thaw
      const needsMarinate = !!r.dishes?.needs_marinate
      const prepNote = r.dishes?.prep_note ?? null
      const leadDays = r.dishes?.prep_lead_days ?? null
      return {
        dish_id: r.dish_id as string,
        dish_name: r.dish_name ?? 'Dish',
        phrase: prepPhrase({ needs_thaw: needsThaw, needs_marinate: needsMarinate, prep_note: prepNote }),
        prepDayLabel: shortDayName(prepDateFor(date, leadDays)),
      }
    })

  // Dishes elsewhere in the lookahead window whose computed prep date is TODAY.
  type LookaheadRow = {
    plan_date: string; dish_id: string; dish_name: string | null
    dishes: { needs_thaw: boolean; needs_marinate: boolean; prep_lead_days: number | null; prep_note: string | null } | null
  }
  const candidates: PrepCandidate[] = ((lookaheadRows ?? []) as unknown as LookaheadRow[])
    .filter(r => r.dishes && r.plan_date !== date) // today's own dishes are covered by todayPrep above
    .map(r => ({
      dish_id: r.dish_id, dish_name: r.dish_name ?? 'Dish', cook_date: r.plan_date,
      needs_thaw: r.dishes!.needs_thaw, needs_marinate: r.dishes!.needs_marinate,
      prep_lead_days: r.dishes!.prep_lead_days, prep_note: r.dishes!.prep_note,
    }))
  const dueToday = groupPrepByDate(candidates).get(date) ?? []
  const upcomingPrep: UpcomingPrepItem[] = dueToday.map(item => ({
    dish_id: item.dish_id, dish_name: item.dish_name, phrase: prepPhrase(item),
    cookDate: item.cook_date, cookDayLabel: shortDayName(item.cook_date),
  }))

  return (
    <DayView
      date={date} dayName={longDayName(date)} rows={rows}
      todayPrep={todayPrep} upcomingPrep={upcomingPrep}
      prevDate={shiftWeek(date, -1)} nextDate={shiftWeek(date, 1)}
      backToWeekHref={`/meals?week=${mondayOf(date)}`}
    />
  )
}
