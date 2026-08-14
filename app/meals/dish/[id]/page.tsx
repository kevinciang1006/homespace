export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type { Dish } from '@/lib/meals/types'
import RecipeClient from '@/components/meals/RecipeClient'

export default async function DishRecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { data } = await supabase.from('dishes').select('*').eq('id', id).maybeSingle()
  if (!data) {
    return (
      <div className="text-center py-16">
        <p className="text-stone-500">Dish not found.</p>
        <Link href="/meals" className="text-orange-600 hover:text-orange-700 text-sm mt-2 inline-block">← Back to plan</Link>
      </div>
    )
  }
  return <RecipeClient dish={data as Dish} />
}
