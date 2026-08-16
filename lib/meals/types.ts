import type { DishIngredient } from './shopping'
import type { RecipeLink } from './recipeLinks'

export const SLOTS = ['utama', 'kuah', 'pelengkap', 'sayuran', 'desert'] as const
export type Slot = (typeof SLOTS)[number]

export const SLOT_LABELS: Record<Slot, string> = {
  utama: 'Utama', kuah: 'Kuah', pelengkap: 'Pelengkap', sayuran: 'Sayuran', desert: 'Desert',
}

export type Tier = 'everyday' | 'nice' | 'special'
export type Role = 'main' | 'support' | 'optional'
export type Richness = 'light' | 'medium' | 'heavy'
export type Saltiness = 'normal' | 'salty' | 'very_salty'
export type Difficulty = 'easy' | 'medium' | 'hard'

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
  ingredients: DishIngredient[] | null
  recipe_steps: string[] | null
  recipe_image_url: string | null
  richness: Richness
  provides_soup: boolean
  saltiness: Saltiness
  difficulty: Difficulty
  is_garnish: boolean
  recipe_links: RecipeLink[] | null
}

export type MealPlan = {
  id: string
  plan_date: string
  slot: Slot
  dish_id: string | null
  dish_name: string | null
  locked: boolean
  role: Role
  skipped: boolean
  dishes?: { tier: Tier; spicy: boolean; richness: Richness; provides_soup: boolean; recipe_image_url: string | null; protein: string; saltiness: Saltiness; difficulty: Difficulty; method: string | null; slot?: Slot; recipe_links?: RecipeLink[] | null } | null
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
  role: Role
  skipped: boolean
  note?: string
}
