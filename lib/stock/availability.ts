import { addToUnitClasses, toBaseAmount, unitKind, type UnitClass } from '../meals/qty'

// Layer 2: stock <-> meal plan <-> shopping list. Everything here is pure
// (no supabase calls) so it's cheap to test — callers fetch rows and pass
// plain arrays in.
//
// ---- Ledger sign convention (extends Layer 1's "signed delta") ------------
// restock: +N (on_hand increases). correction: signed delta on on_hand.
// consume: -N, ALSO applied directly to on_hand (a physical use).
// reserve: +N, does NOT touch on_hand. release: -N, does NOT touch on_hand.
// This makes `reserved = SUM(amount)` over just reserve|release|consume —
// no per-kind sign-flipping, and reserve -> consume nets to zero on its own
// without ever deleting a ledger row (full audit trail stays intact).
//
// ---- Unit compatibility -----------------------------------------------
// A need only matches stock expressed in a compatible bucket — reusing the
// exact bucketing lib/meals/shopping.ts already uses to aggregate dish
// ingredients (weight -> g, volume -> ml, each distinct count unit its own
// bucket: "2 ekor" only ever matches ekor-stock). Anything else is left
// uncovered rather than guessed at.

export function bucketKey(unit: string): string {
  const kind = unitKind(unit)
  return kind === 'count' ? `count:${unit.trim().toLowerCase()}` : kind
}

// Same bucket key, derived from an already-built UnitClass (its `label` is
// the trimmed unit string for count kinds — see addToUnitClasses in qty.ts)
// instead of a raw unit string. Lets a caller holding a dominantUnitClass
// result (e.g. the shopping-list aggregation) look itself up in stock's
// buckets without re-deriving the unit.
export function unitClassBucketKey(cls: UnitClass): string {
  return cls.kind === 'count' ? `count:${cls.label.toLowerCase()}` : cls.kind
}

export type StockRowLite = { ingredient_id: string; on_hand: number; unit: string | null; satisfies_group: string | null }

// One ingredient's (or one group's) on_hand, bucketed by compatible unit —
// same shape lib/meals/qty.ts's UnitClass uses for shopping aggregation.
export type Buckets = Map<string, UnitClass>

export function bucketStockOnHand(rows: StockRowLite[]): { byIngredient: Map<string, Buckets>; byGroup: Map<string, Buckets> } {
  const byIngredient = new Map<string, Buckets>()
  const byGroup = new Map<string, Buckets>()
  for (const r of rows) {
    if (!r.unit || !Number.isFinite(r.on_hand) || r.on_hand <= 0) continue
    let classes = byIngredient.get(r.ingredient_id)
    if (!classes) { classes = new Map(); byIngredient.set(r.ingredient_id, classes) }
    addToUnitClasses(classes, r.on_hand, r.unit)
    if (r.satisfies_group) {
      let g = byGroup.get(r.satisfies_group)
      if (!g) { g = new Map(); byGroup.set(r.satisfies_group, g) }
      addToUnitClasses(g, r.on_hand, r.unit)
    }
  }
  return { byIngredient, byGroup }
}

export type ReservedMovementLite = { ingredient_id: string; kind: string; amount: number; unit: string | null }

// Net reserved per ingredient, bucketed the same way — summing the signed
// amount directly (see sign convention above) across reserve/release/consume.
export function bucketReserved(rows: ReservedMovementLite[]): Map<string, Map<string, number>> {
  const byIngredient = new Map<string, Map<string, number>>()
  for (const r of rows) {
    if (!r.unit || (r.kind !== 'reserve' && r.kind !== 'release' && r.kind !== 'consume')) continue
    const key = bucketKey(r.unit)
    const base = toBaseAmount(Number(r.amount), r.unit)
    let m = byIngredient.get(r.ingredient_id)
    if (!m) { m = new Map(); byIngredient.set(r.ingredient_id, m) }
    m.set(key, (m.get(key) ?? 0) + base)
  }
  return byIngredient
}

// Same, but rolled up by satisfies_group instead of ingredient_id — needed
// wherever the CALLER only has a SPECIFIC group member's id (e.g. a "Ikan
// Kerapu" stock row) rather than the generic id a reserve was actually
// logged against (dishes always reserve against their own listed
// ingredient — the generic "Ikan" — never a specific fish; see
// reconcilePlanDateReservations). `groupById` covers every ingredient id
// that might appear here, generic markers included, even ones with no
// stock row of their own.
export function bucketReservedByGroup(rows: ReservedMovementLite[], groupById: Map<string, string | null>): Map<string, Map<string, number>> {
  const byGroup = new Map<string, Map<string, number>>()
  for (const r of rows) {
    if (!r.unit || (r.kind !== 'reserve' && r.kind !== 'release' && r.kind !== 'consume')) continue
    const group = groupById.get(r.ingredient_id)
    if (!group) continue
    const key = bucketKey(r.unit)
    const base = toBaseAmount(Number(r.amount), r.unit)
    let m = byGroup.get(group)
    if (!m) { m = new Map(); byGroup.set(group, m) }
    m.set(key, (m.get(key) ?? 0) + base)
  }
  return byGroup
}

export type IngredientMatchInfo = { id: string; satisfies_group: string | null }

// available(bucket) = on_hand(bucket) - reserved(bucket), for the ingredient
// itself (exact match) or, if it has a satisfies_group, for the whole group
// pool instead. Reservations for a group need are always logged against the
// dish's own listed (generic) ingredient_id — never a specific fish — so:
//   - a caller whose `ing.id` IS already that generic id (e.g. the shopping-
//     list aggregation, built straight from dish_ingredients) just needs
//     reservedByIngredient; the `reservedByGroup` param can be omitted.
//   - a caller holding a SPECIFIC group member instead (e.g. the Stock
//     page's "Ikan Kerapu" row) needs reservedByGroup, built via
//     bucketReservedByGroup, to find what's reserved for the group at all.
export function availableForIngredient(
  ing: IngredientMatchInfo,
  key: string,
  stockBuckets: { byIngredient: Map<string, Buckets>; byGroup: Map<string, Buckets> },
  reservedByIngredient: Map<string, Map<string, number>>,
  reservedByGroup?: Map<string, Map<string, number>>,
): number {
  const onHandBuckets = ing.satisfies_group ? stockBuckets.byGroup.get(ing.satisfies_group) : stockBuckets.byIngredient.get(ing.id)
  const onHand = onHandBuckets?.get(key)?.total ?? 0
  const reserved = ing.satisfies_group
    ? (reservedByGroup?.get(ing.satisfies_group)?.get(key) ?? reservedByIngredient.get(ing.id)?.get(key) ?? 0)
    : (reservedByIngredient.get(ing.id)?.get(key) ?? 0)
  return Math.max(0, onHand - reserved)
}

// One dish ingredient's need, resolved against current stock. `neededBase`
// is in the SAME unit-class bucket as the need (already converted, e.g.
// grams for weight) — gapBase is what's left to buy in that same bucket.
export type NeedCoverage = {
  ingredient_id: string
  bucketKey: string
  neededBase: number
  availableBase: number
  coveredBase: number
  gapBase: number
}

export function coverNeed(
  ing: IngredientMatchInfo,
  amount: number,
  unit: string,
  stockBuckets: { byIngredient: Map<string, Buckets>; byGroup: Map<string, Buckets> },
  reservedByIngredient: Map<string, Map<string, number>>,
): NeedCoverage {
  const key = bucketKey(unit)
  const neededBase = toBaseAmount(amount, unit)
  const availableBase = availableForIngredient(ing, key, stockBuckets, reservedByIngredient)
  const coveredBase = Math.min(neededBase, availableBase)
  return { ingredient_id: ing.id, bucketKey: key, neededBase, availableBase, coveredBase, gapBase: Math.max(0, neededBase - coveredBase) }
}
