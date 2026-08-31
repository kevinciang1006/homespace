import { supabase } from '@/lib/supabase'

// Free-pick dish search backing the per-slot "change" picker — lets her find
// ANY active dish by name and set it directly, independent of the reroll
// engine's algorithm-suggested alternatives. `slots` (comma-separated)
// scopes the pool: the main slot's picker passes 'utama' only, while the
// three supporting slots (kuah/sayuran/pelengkap) pass all three so soup,
// veg, and dish-helpers are interchangeably searchable from any of them.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const q = url.searchParams.get('q')?.trim() ?? ''
  const slotsParam = url.searchParams.get('slots')?.trim()
  if (q.length < 1) return Response.json({ dishes: [] })

  let query = supabase.from('dishes').select('id, name, slot')
    .eq('active', true).ilike('name', `%${q}%`).order('name').limit(20)
  if (slotsParam) query = query.in('slot', slotsParam.split(','))
  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ dishes: data ?? [] })
}
