// Shared shopping-list DISPLAY grouping — used by both the WhatsApp message
// (lib/wa/messages.ts) and the app's shopping page (ShoppingListClient) so
// the two stay visually consistent. Deliberately finer than the stored
// ShopCategory (protein/vegetable/bumbu/pantry/other/dish): "aromatics"
// (chilies, garlic, ginger, scallion, celery, tomato, lime) read to a home
// cook as bumbu even though they're stored as category='veg' (they're
// fresh, not a packet), and fruit needs splitting out of the generic
// "dishes with no ingredients" bucket. Classified by ingredient NAME so it
// works regardless of whether the item came from a live dish_ingredients
// join, a persisted list, or the raw shop_ingredients fallback.
export type ShoppingGroup = 'protein' | 'veg_main' | 'bumbu_packet' | 'bumbu_aromatic' | 'fruit' | 'lainnya'

export const SHOPPING_GROUP_RANK: Record<ShoppingGroup, number> = {
  protein: 0, veg_main: 1, bumbu_packet: 2, bumbu_aromatic: 3, fruit: 4, lainnya: 5,
}

// bumbu_packet and bumbu_aromatic render under one shared "Bumbu" section
// (packets first, then aromatics) — this is the section a group belongs to.
export type ShoppingSection = 'protein' | 'veg_main' | 'bumbu' | 'fruit' | 'lainnya'
export function sectionOf(group: ShoppingGroup): ShoppingSection {
  return group === 'bumbu_packet' || group === 'bumbu_aromatic' ? 'bumbu' : group
}

export const SHOPPING_SECTION_EMOJI: Record<ShoppingSection, string> = {
  protein: '🥩', veg_main: '🥦', bumbu: '🧂', fruit: '🍎', lainnya: '🛍️',
}
export const SHOPPING_SECTION_LABEL: Record<ShoppingSection, string> = {
  protein: 'Protein', veg_main: 'Sayur', bumbu: 'Bumbu', fruit: 'Buah', lainnya: 'Lainnya',
}

// Visible order — 'lainnya' is deliberately last and typically filtered out
// entirely by callers (both the WA message and the app's shopping page).
export const SHOPPING_SECTION_ORDER: ShoppingSection[] = ['protein', 'veg_main', 'bumbu', 'fruit', 'lainnya']

const AROMATIC_NAMES = new Set([
  'Cabai Rawit', 'Cabai Hijau', 'Cabai Merah Besar', 'Cabai Merah Keriting', 'Cabai Kering',
  'Bawang Putih', 'Jahe', 'Daun Bawang', 'Daun Bawang Prei', 'Seledri', 'Tomat', 'Tomat Hijau',
  'Jeruk Nipis', 'Jeruk Limau',
])
const FRUIT_KEYWORDS = [
  'apple', 'banana', 'pisang', 'jeruk', 'orange', 'pear', 'pepaya', 'papaya', 'semangka',
  'watermelon', 'mangga', 'mango', 'anggur', 'grape', 'nanas', 'pineapple', 'alpukat',
  'avocado', 'guava', 'jambu',
]

export function classifyShoppingGroup(ingredient: string, category: string): ShoppingGroup {
  const cat = category.trim().toLowerCase()
  if (cat === 'dish') {
    const lower = ingredient.toLowerCase()
    return FRUIT_KEYWORDS.some(k => lower.includes(k)) ? 'fruit' : 'lainnya'
  }
  if (cat === 'protein') return 'protein'
  if (cat === 'bumbu') return 'bumbu_packet'
  if (AROMATIC_NAMES.has(ingredient)) return 'bumbu_aromatic'
  if (cat === 'vegetable' || cat === 'veg') return 'veg_main'
  return 'lainnya'
}

// Secondary sort key WITHIN a section, so a long shopping list doesn't force
// backtracking across the store — e.g. seeing "Cumi-Cumi" near the top of
// Protein and "Udang" near the bottom (alphabetical, with Tahu in between)
// means walking back to the seafood counter after already leaving it.
// Keyword-based on the ingredient NAME (not a fixed ingredient list) so a
// new item like "Ceker Ayam" or "Ikan Tongkol" clusters correctly without a
// code change. Only 'protein' has sub-families today; every other section
// ranks 0, leaving its existing alphabetical order untouched.
type ProteinFamily = 'chicken' | 'pork' | 'seafood' | 'egg' | 'soy' | 'other'
const PROTEIN_FAMILY_RANK: Record<ProteinFamily, number> = {
  chicken: 0, pork: 1, seafood: 2, egg: 3, soy: 4, other: 5,
}
const SEAFOOD_KEYWORDS = ['ikan', 'udang', 'cumi', 'kepiting', 'kepah', 'ebi']

function proteinFamily(name: string): ProteinFamily {
  const n = name.toLowerCase()
  if (n.includes('ayam')) return 'chicken'
  if (n.includes('babi')) return 'pork'
  if (n.includes('telur')) return 'egg'
  if (n.includes('tahu') || n.includes('tempe')) return 'soy'
  if (SEAFOOD_KEYWORDS.some(k => n.includes(k))) return 'seafood'
  return 'other'
}

export function shoppingSubRank(section: ShoppingSection, ingredient: string): number {
  return section === 'protein' ? PROTEIN_FAMILY_RANK[proteinFamily(ingredient)] : 0
}
