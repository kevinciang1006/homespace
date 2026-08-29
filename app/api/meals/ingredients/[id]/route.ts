import { supabase } from '@/lib/supabase'

const FIELDS = ['name', 'aliases', 'category', 'default_unit', 'shelf_stable']

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json()
  const patch = Object.fromEntries(Object.entries(body).filter(([k]) => FIELDS.includes(k)))
  const { data, error } = await supabase.from('ingredients').update(patch).eq('id', id).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // Drop any dish_ingredients links first — the shopping list just loses that
  // line for those dishes, same "detach, don't block" pattern as deleting a
  // dish (which nulls out meal_plans.dish_id instead of failing).
  const { error: diErr } = await supabase.from('dish_ingredients').delete().eq('ingredient_id', id)
  if (diErr) return Response.json({ error: diErr.message }, { status: 500 })
  const { error } = await supabase.from('ingredients').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
