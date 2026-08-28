import { supabase } from '@/lib/supabase'
import { sendWhatsapp } from '@/lib/wa/relay'
import { WA_NUMBERS } from '@/lib/wa/config'
import { composeHangNudge } from './message'
import type { CcPendingRow } from './types'

const GRACE_MIN = 10
const SPACING_MIN = 15
const GIVEUP_HOURS = 3
const PRUNE_HOURS = 24

// Selects pending rows past the grace period that haven't been nudged recently,
// sends one WhatsApp each, then lazily prunes stale rows.
export async function runCcCheck(now: Date = new Date()): Promise<{ nudged: number; skipped: number }> {
  const graceIso = new Date(now.getTime() - GRACE_MIN * 60_000).toISOString()
  const giveupIso = new Date(now.getTime() - GIVEUP_HOURS * 3_600_000).toISOString()
  const spacingIso = new Date(now.getTime() - SPACING_MIN * 60_000).toISOString()

  const { data } = await supabase.from('cc_pending_prompts').select('*')
    .eq('status', 'pending')
    .lt('created_at', graceIso)
    .gt('created_at', giveupIso)

  // Filter the 15-min spacing in JS (tiny table; avoids PostgREST timestamp
  // quoting in .or()). ISO strings compare lexicographically.
  const rows = ((data ?? []) as CcPendingRow[])
    .filter(r => !r.last_nudged_at || r.last_nudged_at < spacingIso)

  let nudged = 0, skipped = 0
  for (const row of rows) {
    const res = await sendWhatsapp(WA_NUMBERS.kevin, composeHangNudge(row.cwd, row.message))
    if (res.ok) {
      await supabase.from('cc_pending_prompts')
        .update({ last_nudged_at: now.toISOString() }).eq('session_id', row.session_id)
      nudged++
    } else {
      skipped++
    }
  }

  // Lazy prune: resolved rows and abandoned-pending rows older than a day.
  const pruneIso = new Date(now.getTime() - PRUNE_HOURS * 3_600_000).toISOString()
  await supabase.from('cc_pending_prompts').delete().eq('status', 'resolved').lt('updated_at', pruneIso)
  await supabase.from('cc_pending_prompts').delete().eq('status', 'pending').lt('created_at', pruneIso)

  return { nudged, skipped }
}
