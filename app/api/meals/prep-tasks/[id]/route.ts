import { supabase } from '@/lib/supabase'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json()
  if (typeof body.done !== 'boolean') {
    return Response.json({ error: 'done (boolean) required' }, { status: 400 })
  }
  const { data, error } = await supabase.from('prep_tasks')
    .update({ done: body.done, done_at: body.done ? new Date().toISOString() : null })
    .eq('id', id).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}
