import { supabase } from '@/lib/supabase'
import type { BacklogItem } from './types'

export async function fetchReadyPool(): Promise<BacklogItem[]> {
  const { data } = await supabase.from('backlog_items').select('*').eq('status', 'ready')
  return (data ?? []) as BacklogItem[]
}

export async function fetchActiveItems(): Promise<BacklogItem[]> {
  const { data } = await supabase.from('backlog_items').select('*')
    .not('status', 'in', '(done,dropped)')
  return (data ?? []) as BacklogItem[]
}

// mutex_groups belonging to items that were suggested or done since `sinceIso`
// (today 00:00 Asia/Jakarta as a UTC instant) — those groups are off-limits today.
export async function fetchExcludedMutexGroups(sinceIso: string): Promise<string[]> {
  const { data } = await supabase.from('backlog_log')
    .select('backlog_items(mutex_group)')
    .in('action', ['suggested', 'done'])
    .gte('created_at', sinceIso)
  type Row = { backlog_items: { mutex_group: string | null } | null }
  const groups = ((data ?? []) as unknown as Row[])
    .map(r => r.backlog_items?.mutex_group)
    .filter((g): g is string => !!g)
  return [...new Set(groups)]
}

export async function markSuggested(itemId: string, nowIso: string): Promise<void> {
  await supabase.from('backlog_items').update({ last_suggested_at: nowIso }).eq('id', itemId)
  await supabase.from('backlog_log').insert({ item_id: itemId, action: 'suggested' })
}
