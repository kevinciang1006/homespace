import { supabase } from '@/lib/supabase'

const CATEGORIES = ['car', 'kitchen', 'home_maint', 'outdoor', 'online', 'errand', 'other']

export async function POST(request: Request) {
  const { title, category } = await request.json()
  if (!title?.trim()) {
    return Response.json({ error: 'title required' }, { status: 400 })
  }
  const cat = CATEGORIES.includes(category) ? category : 'other'

  const { data, error } = await supabase
    .from('backlog_items')
    .insert({ title: title.trim(), category: cat, status: 'ready' })
    .select()
    .single()
  if (error) return Response.json({ error: error.message }, { status: 500 })

  await supabase.from('backlog_log').insert({ item_id: data.id, action: 'created' })
  return Response.json(data)
}
