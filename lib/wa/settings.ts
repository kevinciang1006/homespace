import { supabase } from '@/lib/supabase'
import type { WaSettings } from './types'

const DEFAULTS = {
  weekly_enabled: true, weekly_time: '09:00', weekly_cutoff_dow: 4,
  daily_enabled: true, daily_time: '17:30',
  prep_enabled: true, prep_time: '19:30',
  backlog_enabled: true, backlog_time: '19:30',
  include_kevin: false,
  batch_prep_enabled: true, batch_prep_time: '15:00', batch_prep_dow: 5, // Sat=5
  batch_prep_wife_enabled: true, batch_prep_kevin_enabled: true,
}

// The app operates on a single settings row. The migration seeds one, but
// this is a safety net in case it's ever missing.
export async function getOrCreateSettings(): Promise<WaSettings> {
  const { data } = await supabase.from('wa_settings').select('*').limit(1).maybeSingle()
  if (data) return data as WaSettings
  const { data: inserted, error } = await supabase.from('wa_settings').insert(DEFAULTS).select().single()
  if (error || !inserted) throw new Error(error?.message ?? 'failed to create wa_settings row')
  return inserted as WaSettings
}
