export const dynamic = 'force-dynamic'

import { supabase } from '@/lib/supabase'
import { currentMonday, mondayOf } from '@/lib/meals/dates'
import type { PrepTask } from '@/lib/meals/types'
import PrepPageClient from '@/components/meals/PrepPageClient'

export default async function PrepPage({ searchParams }: { searchParams: Promise<{ week?: string; who?: string }> }) {
  const { week, who } = await searchParams
  const weekStart = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? mondayOf(week) : currentMonday()

  const { data } = await supabase.from('prep_tasks').select('*')
    .eq('week_start', weekStart).eq('prep_category', 'batch_prep')
    .order('cook_date', { ascending: true }).order('created_at', { ascending: true })

  const initialWho = who === 'wife' ? 'Wife' : who === 'kevin' ? 'Kevin' : null

  return (
    <PrepPageClient
      initialWeekStart={weekStart}
      initialTasks={(data ?? []) as PrepTask[]}
      initialWho={initialWho}
    />
  )
}
