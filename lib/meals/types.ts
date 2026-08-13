export const SLOTS = ['utama', 'kuah', 'pelengkap', 'sayuran', 'desert'] as const
export type Slot = (typeof SLOTS)[number]

export const SLOT_LABELS: Record<Slot, string> = {
  utama: 'Utama', kuah: 'Kuah', pelengkap: 'Pelengkap', sayuran: 'Sayuran', desert: 'Desert',
}

export type Tier = 'everyday' | 'nice' | 'special'

export const DEFAULT_NO_REPEAT: Record<Slot, number> = {
  utama: 14, kuah: 7, pelengkap: 7, sayuran: 7, desert: 10,
}

export type Dish = {
  id: string
  name: string
  slot: Slot
  protein: string
  tier: Tier
  method: string | null
  spicy: boolean
  rating: number
  active: boolean
  no_repeat_days: number | null
}

export type MealPlan = {
  id: string
  plan_date: string
  slot: Slot
  dish_id: string | null
  dish_name: string | null
  locked: boolean
  dishes?: { tier: Tier; spicy: boolean } | null
}

export type MealShoppingList = {
  id: string
  week_start: string
  generated_at: string | null
  archived: boolean
}

export type MealShoppingItem = {
  id: string
  list_id: string
  ingredient: string
  quantity: string | null
  category: string // 'protein' | 'vegetable' | 'pantry' | 'other' | 'dish'
  already_have: boolean
  checked: boolean
  from_dishes: { dish: string; quantity?: string | null }[] | null
  created_at: string
}

// A pick produced by the engine before it is persisted.
export type Pick = {
  plan_date: string
  slot: Slot
  dish_id: string | null
  dish_name: string | null
  locked: boolean
  note?: string
}
