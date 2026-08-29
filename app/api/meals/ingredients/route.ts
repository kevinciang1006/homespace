import { supabase } from '@/lib/supabase'

// GET: full catalog, for the Ingredients page and the dish editor's
// ingredient-picker autocomplete (small dataset — fetch once, filter client-side).
export async function GET() {
  const { data, error } = await supabase.from('ingredients').select('*').order('category').order('name')
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

// POST: two callers share this route —
// - Ingredients page "Add ingredient": no body, "add then edit inline" flow
//   (placeholder defaults, same convention as /api/meals/dishes).
// - Dish editor "create new ingredient": body carries real values so the new
//   ingredient is usable immediately (the caller links it to the dish right after).
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const row = {
    name: (typeof body.name === 'string' && body.name.trim()) || 'Untitled ingredient',
    aliases: Array.isArray(body.aliases) ? body.aliases : [],
    category: body.category ?? 'other',
    default_unit: body.default_unit ?? null,
    shelf_stable: body.shelf_stable ?? false,
  }
  const { data, error } = await supabase.from('ingredients').insert(row).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}
