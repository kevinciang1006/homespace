import { prepDateFor } from './dates'

export type PrepCandidate = {
  dish_id: string
  dish_name: string
  cook_date: string
  needs_thaw: boolean
  needs_marinate: boolean
  prep_lead_days: number | null
  prep_note: string | null
}

export type PrepItem = Omit<PrepCandidate, 'prep_lead_days'>

// Groups dishes that need thaw/marinate by the evening they should be
// prepped (cook_date - lead days). Dishes needing neither are dropped.
// Shared by the day page (Part A) and the WA cron route's buildPrepBatches
// (Part B) — the single source of truth for this grouping.
export function groupPrepByDate(rows: PrepCandidate[]): Map<string, PrepItem[]> {
  const batches = new Map<string, PrepItem[]>()
  for (const row of rows) {
    if (!row.needs_thaw && !row.needs_marinate) continue
    const prepDate = prepDateFor(row.cook_date, row.prep_lead_days)
    const item: PrepItem = {
      dish_id: row.dish_id, dish_name: row.dish_name, cook_date: row.cook_date,
      needs_thaw: row.needs_thaw, needs_marinate: row.needs_marinate, prep_note: row.prep_note,
    }
    const list = batches.get(prepDate) ?? []
    list.push(item)
    batches.set(prepDate, list)
  }
  return batches
}

// Same "thaw + marinate / thaw / marinate / prep_note override" phrase used
// by the WhatsApp prep/thaw message (lib/wa/messages.ts composePrepThawMessage).
// Deliberately duplicated rather than shared, so that tested, already-shipped
// message-composition code is never touched by this feature.
export function prepPhrase(item: { needs_thaw: boolean; needs_marinate: boolean; prep_note: string | null }): string {
  return item.prep_note?.trim()
    || (item.needs_thaw && item.needs_marinate ? 'thaw + marinate'
      : item.needs_thaw ? 'thaw'
      : item.needs_marinate ? 'marinate' : 'siapkan')
}
