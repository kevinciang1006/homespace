import { supabase } from '@/lib/supabase'

export async function POST(request: Request) {
  const { name, quantity, group_id, added_by } = await request.json()
  if (!name?.trim()) {
    return Response.json({ error: 'name required' }, { status: 400 })
  }

  let resolvedGroupId = group_id ?? null

  if (!resolvedGroupId) {
    const today = new Date().toISOString().split('T')[0]

    // Find an existing General group for today
    const { data: existing } = await supabase
      .from('shopping_groups')
      .select('id')
      .eq('name', 'General')
      .eq('shopping_date', today)
      .eq('archived', false)
      .limit(1)
      .maybeSingle()

    if (existing) {
      resolvedGroupId = existing.id
    } else {
      // Create today's General group
      const { data: newGroup } = await supabase
        .from('shopping_groups')
        .insert({ name: 'General', shopping_date: today, archived: false })
        .select('id')
        .single()
      resolvedGroupId = newGroup?.id ?? null
    }
  }

  const { data, error } = await supabase
    .from('shopping_items')
    .insert({ name: name.trim(), quantity: quantity ?? null, group_id: resolvedGroupId, added_by: added_by ?? null, checked: false })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}
