export const dynamic = 'force-dynamic'

import { supabase } from '@/lib/supabase'
import type { Ingredient } from '@/lib/meals/types'
import type { StockItem } from '@/lib/stock/types'
import StockClient from '@/components/stock/StockClient'

export default async function StockPage() {
  const [{ data: stock }, { data: ingredients }] = await Promise.all([
    supabase.from('stock').select('*, ingredients(name, category, default_unit, shelf_stable)').order('location'),
    supabase.from('ingredients').select('*').order('category').order('name'),
  ])
  return (
    <StockClient
      initialStock={(stock ?? []) as StockItem[]}
      initialIngredients={(ingredients ?? []) as Ingredient[]}
    />
  )
}
