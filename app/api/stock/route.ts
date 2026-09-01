import { supabase } from '@/lib/supabase'
import { attachAvailability } from '@/lib/stock/ledger'

const SELECT = '*, ingredients(name, category, default_unit, shelf_stable, satisfies_group)'
const today = () => new Date().toISOString().slice(0, 10)

// GET: the whole stock table, joined for display — small dataset (one row
// per ingredient per location), fetch once like /api/meals/ingredients.
// Layer 2 adds `reserved`/`available` per row via attachAvailability — see
// that function for what those mean for a group (satisfies_group) ingredient.
export async function GET() {
  const { data, error } = await supabase.from('stock').select(SELECT).order('location')
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(await attachAvailability(data ?? []))
}

// POST: add a new stock item (an ingredient newly tracked in a location).
// Always an insert, never a delta-merge — the client excludes ingredients
// already stocked in the target location from its search, so "add" only
// ever means "first time this ingredient is tracked here." Logs the
// opening 'restock' movement so history exists from day one.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const { ingredient_id, location, unit } = body
  const on_hand = Number(body.on_hand)
  const low_threshold = body.low_threshold === null || body.low_threshold === undefined || body.low_threshold === ''
    ? null : Number(body.low_threshold)
  if (!ingredient_id || !location || !Number.isFinite(on_hand)) {
    return Response.json({ error: 'ingredient_id, location, on_hand required' }, { status: 400 })
  }

  const { data, error } = await supabase.from('stock')
    .insert({ ingredient_id, location, on_hand, unit: unit || null, low_threshold })
    .select(SELECT).single()
  if (error) return Response.json({ error: error.message }, { status: 500 })

  if (on_hand > 0) {
    await supabase.from('stock_movements').insert({
      ingredient_id, kind: 'restock', amount: on_hand, unit: unit || null,
      ref_type: 'manual', ref_date: today(), note: 'manual',
    })
  }
  const [withAvailability] = await attachAvailability([data])
  return Response.json(withAvailability)
}
