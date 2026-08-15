import { supabase } from '@/lib/supabase'
import { SLOTS } from '@/lib/meals/types'

export async function POST(request: Request) {
  const body = await request.json()
  if (!SLOTS.includes(body.slot)) {
    return Response.json({ error: 'valid slot required' }, { status: 400 })
  }
  // Name is optional for the "add then edit inline" flow; default to "Untitled".
  const name = body.name?.trim() || 'Untitled'
  const { data, error } = await supabase.from('dishes').insert({
    name, slot: body.slot,
    protein: body.protein ?? 'none', tier: body.tier ?? 'everyday',
    method: body.method ?? null, spicy: body.spicy ?? false,
    rating: body.rating ?? 3, active: body.active ?? true,
    no_repeat_days: body.no_repeat_days ?? null,
    ingredients: body.ingredients ?? [], recipe_steps: body.recipe_steps ?? [],
    recipe_image_url: body.recipe_image_url ?? null,
    saltiness: body.saltiness ?? 'normal', difficulty: body.difficulty ?? 'medium',
  }).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}
