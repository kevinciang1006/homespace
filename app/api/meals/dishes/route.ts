import { supabase } from '@/lib/supabase'
import { SLOTS } from '@/lib/meals/types'

export async function POST(request: Request) {
  const body = await request.json()
  if (!body.name?.trim() || !SLOTS.includes(body.slot)) {
    return Response.json({ error: 'name and valid slot required' }, { status: 400 })
  }
  const { data, error } = await supabase.from('dishes').insert({
    name: body.name.trim(), slot: body.slot,
    protein: body.protein ?? 'none', tier: body.tier ?? 'everyday',
    method: body.method ?? null, spicy: body.spicy ?? false,
    rating: body.rating ?? 3, active: body.active ?? true,
    no_repeat_days: body.no_repeat_days ?? null,
  }).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}
