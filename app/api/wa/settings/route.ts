import { supabase } from '@/lib/supabase'
import { getOrCreateSettings } from '@/lib/wa/settings'

const FIELDS = [
  'weekly_enabled', 'weekly_time', 'weekly_cutoff_dow', 'daily_enabled', 'daily_time',
  'prep_enabled', 'prep_time', 'backlog_enabled', 'backlog_time', 'include_kevin',
  'batch_prep_enabled', 'batch_prep_time', 'batch_prep_dow', 'batch_prep_wife_enabled', 'batch_prep_kevin_enabled',
]

export async function GET() {
  const settings = await getOrCreateSettings()
  return Response.json(settings)
}

export async function PATCH(request: Request) {
  const body = await request.json()
  const patch = Object.fromEntries(Object.entries(body).filter(([k]) => FIELDS.includes(k)))
  const settings = await getOrCreateSettings()
  const { data, error } = await supabase.from('wa_settings')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', settings.id).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}
