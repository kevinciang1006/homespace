import { supabase } from '@/lib/supabase'
import { weekDates } from '@/lib/meals/dates'
import { reconcilePlanDateReservations } from '@/lib/stock/ledger'

// Delete every meal_plan row for the given week (locked rows included). Used to empty a
// week so it no longer feeds the generator's 14-day look-back (no-repeat / protein spacing).
export async function POST(request: Request) {
  const { weekStart } = await request.json()
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return Response.json({ error: 'weekStart required' }, { status: 400 })
  }
  const days = weekDates(weekStart)
  const { error } = await supabase.from('meal_plans').delete()
    .gte('plan_date', days[0]).lte('plan_date', days[6])
  if (error) return Response.json({ error: error.message }, { status: 500 })
  // The emptied week wasn't actually cooked — clear its cook log too so no badge lingers.
  await supabase.from('cook_log').delete().gte('cook_date', days[0]).lte('cook_date', days[6])
  // Nothing's planned anymore — release whatever was reserved for these days.
  await Promise.all(days.map(d => reconcilePlanDateReservations(d).catch(e => console.error(`[stock] reconcile ${d} failed:`, e))))
  return Response.json({ success: true })
}
