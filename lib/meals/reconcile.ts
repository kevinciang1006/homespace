import { supabase } from '@/lib/supabase'
import { staleSoupRowIds } from './engine'
import type { MealPlan } from './types'

// One-time consistency fix applied on load: a provides_soup main must never share its day
// with a separate soup dish. Any stale, non-locked soup row is blanked to the broth note
// (the freed slot becomes a proper second vegetable the next time the day's main is
// (re)composed). Only writes when something is actually inconsistent. Returns the corrected
// rows so the caller can render the fixed state immediately.
export async function reconcileSoup(rows: MealPlan[]): Promise<MealPlan[]> {
  const ids = staleSoupRowIds(rows)
  if (ids.length === 0) return rows
  await supabase.from('meal_plans')
    .update({ dish_id: null, dish_name: null, skipped: true, role: 'support' })
    .in('id', ids)
  const stale = new Set(ids)
  return rows.map(r => stale.has(r.id)
    ? { ...r, dish_id: null, dish_name: null, skipped: true, role: 'support', dishes: null }
    : r)
}
