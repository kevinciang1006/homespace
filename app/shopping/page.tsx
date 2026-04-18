export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { supabase, type ShoppingItem } from '@/lib/supabase'
import ShoppingClient from '@/components/shopping/ShoppingClient'

export default async function ShoppingPage() {
  const { data } = await supabase
    .from('shopping_items')
    .select('*')
    .order('checked', { ascending: true })
    .order('id', { ascending: false })

  const items = (data as ShoppingItem[]) ?? []

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="bg-white border-b border-stone-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link href="/" className="text-stone-400 hover:text-stone-600 transition-colors">
            <ArrowLeft size={18} />
          </Link>
          <h1 className="text-xl font-semibold text-stone-900" style={{ fontFamily: 'DM Serif Display, serif' }}>
            Shopping
          </h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8">
        <ShoppingClient initialItems={items} />
      </main>
    </div>
  )
}
