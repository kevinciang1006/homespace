import type { IngredientCategory } from '@/lib/meals/types'

// Layer 1: manual stock entry only. No reservation/auto-deplete yet — see
// stock_movements' 'reserve'/'release'/'consume' kinds, unused for now.
export const STOCK_LOCATIONS = ['freezer', 'fridge', 'pantry'] as const
export type StockLocation = (typeof STOCK_LOCATIONS)[number]

export const STOCK_MOVEMENT_KINDS = ['reserve', 'release', 'consume', 'restock', 'correction'] as const
export type StockMovementKind = (typeof STOCK_MOVEMENT_KINDS)[number]

export type StockItem = {
  id: string
  ingredient_id: string
  location: StockLocation
  on_hand: number
  unit: string | null
  low_threshold: number | null
  updated_at: string
  created_at: string
  // Joined for display — same shape as dish_ingredients' join (DishIngredientDetail).
  ingredients: { name: string; category: IngredientCategory | null; default_unit: string | null; shelf_stable: boolean } | null
}

export type StockMovement = {
  id: string
  ingredient_id: string
  kind: StockMovementKind
  amount: number
  unit: string | null
  ref_type: string | null
  ref_id: string | null
  ref_date: string | null
  note: string | null
  created_at: string
}
