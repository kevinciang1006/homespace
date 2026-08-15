export const dynamic = 'force-dynamic'

import { supabase } from '@/lib/supabase'
import type { Dish } from '@/lib/meals/types'
import DishesClient from '@/components/meals/DishesClient'

export default async function DishesPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const { edit } = await searchParams
  const { data } = await supabase.from('dishes').select('*').order('slot').order('name')
  return <DishesClient initialDishes={(data ?? []) as Dish[]} initialEditId={edit ?? null} />
}
