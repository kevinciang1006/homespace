import { supabase } from '@/lib/supabase'

// Voice input names things loosely ("susu", "milk", "ikan kerapu") rather
// than by id — these turn a spoken name into the row the rest of the tool
// needs, favoring an exact (case-insensitive) match and falling back to the
// first partial match. None of this is new data logic: every lookup reads
// the same tables/columns the existing UI already reads from.

export type ResolvedIngredient = { id: string; name: string; category: string | null; default_unit: string | null; satisfies_group: string | null }

export async function resolveIngredient(name: string): Promise<ResolvedIngredient | null> {
  const q = name.trim()
  if (!q) return null
  const { data } = await supabase.from('ingredients')
    .select('id, name, category, default_unit, satisfies_group, aliases')
    .or(`name.ilike.%${q}%`)
    .limit(10)
  const rows = (data ?? []) as (ResolvedIngredient & { aliases: string[] | null })[]
  const exact = rows.find(r => r.name.toLowerCase() === q.toLowerCase())
  const aliasHit = rows.find(r => (r.aliases ?? []).some(a => a.toLowerCase() === q.toLowerCase()))
  return exact ?? aliasHit ?? rows[0] ?? null
}

export type ResolvedStockRow = {
  id: string; ingredient_id: string; location: string; on_hand: number; unit: string | null; low_threshold: number | null
  ingredient_name: string
}

// All of an ingredient's stock rows (it can exist in more than one
// location) — callers pick the one they need (e.g. largest on_hand for a
// generic "set the amount" request without a named location).
export async function resolveStockRows(ingredientName: string): Promise<ResolvedStockRow[]> {
  const ing = await resolveIngredient(ingredientName)
  if (!ing) return []
  const { data } = await supabase.from('stock')
    .select('id, ingredient_id, location, on_hand, unit, low_threshold, ingredients(name)')
    .eq('ingredient_id', ing.id)
  type Row = { id: string; ingredient_id: string; location: string; on_hand: number; unit: string | null; low_threshold: number | null; ingredients: { name: string } | { name: string }[] | null }
  return ((data ?? []) as Row[]).map(r => {
    const joined = Array.isArray(r.ingredients) ? r.ingredients[0] : r.ingredients
    return { id: r.id, ingredient_id: r.ingredient_id, location: r.location, on_hand: Number(r.on_hand), unit: r.unit, low_threshold: r.low_threshold, ingredient_name: joined?.name ?? ing.name }
  })
}

export type ResolvedDish = { id: string; name: string; slot: string }

export async function resolveDish(name: string): Promise<ResolvedDish | null> {
  const q = name.trim()
  if (!q) return null
  const { data } = await supabase.from('dishes').select('id, name, slot').ilike('name', `%${q}%`).eq('active', true).limit(10)
  const rows = (data ?? []) as ResolvedDish[]
  const exact = rows.find(r => r.name.toLowerCase() === q.toLowerCase())
  return exact ?? rows[0] ?? null
}

// General (ad-hoc) shopping list item, matched by name among UNCHECKED rows
// — the ones actually still relevant to "remove the milk" / "check off eggs".
export async function resolveGeneralShoppingItem(name: string): Promise<{ id: string; name: string } | null> {
  const q = name.trim()
  if (!q) return null
  const { data } = await supabase.from('shopping_items').select('id, name').eq('checked', false).ilike('name', `%${q}%`).limit(10)
  const rows = (data ?? []) as { id: string; name: string }[]
  const exact = rows.find(r => r.name.toLowerCase() === q.toLowerCase())
  return exact ?? rows[0] ?? null
}

// This week's meal-plan shopping list id, creating it (via the SAME
// generate route the Shopping page itself calls on load) if it doesn't
// exist yet — never a raw insert into meal_shopping_lists here.
export async function getOrCreateMealShoppingListId(origin: string, cookie: string | null, weekStart: string): Promise<string | null> {
  const existing = await fetch(`${origin}/api/meals/shopping?weekStart=${weekStart}`, { headers: cookie ? { cookie } : undefined })
  const existingJson = await existing.json().catch(() => ({}))
  if (existingJson.list?.id) return existingJson.list.id as string

  const generated = await fetch(`${origin}/api/meals/shopping/generate`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ weekStart }),
  })
  const generatedJson = await generated.json().catch(() => ({}))
  return generatedJson.list?.id ?? null
}

export async function resolveMealShoppingItem(listId: string, name: string): Promise<{ id: string; ingredient: string } | null> {
  const q = name.trim()
  if (!q) return null
  const { data } = await supabase.from('meal_shopping_items').select('id, ingredient').eq('list_id', listId).ilike('ingredient', `%${q}%`).limit(10)
  const rows = (data ?? []) as { id: string; ingredient: string }[]
  const exact = rows.find(r => r.ingredient.toLowerCase() === q.toLowerCase())
  return exact ?? rows[0] ?? null
}
