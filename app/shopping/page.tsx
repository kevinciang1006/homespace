export const dynamic = 'force-dynamic'

import { cookies } from 'next/headers'
import { supabase, type ShoppingGroup } from '@/lib/supabase'
import ShoppingClient from '@/components/shopping/ShoppingClient'

export default async function ShoppingPage() {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('hs_session')?.value

  let currentUser: { id: string; name: string } | null = null
  if (sessionCookie) {
    try {
      const session = JSON.parse(sessionCookie)
      currentUser = { id: session.id, name: session.name }
    } catch {}
  }

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 7)
  const cutoffDate = cutoff.toISOString().split('T')[0]
  const today = new Date().toISOString().split('T')[0]

  const [{ data: groups }, { data: ungroupedItems }] = await Promise.all([
    supabase
      .from('shopping_groups')
      .select('*, shopping_items(*)')
      .gte('shopping_date', cutoffDate)
      .order('archived', { ascending: true })
      .order('shopping_date', { ascending: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('shopping_items')
      .select('*')
      .is('group_id', null),
  ])

  // Merge legacy null-group items into today's General group if present
  const generalToday = (groups ?? []).find(
    g => g.name === 'General' && g.shopping_date === today && !g.archived
  )
  const data = (groups ?? []).map(g =>
    generalToday && g.id === generalToday.id
      ? { ...g, shopping_items: [...(g.shopping_items ?? []), ...(ungroupedItems ?? [])] }
      : g
  )

  return <ShoppingClient initialGroups={(data as ShoppingGroup[]) ?? []} currentUser={currentUser} initialDays={7} />
}
