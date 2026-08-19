import { supabase } from '@/lib/supabase'

export async function GET() {
  const { data, error } = await supabase.from('daily_staples').select('*').order('person')
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function POST(request: Request) {
  const body = await request.json()
  const { data, error } = await supabase.from('daily_staples').insert({
    name: body.name?.trim() || 'New staple',
    person: body.person?.trim() || '',
    frequency: body.frequency ?? 'daily',
    note: body.note ?? null,
  }).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}
