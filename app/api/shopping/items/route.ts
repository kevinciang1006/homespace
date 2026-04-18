import { supabase } from '@/lib/supabase'

export async function POST(request: Request) {
  const { name, quantity, group_id, added_by } = await request.json()
  if (!name?.trim() || !group_id) {
    return Response.json({ error: 'name and group_id required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('shopping_items')
    .insert({ name: name.trim(), quantity: quantity ?? null, group_id, added_by: added_by ?? null, checked: false })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}
