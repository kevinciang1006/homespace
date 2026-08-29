// Per-dish buy/cook quantity for ONE family serving (~2 adults + 1 child).
// Shared formatting for plan cards, the dishes editor, and the shopping list.

export const QTY_UNITS = ['g', 'kg', 'pcs', 'slices', 'ekor', 'bunch', 'ml', 'pot'] as const
export type QtyUnit = (typeof QTY_UNITS)[number]

// Weight/volume units read naturally glued to the number ("400g"); count-like
// units read better with a space ("2 ekor", "3 pcs").
const NO_SPACE_UNITS = new Set<string>(['g', 'kg', 'ml'])

export function formatQtyAmount(amount: number, unit: string): string {
  return NO_SPACE_UNITS.has(unit) ? `${amount}${unit}` : `${amount} ${unit}`
}

// ---- ingredient units (dish_ingredients / ingredients.default_unit) --------
// Broader than QTY_UNITS above (which is only the whole-dish buy quantity) —
// covers every unit an ingredient line might use, for the dropdown in the
// dish editor and the Ingredients page.
export const INGREDIENT_UNITS = [
  'g', 'kg', 'ml', 'L', 'pcs', 'butir', 'papan', 'ekor', 'pack', 'packet',
  'stalk', 'batang', 'siung', 'sdm', 'sdt', 'tsp', 'tbsp', 'pot', 'batch', 'to taste',
] as const
export type IngredientUnit = (typeof INGREDIENT_UNITS)[number]

// ---- cross-dish aggregation with unit conversion ---------------------------
// Weight (g/kg) and volume (ml/L) each collapse to one base unit so amounts
// actually sum instead of being kept apart by literal unit string. Count-like
// units (pcs, butir, papan, ekor, pack, stalk, ...) have no common base, so
// each distinct one stays its own bucket — see dominantUnitClass.
export type UnitKind = 'weight' | 'volume' | 'count'

const WEIGHT_UNITS = new Set(['g', 'gram', 'grams', 'kg'])
const VOLUME_UNITS = new Set(['ml', 'l', 'liter', 'litre', 'liters', 'litres'])

export function unitKind(unit: string): UnitKind {
  const u = unit.trim().toLowerCase()
  if (WEIGHT_UNITS.has(u)) return 'weight'
  if (VOLUME_UNITS.has(u)) return 'volume'
  return 'count'
}

// Weight -> grams, volume -> ml. Count units pass through unconverted (there
// is no shared base for "pcs" vs "butir").
export function toBaseAmount(amount: number, unit: string): number {
  const u = unit.trim().toLowerCase()
  if (u === 'kg') return amount * 1000
  if (u === 'l' || u === 'liter' || u === 'litre' || u === 'liters' || u === 'litres') return amount * 1000
  return amount
}

// grams -> "300g" below 1000, "1.45kg" (1 decimal, trimmed) at/above 1000.
// ml -> "300ml" / "1.5L" the same way.
export function formatBaseAmount(amount: number, kind: 'weight' | 'volume'): string {
  if (amount >= 1000) {
    const scaled = Math.round((amount / 1000) * 10) / 10
    const label = kind === 'weight' ? 'kg' : 'L'
    return `${Number.isInteger(scaled) ? scaled.toFixed(0) : scaled.toFixed(1)}${label}`
  }
  const rounded = Math.round(amount)
  return kind === 'weight' ? `${rounded}g` : `${rounded}ml`
}

// One ingredient's accumulated total within one unit "class" (weight, volume,
// or one specific count unit) across however many dish lines contributed to it.
export type UnitClass = { total: number; kind: UnitKind; label: string; occurrences: number }

export function addToUnitClasses(classes: Map<string, UnitClass>, amount: number, unit: string): void {
  const kind = unitKind(unit)
  const key = kind === 'count' ? `count:${unit.trim().toLowerCase()}` : kind
  const base = toBaseAmount(amount, unit)
  const existing = classes.get(key)
  if (existing) { existing.total += base; existing.occurrences += 1; return }
  classes.set(key, {
    total: base, kind, occurrences: 1,
    label: kind === 'count' ? unit.trim() : (kind === 'weight' ? 'g' : 'ml'),
  })
}

// When an ingredient has only one unit class, that's it. When it has several
// (a real data problem — see scripts using this), weight wins over volume
// wins over count; among count classes, the one with more contributing dish
// lines wins (falling back to the larger total). The other classes are
// dropped from the displayed total, not string-concatenated.
export function dominantUnitClass(classes: Map<string, UnitClass>): UnitClass | null {
  const entries = [...classes.values()]
  if (entries.length === 0) return null
  const rank = (k: UnitKind) => (k === 'weight' ? 0 : k === 'volume' ? 1 : 2)
  entries.sort((a, b) => rank(a.kind) - rank(b.kind) || b.occurrences - a.occurrences || b.total - a.total)
  return entries[0]
}

export function formatUnitClass(cls: UnitClass): string {
  return cls.kind === 'count' ? formatQtyAmount(cls.total, cls.label) : formatBaseAmount(cls.total, cls.kind)
}

// Full display string for a dish's quantity, e.g. "400g", "2 ekor (~600g total)".
// Returns null when there's nothing worth showing (no amount/unit and no note).
export function formatQty(amount: number | null | undefined, unit: string | null | undefined, note?: string | null): string | null {
  const trimmedNote = note?.trim() || null
  if (amount == null || !unit) return trimmedNote
  const base = formatQtyAmount(amount, unit)
  return trimmedNote ? `${base} (${trimmedNote})` : base
}

type QtyDishFields = {
  qty_amount?: number | null
  qty_unit?: string | null
  qty_note?: string | null
  veg_portions?: number
  fruit_portions?: number
}

// Compact "400g · 🥗 2 veg" style line for a dish's buy/cook amount + produce
// portion count. Pure display — no targets, no storage. null when there's
// nothing worth showing.
export function qtyDisplay(dishes: QtyDishFields | null | undefined): string | null {
  const qty = formatQty(dishes?.qty_amount, dishes?.qty_unit, dishes?.qty_note)
  const veg = dishes?.veg_portions ?? 0
  const fruit = dishes?.fruit_portions ?? 0
  const parts: string[] = []
  if (qty) parts.push(qty)
  if (veg > 0) parts.push(`🥗 ${veg} veg`)
  if (fruit > 0) parts.push(`🍎 ${fruit} fruit`)
  return parts.length ? parts.join(' · ') : null
}
