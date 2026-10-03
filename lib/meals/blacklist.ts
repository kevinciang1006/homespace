import { supabase } from '@/lib/supabase'
import type { Dish } from '@/lib/meals/types'

// Pure: drop dishes that use a blacklisted ingredient (via dish_ingredients
// links) or whose free-text `protein` matches a blacklisted name/alias
// (covers dishes that have no ingredient links yet).
export function filterBlacklisted(
  dishes: Dish[],
  blacklisted: { id: string; name: string; aliases: string[] | null }[],
  links: { dish_id: string; ingredient_id: string }[],
): Dish[] {
  if (blacklisted.length === 0) return dishes
  const ids = new Set(blacklisted.map(i => i.id))
  const terms = blacklisted.flatMap(i => [i.name, ...(i.aliases ?? [])])
    .map(t => t.trim().toLowerCase()).filter(Boolean)
  const blockedDishIds = new Set(links.filter(l => ids.has(l.ingredient_id)).map(l => l.dish_id))
  return dishes.filter(d => {
    if (blockedDishIds.has(d.id)) return false
    const protein = (d.protein ?? '').toLowerCase()
    return !protein || !terms.some(t => protein.includes(t))
  })
}

// Active dishes minus anything touching a blacklisted ingredient.
export async function loadAllowedDishes(): Promise<Dish[]> {
  const [{ data: dishesRaw }, { data: bl }] = await Promise.all([
    supabase.from('dishes').select('*').eq('active', true),
    supabase.from('ingredients').select('id, name, aliases').eq('blacklisted', true),
  ])
  const dishes = (dishesRaw ?? []) as Dish[]
  const blacklisted = (bl ?? []) as { id: string; name: string; aliases: string[] | null }[]
  if (blacklisted.length === 0) return dishes
  const { data: links } = await supabase.from('dish_ingredients').select('dish_id, ingredient_id')
    .in('ingredient_id', blacklisted.map(i => i.id))
  return filterBlacklisted(dishes, blacklisted, (links ?? []) as { dish_id: string; ingredient_id: string }[])
}
