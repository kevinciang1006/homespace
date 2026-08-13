import { supabase } from '@/lib/supabase'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json()
  const allowed = (({ locked, dish_id, dish_name }) => ({ locked, dish_id, dish_name }))(body)
  const patch = Object.fromEntries(Object.entries(allowed).filter(([, v]) => v !== undefined))
  const { data, error } = await supabase.from('meal_plans').update(patch).eq('id', id).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}
