export const dynamic = 'force-dynamic'

import { supabase } from '@/lib/supabase'
import type { Ingredient } from '@/lib/meals/types'
import IngredientsClient from '@/components/meals/IngredientsClient'

export default async function IngredientsPage() {
  const { data } = await supabase.from('ingredients').select('*').order('category').order('name')
  return <IngredientsClient initialIngredients={(data ?? []) as Ingredient[]} />
}
