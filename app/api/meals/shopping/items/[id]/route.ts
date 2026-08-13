import { supabase } from '@/lib/supabase'

const FIELDS = ['ingredient', 'quantity', 'category', 'already_have', 'checked']

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json()
  const patch = Object.fromEntries(Object.entries(body).filter(([k]) => FIELDS.includes(k)))
  const { data, error } = await supabase.from('meal_shopping_items').update(patch).eq('id', id).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await supabase.from('meal_shopping_items').delete().eq('id', id)
  return Response.json({ success: true })
}
