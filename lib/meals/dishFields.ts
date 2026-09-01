import type { Slot, Tier } from './types'

// Shared vocabulary for every dish-editing surface (the Dishes table and
// DishEditorPanel) — pulled out to one place so both stay in sync instead
// of maintaining two copies of the same option lists.

// Breakfast is hidden from the Dishes catalog per request — not deleted,
// the API still handles slot: 'breakfast' fine (Randomize breakfast on the
// Plan page still works against the real breakfast dishes), it's just not
// a group you can filter to, add into, or reassign a dish to from here.
export const VISIBLE_SLOTS: Slot[] = ['utama', 'kuah', 'pelengkap', 'sayuran', 'fruit', 'desert']

export const PROTEINS = ['fish', 'chicken', 'pork', 'beef', 'shrimp', 'squid', 'crab', 'duck', 'egg', 'tofu_tempe', 'none', 'mixed']
export const TIERS: Tier[] = ['everyday', 'nice', 'special']
export const METHODS = ['', 'fried', 'boiled', 'grilled', 'steamed', 'sauteed', 'braised', 'raw', 'baked', 'soup']
export const SALTINESS: { value: string; label: string }[] = [
  { value: 'normal', label: 'normal' }, { value: 'salty', label: 'salty' }, { value: 'very_salty', label: 'very salty' },
]
export const DIFFICULTY = ['easy', 'medium', 'hard'] as const
export const FRUIT_CONTEXTS = ['', 'breakfast', 'dessert', 'any']
export const CADENCES = ['', 'daily_staple', 'weekly', 'monthly', 'occasional']
export const PRODUCE_ROLES_BY_SLOT: Record<string, string[]> = {
  fruit: ['', 'breakfast_fruit', 'evening_fruit'],
  desert: ['', 'dessert_batch', 'dessert_cake'],
}
export const PREP_TYPES = ['', 'thaw', 'marinate', 'cook_overnight', 'cut', 'portion', 'thaw_marinate']
export const VEG_STYLES = ['', 'dry', 'wet']
export const DIFF_LEVEL: Record<string, number> = { easy: 1, medium: 2, hard: 3 }
export const DIFF_COLOR: Record<string, string> = { easy: 'bg-green-400', medium: 'bg-amber-400', hard: 'bg-red-400' }
