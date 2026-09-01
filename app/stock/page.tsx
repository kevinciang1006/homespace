export const dynamic = 'force-dynamic'

import { supabase } from '@/lib/supabase'
import type { Ingredient } from '@/lib/meals/types'
import type { StockItem } from '@/lib/stock/types'
import { attachAvailability } from '@/lib/stock/ledger'
import StockClient from '@/components/stock/StockClient'

export default async function StockPage() {
  const [{ data: stock }, { data: ingredients }] = await Promise.all([
    supabase.from('stock').select('*, ingredients(name, category, default_unit, shelf_stable, satisfies_group)').order('location'),
    supabase.from('ingredients').select('*').order('category').order('name'),
  ])
  const withAvailability = await attachAvailability(stock ?? [])
  return (
    <StockClient
      initialStock={withAvailability as StockItem[]}
      initialIngredients={(ingredients ?? []) as Ingredient[]}
    />
  )
}
