export const dynamic = 'force-dynamic'
export const revalidate = 0

import { supabase } from '@/lib/supabase'
import type { BacklogItem } from '@/lib/backlog/types'
import BacklogClient from '@/components/backlog/BacklogClient'

export default async function BacklogPage() {
  const { data } = await supabase
    .from('backlog_items')
    .select('*')
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
  return <BacklogClient initialItems={(data ?? []) as BacklogItem[]} />
}
