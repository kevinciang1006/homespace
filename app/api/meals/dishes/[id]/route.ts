import { supabase } from '@/lib/supabase'

const FIELDS = ['name', 'slot', 'protein', 'tier', 'method', 'spicy', 'rating', 'active', 'no_repeat_days', 'ingredients', 'recipe_steps', 'recipe_image_url', 'saltiness', 'difficulty', 'is_garnish', 'provides_soup', 'recipe_links', 'qty_amount', 'qty_unit', 'qty_note', 'fruit_context', 'cadence', 'produce_role', 'prep_type', 'is_dish_helper', 'veg_style', 'base_key', 'self_sufficient_main']

// Full dish record — used by the meal-plan page to populate DishEditorPanel
// (the same edit drawer the Dishes tab uses) without navigating away.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { data, error } = await supabase.from('dishes').select('*').eq('id', id).maybeSingle()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data) return Response.json({ error: 'dish not found' }, { status: 404 })
  return Response.json(data)
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json()
  const patch = Object.fromEntries(Object.entries(body).filter(([k]) => FIELDS.includes(k)))
  const { data, error } = await supabase.from('dishes').update(patch).eq('id', id).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })

  // meal_plans.dish_name is a denormalized copy (read directly, not joined,
  // by /api/meals/week and everything downstream of it) — a rename has to
  // propagate there too, or the old name silently comes back on next load.
  // Historical tables that also copy the name at write time (cook_log,
  // prep_tasks, thaw_reminders, dessert_week_items) are left alone on
  // purpose: those are point-in-time records of what a dish was called
  // when the entry was made, not the current plan.
  if (typeof patch.name === 'string') {
    const { error: mpErr } = await supabase.from('meal_plans').update({ dish_name: patch.name }).eq('dish_id', id)
    if (mpErr) return Response.json({ error: mpErr.message }, { status: 500 })
  }
  return Response.json(data)
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  // Clear the FK on meal_plans first: any plan cell using this dish becomes a
  // skipped (empty) slot so past/planned days don't error or show a stale name.
  const { error: mpErr } = await supabase.from('meal_plans')
    .update({ dish_id: null, dish_name: null, skipped: true })
    .eq('dish_id', id)
  if (mpErr) return Response.json({ error: mpErr.message }, { status: 500 })

  const { error } = await supabase.from('dishes').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
