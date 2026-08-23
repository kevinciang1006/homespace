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
