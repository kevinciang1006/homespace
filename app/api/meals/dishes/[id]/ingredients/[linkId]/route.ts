import { supabase } from '@/lib/supabase'

// PATCH: edit this dish's amount/unit for one linked ingredient. Which
// ingredient it links to isn't editable here — swap it by deleting and
// re-adding, same as any other "wrong item picked" fix.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; linkId: string }> }) {
  const { linkId } = await params
  const body = await request.json()
  const patch: Record<string, unknown> = {}
  if ('amount' in body) patch.amount = body.amount
  if ('unit' in body) patch.unit = body.unit
  const { data, error } = await supabase.from('dish_ingredients').update(patch).eq('id', linkId)
    .select('id, dish_id, ingredient_id, amount, unit, ingredients(name, category, default_unit, shelf_stable)').single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

// DELETE: unlink this ingredient from the dish (the canonical ingredient
// row itself is untouched — it may still be used by other dishes).
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; linkId: string }> }) {
  const { linkId } = await params
  const { error } = await supabase.from('dish_ingredients').delete().eq('id', linkId)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
