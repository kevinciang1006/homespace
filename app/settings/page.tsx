export const dynamic = 'force-dynamic'

import { supabase } from '@/lib/supabase'
import WaSettingsClient from '@/components/settings/WaSettingsClient'
import type { WaSettings } from '@/lib/wa/types'

export default async function SettingsPage() {
  const { data } = await supabase.from('wa_settings').select('*').limit(1).single()
  return <WaSettingsClient initialSettings={data as WaSettings} />
}
