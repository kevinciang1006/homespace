import { supabase } from '@/lib/supabase'
import { ccAuthorized } from '@/lib/cc/auth'

export async function POST(request: Request) {
  if (!ccAuthorized(request)) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { session_id, cwd, message } = await request.json()
  if (!session_id) return Response.json({ error: 'session_id required' }, { status: 400 })

  // Upsert on session_id. created_at / last_nudged_at are intentionally NOT
  // passed — a re-notification for a still-pending session keeps its original
  // clock. resolved_at cleared in case this session was resolved earlier.
  const { error } = await supabase.from('cc_pending_prompts').upsert({
    session_id,
    cwd: cwd ?? null,
    message: message ?? null,
    status: 'pending',
    resolved_at: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'session_id' })
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true })
}
