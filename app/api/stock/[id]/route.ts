import { supabase } from '@/lib/supabase'

const SELECT = '*, ingredients(name, category, default_unit, shelf_stable)'
const today = () => new Date().toISOString().slice(0, 10)

// PATCH: inline edit (on_hand, unit, low_threshold, and/or location — e.g.
// she put something in the wrong tab and wants to move it, not delete and
// re-add it). An on_hand change always logs a stock_movement — 'restock'
// when it went up (she topped it up), 'correction' when it went down
// (fixing a miscount; there's no consume/reserve flow yet in this layer).
// Amount is the signed delta so a future layer can just sum movements to
// reconcile on_hand. Editing unit/low_threshold/location alone logs
// nothing — a location move isn't a quantity change either.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json().catch(() => ({}))

  const { data: existing, error: fetchErr } = await supabase.from('stock').select('*').eq('id', id).single()
  if (fetchErr || !existing) return Response.json({ error: fetchErr?.message ?? 'not found' }, { status: 404 })

  const patch: Record<string, unknown> = {}
  if (body.unit !== undefined) patch.unit = body.unit || null
  if (body.location !== undefined) patch.location = body.location
  if (body.low_threshold !== undefined) {
    patch.low_threshold = body.low_threshold === null || body.low_threshold === '' ? null : Number(body.low_threshold)
  }
  let nextOnHand: number | null = null
  if (body.on_hand !== undefined) {
    nextOnHand = Number(body.on_hand)
    if (!Number.isFinite(nextOnHand)) return Response.json({ error: 'invalid on_hand' }, { status: 400 })
    patch.on_hand = nextOnHand
  }

  const { data, error } = await supabase.from('stock').update(patch).eq('id', id).select(SELECT).single()
  if (error) {
    // Moving to a location that already tracks this ingredient hits the
    // (ingredient_id, location) unique constraint — surface that plainly
    // instead of a generic 500, so the client can tell her to edit the
    // existing entry there instead of creating a duplicate.
    if (error.code === '23505') {
      return Response.json({ error: 'That ingredient is already tracked in that location — edit the existing entry there instead.' }, { status: 409 })
    }
    return Response.json({ error: error.message }, { status: 500 })
  }

  const delta = nextOnHand === null ? 0 : nextOnHand - Number(existing.on_hand)
  if (delta !== 0) {
    const unit = (body.unit !== undefined ? body.unit : existing.unit) || null
    await supabase.from('stock_movements').insert({
      ingredient_id: existing.ingredient_id, kind: delta > 0 ? 'restock' : 'correction', amount: delta,
      unit, ref_type: 'manual', ref_date: today(), note: 'manual',
    })
  }
  return Response.json(data)
}

// DELETE: removing a tracked item is itself a correction down to zero —
// logged before the row goes away so the ledger's arc for this ingredient
// stays complete even though the stock row won't exist to look up anymore.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { data: existing } = await supabase.from('stock').select('*').eq('id', id).single()
  const { error } = await supabase.from('stock').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  if (existing && Number(existing.on_hand) !== 0) {
    await supabase.from('stock_movements').insert({
      ingredient_id: existing.ingredient_id, kind: 'correction', amount: -Number(existing.on_hand),
      unit: existing.unit, ref_type: 'manual', ref_date: today(), note: 'manual (item removed)',
    })
  }
  return Response.json({ ok: true })
}
