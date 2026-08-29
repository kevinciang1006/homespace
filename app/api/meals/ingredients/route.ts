import { supabase } from '@/lib/supabase'

// "Add then edit inline" flow, same convention as /api/meals/dishes: insert a
// real, deletable row immediately with placeholder defaults, then the client
// focuses it for inline editing.
export async function POST() {
  const { data, error } = await supabase.from('ingredients').insert({
    name: 'Untitled ingredient', aliases: [], category: 'other', default_unit: null, shelf_stable: false,
  }).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}
