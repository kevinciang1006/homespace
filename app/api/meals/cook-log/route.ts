import { cookies } from 'next/headers'
import { supabase } from '@/lib/supabase'
import { weekDates } from '@/lib/meals/dates'
import { consumeForDish, reconcilePlanDateReservations } from '@/lib/stock/ledger'

function loggedBy(raw?: string): string | null {
  if (!raw) return null
  try { return (JSON.parse(raw) as { name?: string }).name ?? null } catch { return null }
}

export async function GET(request: Request) {
  const weekStart = new URL(request.url).searchParams.get('weekStart')
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return Response.json({ error: 'weekStart required' }, { status: 400 })
  }
  const days = weekDates(weekStart)
  const { data, error } = await supabase.from('cook_log').select('*')
    .gte('cook_date', days[0]).lte('cook_date', days[6])
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ entries: data ?? [] })
}

export async function POST(request: Request) {
  const store = await cookies()
  const by = loggedBy(store.get('hs_session')?.value)
  const body = await request.json()
  const { cook_date } = body
  if (!cook_date || !/^\d{4}-\d{2}-\d{2}$/.test(cook_date)) {
    return Response.json({ error: 'cook_date required' }, { status: 400 })
  }

  type Entry = { slot: string; role: string; planned_dish_id: string | null; planned_dish_name: string | null;
    actual_dish_id: string | null; actual_dish_name: string | null; cooked: boolean; note?: string | null }
  let entries: Entry[] = body.entries

  if (!entries) {
    // "cooked as planned" — derive from the day's non-skipped plan rows
    const { data: plan } = await supabase.from('meal_plans').select('slot, role, dish_id, dish_name')
      .eq('plan_date', cook_date).eq('skipped', false)
    entries = (plan ?? []).filter(p => p.dish_id).map(p => ({
      slot: p.slot, role: p.role ?? 'support', planned_dish_id: p.dish_id, planned_dish_name: p.dish_name,
      actual_dish_id: p.dish_id, actual_dish_name: p.dish_name, cooked: true, note: null,
    }))
  }

  const rows = entries.map(e => ({ ...e, cook_date, logged_by: by }))
  if (rows.length === 0) return Response.json({ entries: [] })

  // Only a genuine not-cooked -> cooked transition should deplete stock —
  // re-saving an already-cooked entry (e.g. she just swapped the actual dish
  // via CookLogSheet while leaving it checked) must not consume twice.
  const { data: existingRaw } = await supabase.from('cook_log')
    .select('slot, role, cooked').eq('cook_date', cook_date)
    .in('slot', rows.map(r => r.slot))
  const wasCooked = new Set(
    (existingRaw ?? []).filter((e: { cooked: boolean }) => e.cooked)
      .map((e: { slot: string; role: string }) => `${e.slot}|${e.role}`),
  )
  const newlyCooked = rows.filter(r => r.cooked && !wasCooked.has(`${r.slot}|${r.role}`))

  const { data, error } = await supabase.from('cook_log')
    .upsert(rows, { onConflict: 'cook_date,slot,role' }).select()
  if (error) return Response.json({ error: error.message }, { status: 500 })

  for (const r of newlyCooked) {
    const dishId = r.actual_dish_id ?? r.planned_dish_id
    if (dishId) await consumeForDish(dishId, cook_date).catch(e => console.error(`[stock] consume for ${dishId} failed:`, e))
  }
  if (newlyCooked.length) {
    await reconcilePlanDateReservations(cook_date).catch(e => console.error(`[stock] reconcile ${cook_date} failed:`, e))
  }
  return Response.json({ entries: data ?? [] })
}
