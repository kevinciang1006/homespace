import { supabase } from '@/lib/supabase'
import { toBaseAmount, fromBaseAmount } from '@/lib/meals/qty'
import {
  bucketKey, bucketStockOnHand, bucketReserved, bucketReservedByGroup, availableForIngredient,
  type ReservedMovementLite, type StockRowLite,
} from './availability'

export type StockRowWithAvailability = {
  id: string; ingredient_id: string; location: string; on_hand: number; unit: string | null; low_threshold: number | null
  updated_at: string; created_at: string
  ingredients: { name: string; category: string | null; default_unit: string | null; shelf_stable: boolean; satisfies_group: string | null } | null
  reserved: number
  available: number
}

// Shared by the Stock page's own server-side query (app/stock/page.tsx) and
// GET /api/stock, so both report the same reserved/available figures
// instead of two independent (and possibly diverging) computations. See
// availableForIngredient for what "available" means for a group ingredient.
export async function attachAvailability<
  T extends { id: string; ingredient_id: string; unit: string | null; on_hand: number; ingredients: { satisfies_group: string | null } | null },
>(rows: T[]): Promise<(T & { reserved: number; available: number })[]> {
  const stockRows: StockRowLite[] = rows.map(r => ({
    ingredient_id: r.ingredient_id, on_hand: Number(r.on_hand), unit: r.unit, satisfies_group: r.ingredients?.satisfies_group ?? null,
  }))
  const stockBuckets = bucketStockOnHand(stockRows)

  const [{ data: movementsRaw }, { data: groupedIngredientsRaw }] = await Promise.all([
    supabase.from('stock_movements').select('ingredient_id, kind, amount, unit').eq('ref_type', 'meal_plan').in('kind', ['reserve', 'release', 'consume']),
    // Covers every ingredient a group reservation might be logged against —
    // the generic marker (e.g. "Ikan") included, even though it has no
    // stock row of its own. See bucketReservedByGroup.
    supabase.from('ingredients').select('id, satisfies_group').not('satisfies_group', 'is', null),
  ])
  const reservedByIngredient = bucketReserved((movementsRaw ?? []) as ReservedMovementLite[])
  const groupById = new Map(((groupedIngredientsRaw ?? []) as { id: string; satisfies_group: string | null }[]).map(i => [i.id, i.satisfies_group]))
  const reservedByGroup = bucketReservedByGroup((movementsRaw ?? []) as ReservedMovementLite[], groupById)

  return rows.map(r => {
    if (!r.unit) return { ...r, reserved: 0, available: Number(r.on_hand) }
    const group = r.ingredients?.satisfies_group ?? null
    const key = bucketKey(r.unit)
    const availableBase = availableForIngredient({ id: r.ingredient_id, satisfies_group: group }, key, stockBuckets, reservedByIngredient, reservedByGroup)
    const available = fromBaseAmount(availableBase, r.unit)
    // Display-only: how much of what physically exists here is spoken for.
    // For a group ingredient this is a shared, pooled figure (see comment
    // above) rather than something specific to this exact row.
    const reserved = Math.max(0, Number(r.on_hand) - available)
    return { ...r, reserved, available }
  })
}

function baseUnitForKey(key: string): string {
  if (key === 'weight') return 'g'
  if (key === 'volume') return 'ml'
  return key.slice('count:'.length)
}

// Only ref_type='meal_plan' movements count as "reserved" — cook-time
// per-row consume entries (ref_type='cook_log', logged for audit of which
// specific stock actually got used) are deliberately excluded here so they
// don't double-count against the reservation that closes separately (see
// consumeForCookLogEntry below).
async function currentNetReservedForDate(planDate: string): Promise<Map<string, Map<string, number>>> {
  const { data } = await supabase.from('stock_movements')
    .select('ingredient_id, kind, amount, unit')
    .eq('ref_type', 'meal_plan').eq('ref_date', planDate)
    .in('kind', ['reserve', 'release', 'consume'])
  return bucketReserved((data ?? []) as ReservedMovementLite[])
}

// Recomputes what SHOULD be reserved for a date from the current meal_plans
// + dish_ingredients state, diffs it against what's currently reserved (net,
// from the ledger), and inserts only the adjustment (a 'reserve' top-up or a
// 'release' wind-down) — idempotent, and handles add/remove/reroll/whole-day
// -reshuffle uniformly without having to track deltas at every call site.
// Reserved is always logged against the dish's OWN listed ingredient_id
// (generic "Ikan", not a specific fish) — availability.ts resolves the
// group pool at read time instead.
export async function reconcilePlanDateReservations(planDate: string): Promise<void> {
  const [{ data: plansRaw }, { data: cookedRaw }] = await Promise.all([
    supabase.from('meal_plans').select('id, dish_id, slot, role')
      .eq('plan_date', planDate).eq('skipped', false).not('dish_id', 'is', null),
    supabase.from('cook_log').select('slot, role').eq('cook_date', planDate).eq('cooked', true),
  ])
  type PlanRow = { id: string; dish_id: string; slot: string; role: string }
  const cookedKeys = new Set((cookedRaw ?? []).map((c: { slot: string; role: string }) => `${c.slot}|${c.role}`))
  // Already-cooked dishes are done — their need no longer counts toward what
  // "should" be reserved (consumeForCookLogEntry below is what actually
  // closes their reservation, at the moment they're marked cooked).
  const plans = ((plansRaw ?? []) as PlanRow[]).filter(p => !cookedKeys.has(`${p.slot}|${p.role}`))

  const shouldBe = new Map<string, Map<string, number>>()
  const dishIds = [...new Set(plans.map(p => p.dish_id))]
  if (dishIds.length > 0) {
    const { data: linksRaw } = await supabase.from('dish_ingredients')
      .select('dish_id, ingredient_id, amount, unit').in('dish_id', dishIds)
    type Link = { dish_id: string; ingredient_id: string; amount: number | null; unit: string | null }
    const linksByDish = new Map<string, Link[]>()
    for (const l of (linksRaw ?? []) as Link[]) {
      const list = linksByDish.get(l.dish_id) ?? []
      list.push(l); linksByDish.set(l.dish_id, list)
    }
    for (const p of plans) {
      for (const link of linksByDish.get(p.dish_id) ?? []) {
        if (link.amount == null || !link.unit) continue
        const key = bucketKey(link.unit)
        const base = toBaseAmount(link.amount, link.unit)
        let m = shouldBe.get(link.ingredient_id)
        if (!m) { m = new Map(); shouldBe.set(link.ingredient_id, m) }
        m.set(key, (m.get(key) ?? 0) + base)
      }
    }
  }

  const currentNet = await currentNetReservedForDate(planDate)
  const allIngredientIds = new Set([...shouldBe.keys(), ...currentNet.keys()])
  const inserts: { ingredient_id: string; kind: 'reserve' | 'release'; amount: number; unit: string; ref_type: string; ref_date: string; note: string }[] = []

  for (const ingId of allIngredientIds) {
    const want = shouldBe.get(ingId) ?? new Map()
    const have = currentNet.get(ingId) ?? new Map()
    for (const key of new Set([...want.keys(), ...have.keys()])) {
      const delta = (want.get(key) ?? 0) - (have.get(key) ?? 0)
      if (Math.abs(delta) < 1e-9) continue
      inserts.push({
        ingredient_id: ingId, kind: delta > 0 ? 'reserve' : 'release', amount: delta,
        unit: baseUnitForKey(key), ref_type: 'meal_plan', ref_date: planDate, note: 'auto (plan reconcile)',
      })
    }
  }
  if (inserts.length) {
    const { error } = await supabase.from('stock_movements').insert(inserts)
    if (error) throw new Error(error.message)
  }
}

// Marking a dish cooked converts its reservation to a real consumption:
// depletes actual stock (largest on_hand first, within the group for a
// group-satisfied ingredient), logs a per-row 'consume' for audit
// (ref_type='cook_log'), AND separately closes the reservation ledger by
// logging one more 'consume' against the dish's own listed ingredient_id
// for the FULL original need (ref_type='meal_plan') — regardless of how
// much stock actually existed, since the plan's need for this dish is done
// either way once it's cooked. Keeping these two ref_types apart is what
// prevents the exact-match case (where they'd otherwise share an
// ingredient_id) from double-counting in the reservation ledger.
export async function consumeForDish(dishId: string, cookDate: string): Promise<void> {
  const { data: linksRaw } = await supabase.from('dish_ingredients')
    .select('ingredient_id, amount, unit').eq('dish_id', dishId)
  type Link = { ingredient_id: string; amount: number | null; unit: string | null }
  const links = (linksRaw ?? []) as Link[]
  if (links.length === 0) return

  const ingredientIds = [...new Set(links.map(l => l.ingredient_id))]
  const { data: ingredientsRaw } = await supabase.from('ingredients').select('id, satisfies_group').in('id', ingredientIds)
  const groupById = new Map(((ingredientsRaw ?? []) as { id: string; satisfies_group: string | null }[]).map(i => [i.id, i.satisfies_group]))

  type StockCandidate = { id: string; ingredient_id: string; on_hand: number; unit: string | null }
  const movementInserts: { ingredient_id: string; kind: 'consume'; amount: number; unit: string; ref_type: string; ref_id?: string; ref_date: string; note: string }[] = []

  for (const link of links) {
    if (link.amount == null || !link.unit) continue
    const group = groupById.get(link.ingredient_id) ?? null
    const key = bucketKey(link.unit)
    const neededBase = toBaseAmount(link.amount, link.unit)
    if (neededBase <= 0) continue

    const { data: candidatesRaw } = group
      ? await supabase.from('stock').select('id, ingredient_id, on_hand, unit, ingredients!inner(satisfies_group)').eq('ingredients.satisfies_group', group).gt('on_hand', 0)
      : await supabase.from('stock').select('id, ingredient_id, on_hand, unit').eq('ingredient_id', link.ingredient_id).gt('on_hand', 0)
    const candidates = ((candidatesRaw ?? []) as StockCandidate[])
      .filter(c => c.unit && bucketKey(c.unit) === key)
      .sort((a, b) => toBaseAmount(b.on_hand, b.unit!) - toBaseAmount(a.on_hand, a.unit!)) // largest on_hand first

    let remainingBase = neededBase
    for (const row of candidates) {
      if (remainingBase <= 0) break
      const rowBase = toBaseAmount(row.on_hand, row.unit!)
      const takeBase = Math.min(remainingBase, rowBase)
      const takeNative = fromBaseAmount(takeBase, row.unit!)
      await supabase.from('stock').update({ on_hand: row.on_hand - takeNative }).eq('id', row.id)
      movementInserts.push({
        ingredient_id: row.ingredient_id, kind: 'consume', amount: -takeNative, unit: row.unit!,
        ref_type: 'cook_log', ref_date: cookDate, note: 'auto (marked cooked)',
      })
      remainingBase -= takeBase
    }

    // Close the reservation for the FULL original need, not just what stock
    // covered — once cooked, the plan's need for this ingredient is done
    // regardless of any shortfall (which just means stock didn't know about
    // something bought/used outside the system).
    movementInserts.push({
      ingredient_id: link.ingredient_id, kind: 'consume', amount: -fromBaseAmount(neededBase, link.unit),
      unit: link.unit, ref_type: 'meal_plan', ref_date: cookDate, note: 'auto (closes reservation)',
    })
  }

  if (movementInserts.length) {
    const { error } = await supabase.from('stock_movements').insert(movementInserts)
    if (error) throw new Error(error.message)
  }
}
