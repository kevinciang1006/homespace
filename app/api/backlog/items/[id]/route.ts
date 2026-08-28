import { supabase } from '@/lib/supabase'
import { jakartaToday, tomorrowOf } from '@/lib/wa/schedule'

// Columns the inline tag editor is allowed to write directly.
const EDITABLE = [
  'title', 'category', 'status', 'blocked_by', 'time_of_day', 'day_pref',
  'needs_daylight', 'needs_dry', 'prep_ahead', 'lead_time_hours', 'mutex_group',
  'recurring', 'recurrence', 'deadline', 'priority', 'snooze_until', 'notes',
]

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json()

  if (typeof body.action === 'string') return handleAction(id, body.action)

  if (body.patch && typeof body.patch === 'object') {
    const patch = Object.fromEntries(
      Object.entries(body.patch).filter(([k]) => EDITABLE.includes(k)),
    )
    const { data, error } = await supabase
      .from('backlog_items').update(patch).eq('id', id).select().single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json(data)
  }

  return Response.json({ error: 'expected { action } or { patch }' }, { status: 400 })
}

async function handleAction(id: string, action: string) {
  if (action === 'done') {
    const { data, error } = await supabase.from('backlog_items')
      .update({ status: 'done', last_done_at: new Date().toISOString() })
      .eq('id', id).select().single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    await supabase.from('backlog_log').insert({ item_id: id, action: 'done' })
    return Response.json(data)
  }

  if (action === 'snooze') {
    const tomorrow = tomorrowOf(jakartaToday())
    const { data, error } = await supabase.from('backlog_items')
      .update({ snooze_until: tomorrow }) // status stays 'ready' — self-healing
      .eq('id', id).select().single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    await supabase.from('backlog_log').insert({ item_id: id, action: 'snoozed' })
    return Response.json(data)
  }

  if (action === 'arrived') {
    const { data: cur } = await supabase.from('backlog_items')
      .select('blocked_by').eq('id', id).single()
    const { data, error } = await supabase.from('backlog_items')
      .update({ status: 'ready', blocked_by: null })
      .eq('id', id).select().single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    await supabase.from('backlog_log')
      .insert({ item_id: id, action: 'unblocked', note: cur?.blocked_by ?? null })
    return Response.json(data)
  }

  return Response.json({ error: `unknown action: ${action}` }, { status: 400 })
}
