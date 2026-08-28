export type CcPendingRow = {
  session_id: string
  cwd: string | null
  message: string | null
  status: 'pending' | 'resolved'
  created_at: string
  updated_at: string
  last_nudged_at: string | null
  resolved_at: string | null
}
