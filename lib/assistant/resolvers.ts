import { supabase } from '@/lib/supabase'
import { matchByName, type MatchResult } from './match'

// Voice input names things loosely ("susu", "milk", "ikan kerapu") rather
// than by id — these turn a spoken name into the row the rest of the tool
// needs. Every lookup here fetches its whole (small, family-app-scale)
// candidate set and hands it to matchByName (lib/assistant/match.ts) for
// fuzzy, case-insensitive, either-direction matching — a plain
// `ilike '%query%'` only matches when the DB name is a substring of the
// query, which fails the instant the spoken phrase wraps the real name in
// extra words ("the waterless chicken soup dish"). None of this is new
// data logic: every lookup reads the same tables/columns the existing UI
// already reads from.

export type ResolvedIngredient = { id: string; name: string; category: string | null; default_unit: string | null; satisfies_group: string | null }

export async function resolveIngredient(name: string): Promise<MatchResult<ResolvedIngredient>> {
  const { data } = await supabase.from('ingredients').select('id, name, category, default_unit, satisfies_group, aliases')
  type Row = ResolvedIngredient & { aliases: string[] | null }
  const rows = (data ?? []) as Row[]
  // An alias hit (e.g. "susu" for an ingredient named "Milk") is as good as
  // a name hit, so match against whichever of an ingredient's names/aliases
  // is closest and score by that.
  const expanded = rows.flatMap(r => [{ row: r, label: r.name }, ...(r.aliases ?? []).map(a => ({ row: r, label: a }))])
  const matched = matchByName(name, expanded, e => e.label)
  if (matched.kind === 'one') return { kind: 'one', row: matched.row.row }
  if (matched.kind === 'many') {
    const uniqueById = [...new Map(matched.rows.map(m => [m.row.id, m.row])).values()]
    return uniqueById.length === 1 ? { kind: 'one', row: uniqueById[0] } : { kind: 'many', rows: uniqueById }
  }
  return { kind: 'none', suggestions: [...new Map(matched.suggestions.map(s => [s.row.id, s.row])).values()] }
}

export type ResolvedStockRow = {
  id: string; ingredient_id: string; location: string; on_hand: number; unit: string | null; low_threshold: number | null
  ingredient_name: string
}

// All of an ALREADY-resolved ingredient's stock rows (it can exist in more
// than one location) — a plain fetch, not a name match. Ambiguity in the
// ingredient NAME is handled one level up by resolveIngredient itself, so
// callers always resolve the ingredient first and only reach here once
// there's exactly one.
export async function stockRowsForIngredient(ing: ResolvedIngredient): Promise<ResolvedStockRow[]> {
  const { data } = await supabase.from('stock')
    .select('id, ingredient_id, location, on_hand, unit, low_threshold')
    .eq('ingredient_id', ing.id)
  type Row = { id: string; ingredient_id: string; location: string; on_hand: number; unit: string | null; low_threshold: number | null }
  return ((data ?? []) as Row[]).map(r => ({ ...r, on_hand: Number(r.on_hand), ingredient_name: ing.name }))
}

export type ResolvedDish = { id: string; name: string; slot: string }

export async function resolveDish(name: string): Promise<MatchResult<ResolvedDish>> {
  const { data } = await supabase.from('dishes').select('id, name, slot').eq('active', true)
  const rows = (data ?? []) as ResolvedDish[]
  return matchByName(name, rows, r => r.name)
}

// General (ad-hoc) shopping list item, matched by name among UNCHECKED rows
// — the ones actually still relevant to "remove the milk" / "check off eggs".
export async function resolveGeneralShoppingItem(name: string): Promise<MatchResult<{ id: string; name: string }>> {
  const { data } = await supabase.from('shopping_items').select('id, name').eq('checked', false)
  const rows = (data ?? []) as { id: string; name: string }[]
  return matchByName(name, rows, r => r.name)
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

export async function resolveMealShoppingItem(listId: string, name: string): Promise<MatchResult<{ id: string; ingredient: string }>> {
  const { data } = await supabase.from('meal_shopping_items').select('id, ingredient').eq('list_id', listId)
  const rows = (data ?? []) as { id: string; ingredient: string }[]
  return matchByName(name, rows, r => r.ingredient)
}
