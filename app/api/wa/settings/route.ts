import { supabase } from '@/lib/supabase'
import { getOrCreateSettings } from '@/lib/wa/settings'

const FIELDS = [
  'weekly_enabled', 'weekly_time', 'daily_enabled', 'daily_time',
  'prep_enabled', 'prep_time', 'include_kevin',
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
