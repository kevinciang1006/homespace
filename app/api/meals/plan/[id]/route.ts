import { supabase } from '@/lib/supabase'
import { reconcilePlanDateReservations } from '@/lib/stock/ledger'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json()
  const allowed = (({ locked, dish_id, dish_name }) => ({ locked, dish_id, dish_name }))(body)
  const patch = Object.fromEntries(Object.entries(allowed).filter(([, v]) => v !== undefined))
  const { data, error } = await supabase.from('meal_plans').update(patch).eq('id', id).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  // dish_id changing (search-picked dish, or "clear"/undo) shifts what's
  // reserved for that day — best-effort, shouldn't fail the edit itself.
  if ('dish_id' in patch && data?.plan_date) {
    await reconcilePlanDateReservations(data.plan_date).catch(e => console.error(`[stock] reconcile ${data.plan_date} failed:`, e))
  }
  return Response.json(data)
}
