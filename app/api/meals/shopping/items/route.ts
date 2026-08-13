import { supabase } from '@/lib/supabase'

const CATEGORIES = ['protein', 'vegetable', 'pantry', 'other']

export async function POST(request: Request) {
  const body = await request.json()
  if (!body.list_id || !body.ingredient?.trim()) {
    return Response.json({ error: 'list_id and ingredient required' }, { status: 400 })
  }
  const category = CATEGORIES.includes(body.category) ? body.category : 'other'
  const { data, error } = await supabase.from('meal_shopping_items').insert({
    list_id: body.list_id, ingredient: body.ingredient.trim(),
    quantity: body.quantity?.trim() || null, category,
    already_have: false, checked: false, from_dishes: null,
  }).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}
