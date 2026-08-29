import { supabase } from '@/lib/supabase'

// GET: this dish's ingredients, joined to the canonical ingredient for
// display (name/category/shelf_stable) — powers the dish editor's
// normalized ingredients section.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { data, error } = await supabase.from('dish_ingredients')
    .select('id, dish_id, ingredient_id, amount, unit, ingredients(name, category, default_unit, shelf_stable)')
    .eq('dish_id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

// POST: link an existing ingredient to this dish (amount/unit optional —
// null for pantry items with no fixed buy quantity, e.g. "salt to taste").
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json()
  if (!body.ingredient_id) return Response.json({ error: 'ingredient_id required' }, { status: 400 })
  const { data, error } = await supabase.from('dish_ingredients').insert({
    dish_id: id, ingredient_id: body.ingredient_id,
    amount: body.amount ?? null, unit: body.unit ?? null,
  }).select('id, dish_id, ingredient_id, amount, unit, ingredients(name, category, default_unit, shelf_stable)').single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}
