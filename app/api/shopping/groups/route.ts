import { supabase } from '@/lib/supabase'

export async function POST(request: Request) {
  const { name, created_by } = await request.json()
  if (!name?.trim()) return Response.json({ error: 'Name required' }, { status: 400 })

  const { data, error } = await supabase
    .from('shopping_groups')
    .insert({ name: name.trim(), created_by: created_by ?? null, archived: false })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}
