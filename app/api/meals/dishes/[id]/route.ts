import { supabase } from '@/lib/supabase'

const FIELDS = ['name', 'slot', 'protein', 'tier', 'method', 'spicy', 'rating', 'active', 'no_repeat_days']

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json()
  const patch = Object.fromEntries(Object.entries(body).filter(([k]) => FIELDS.includes(k)))
  const { data, error } = await supabase.from('dishes').update(patch).eq('id', id).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}
