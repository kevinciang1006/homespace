import { supabase } from '@/lib/supabase'
import { ccAuthorized } from '@/lib/cc/auth'

export async function POST(request: Request) {
  if (!ccAuthorized(request)) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { session_id } = await request.json()
  if (!session_id) return Response.json({ error: 'session_id required' }, { status: 400 })

  const nowIso = new Date().toISOString()
  const { error } = await supabase.from('cc_pending_prompts')
    .update({ status: 'resolved', resolved_at: nowIso, updated_at: nowIso })
    .eq('session_id', session_id).eq('status', 'pending')
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true }) // idempotent — ok even if no row matched
}
