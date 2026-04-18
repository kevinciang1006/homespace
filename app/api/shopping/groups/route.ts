import { supabase } from '@/lib/supabase'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const days = searchParams.get('days') ?? '7'

  let query = supabase
    .from('shopping_groups')
    .select('*, shopping_items(*)')
    .order('archived', { ascending: true })
    .order('shopping_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (days !== 'all') {
    const n = parseInt(days, 10)
    if (!isNaN(n)) {
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - n)
      query = query.gte('shopping_date', cutoff.toISOString().split('T')[0])
    }
  }

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function POST(request: Request) {
  const { name, created_by, shopping_date } = await request.json()
  if (!name?.trim()) return Response.json({ error: 'Name required' }, { status: 400 })

  const today = new Date().toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('shopping_groups')
    .insert({ name: name.trim(), created_by: created_by ?? null, archived: false, shopping_date: shopping_date ?? today })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}
