import { supabase } from '@/lib/supabase'

// Merge two canonical ingredients into one: repoint dish_ingredients from the
// dupe to the survivor, union their aliases (plus the dupe's own name, so it
// still matches if it ever resurfaces from a re-run of the migration
// script), then delete the dupe.
export async function POST(request: Request) {
  const { keepId, mergeId } = await request.json()
  if (!keepId || !mergeId || keepId === mergeId) {
    return Response.json({ error: 'keepId and mergeId (different ids) required' }, { status: 400 })
  }

  const [{ data: keep, error: keepErr }, { data: merge, error: mergeErr }] = await Promise.all([
    supabase.from('ingredients').select('*').eq('id', keepId).single(),
    supabase.from('ingredients').select('*').eq('id', mergeId).single(),
  ])
  if (keepErr || !keep) return Response.json({ error: keepErr?.message ?? 'keep ingredient not found' }, { status: 404 })
  if (mergeErr || !merge) return Response.json({ error: mergeErr?.message ?? 'merge ingredient not found' }, { status: 404 })

  // A dish might already link to both (rare) — repoint what we can, drop the
  // dupe's row where the survivor is already linked to avoid a duplicate
  // (dish_id, ingredient_id) pair.
  const [{ data: dupeLinks }, { data: keepLinks }] = await Promise.all([
    supabase.from('dish_ingredients').select('id, dish_id').eq('ingredient_id', mergeId),
    supabase.from('dish_ingredients').select('dish_id').eq('ingredient_id', keepId),
  ])
  const keepDishIds = new Set((keepLinks ?? []).map(l => l.dish_id))
  const toRepoint = (dupeLinks ?? []).filter(l => !keepDishIds.has(l.dish_id)).map(l => l.id)
  const toDrop = (dupeLinks ?? []).filter(l => keepDishIds.has(l.dish_id)).map(l => l.id)

  if (toRepoint.length) {
    const { error } = await supabase.from('dish_ingredients').update({ ingredient_id: keepId }).in('id', toRepoint)
    if (error) return Response.json({ error: error.message }, { status: 500 })
  }
  if (toDrop.length) {
    const { error } = await supabase.from('dish_ingredients').delete().in('id', toDrop)
    if (error) return Response.json({ error: error.message }, { status: 500 })
  }

  const mergedAliases = Array.from(new Set([...(keep.aliases ?? []), ...(merge.aliases ?? []), merge.name]))
  const { data: updated, error: updErr } = await supabase.from('ingredients')
    .update({ aliases: mergedAliases }).eq('id', keepId).select().single()
  if (updErr) return Response.json({ error: updErr.message }, { status: 500 })

  const { error: delErr } = await supabase.from('ingredients').delete().eq('id', mergeId)
  if (delErr) return Response.json({ error: delErr.message }, { status: 500 })

  return Response.json(updated)
}
