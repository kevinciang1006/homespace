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

  const { data } = await supabase
    .from('shopping_groups')
    .select('*, shopping_items(*)')
    .order('archived', { ascending: true })
    .order('created_at', { ascending: false })

  return <ShoppingClient initialGroups={(data as ShoppingGroup[]) ?? []} currentUser={currentUser} />
}
