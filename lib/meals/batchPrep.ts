import { formatIngredientAmount, unitKind } from './qty'

// ---- Wife's side: per-dish cooking prep, from dish_ingredients.prep_action ---

export type BatchPrepIngredientRow = {
  dish_id: string
  dish_name: string
  cook_date: string
  ingredient_name: string
  amount: number | null
  unit: string | null
  prep_action: string
  prep_note: string | null
}

export type BatchPrepStep = {
  ingredient_name: string
  amount_display: string | null
  prep_action: string
  instruction: string
}

export type BatchPrepDishBlock = {
  dish_id: string
  dish_name: string
  cook_date: string
  steps: BatchPrepStep[]
}

const ACTION_VERB: Record<string, string> = {
  marinate: 'marinate', cut: 'potong', slice: 'iris', chop: 'potong', portion: 'porsi', boil_prep: 'siapkan',
}

// prep_note (set by the seed script or edited by hand) always wins — it's
// the specific "potong ring" / "marinate bumbu bakar" phrasing. Falls back
// to a generic "<verb> <ingredient>" only when a row has an action but no
// note yet.
export function stepInstruction(row: { ingredient_name: string; prep_note: string | null; prep_action: string }): string {
  if (row.prep_note?.trim()) return row.prep_note.trim()
  return `${ACTION_VERB[row.prep_action] ?? 'siapkan'} ${row.ingredient_name}`
}

// One block per dish, ingredients in the order they arrived. A dish planned
// more than once in the week (a repeated staple) collapses to a single
// block dated its FIRST cook date — you prep it once, not once per serving.
export function groupBatchPrepByDish(rows: BatchPrepIngredientRow[]): BatchPrepDishBlock[] {
  const byDish = new Map<string, BatchPrepDishBlock>()
  for (const r of rows) {
    let block = byDish.get(r.dish_id)
    if (!block) {
      block = { dish_id: r.dish_id, dish_name: r.dish_name, cook_date: r.cook_date, steps: [] }
      byDish.set(r.dish_id, block)
    } else if (r.cook_date < block.cook_date) {
      block.cook_date = r.cook_date
    }
    block.steps.push({
      ingredient_name: r.ingredient_name,
      amount_display: formatIngredientAmount(r.amount, r.unit),
      prep_action: r.prep_action,
      instruction: stepInstruction(r),
    })
  }
  return [...byDish.values()].sort((a, b) => a.cook_date.localeCompare(b.cook_date) || a.dish_name.localeCompare(b.dish_name))
}

// ---- Kevin's side: fruit + yogurt portioning ---------------------------------
// Fruit-slot dishes and "Yogurt" have no dish_ingredients breakdown — they're
// bought/served as a whole dish (dishes.qty_amount/qty_unit), so this reads
// straight from the week's planned dishes instead of dish_ingredients.

export type FruitDishRow = {
  dish_id: string
  dish_name: string
  cook_date: string
  slot: string
  qty_amount: number | null
  qty_unit: string | null
}

export type FruitPrepItem = {
  dish_id: string
  dish_name: string
  cook_date: string
  amount_display: string | null
  instruction: string
}

// "Potong" (cut) only makes sense for something with a physical form to
// slice — a whole fruit sold by the piece/slice. A liquid (qty_unit in
// ml/L — juice, or Yogurt) can't be cut, just portioned out.
function fruitInstruction(dishName: string, qtyUnit: string | null): string {
  const lower = dishName.trim().toLowerCase()
  if (lower === 'yogurt') return 'siapkan yogurt porsi kecil'
  if (qtyUnit && unitKind(qtyUnit) === 'volume') return `siapkan ${lower}, bagi porsi`
  return `potong ${lower}, bagi porsi`
}

// Deduped by dish — a fruit planned most days of the week (e.g. daily
// breakfast banana) still only needs portioning once, not once per day.
// Only real fruit (slot='fruit') and Yogurt specifically qualify; other
// desert-slot items (a bought cake, kacang ijo) need cooking or no prep at
// all, not portioning, so they're left out of Kevin's list on purpose.
export function deriveFruitPrepItems(rows: FruitDishRow[]): FruitPrepItem[] {
  const seen = new Map<string, FruitPrepItem>()
  for (const r of rows) {
    const isFruit = r.slot === 'fruit'
    const isYogurt = r.slot === 'desert' && r.dish_name.trim().toLowerCase() === 'yogurt'
    if (!isFruit && !isYogurt) continue
    const existing = seen.get(r.dish_id)
    if (existing) { if (r.cook_date < existing.cook_date) existing.cook_date = r.cook_date; continue }
    seen.set(r.dish_id, {
      dish_id: r.dish_id, dish_name: r.dish_name, cook_date: r.cook_date,
      amount_display: formatIngredientAmount(r.qty_amount, r.qty_unit),
      instruction: fruitInstruction(r.dish_name, r.qty_unit),
    })
  }
  return [...seen.values()].sort((a, b) => a.cook_date.localeCompare(b.cook_date) || a.dish_name.localeCompare(b.dish_name))
}

// ---- prep_tasks drafts (persistence-agnostic — the DB layer dedupes/inserts) -

export type BatchPrepTaskDraft = {
  week_start: string
  cook_date: string
  prep_date: string
  dish_id: string
  dish_name: string
  instruction: string
  prep_action: string
  assigned_to: 'Wife' | 'Kevin'
}

function withAmount(instruction: string, amount_display: string | null): string {
  return amount_display ? `${instruction} (${amount_display})` : instruction
}

export function deriveBatchPrepTaskDrafts(
  weekStart: string, prepDate: string, dishBlocks: BatchPrepDishBlock[], fruitItems: FruitPrepItem[],
): BatchPrepTaskDraft[] {
  const drafts: BatchPrepTaskDraft[] = []
  for (const block of dishBlocks) {
    for (const step of block.steps) {
      drafts.push({
        week_start: weekStart, cook_date: block.cook_date, prep_date: prepDate,
        dish_id: block.dish_id, dish_name: block.dish_name,
        instruction: withAmount(step.instruction, step.amount_display),
        prep_action: step.prep_action, assigned_to: 'Wife',
      })
    }
  }
  for (const item of fruitItems) {
    drafts.push({
      week_start: weekStart, cook_date: item.cook_date, prep_date: prepDate,
      dish_id: item.dish_id, dish_name: item.dish_name,
      instruction: withAmount(item.instruction, item.amount_display),
      prep_action: 'portion', assigned_to: 'Kevin',
    })
  }
  return drafts
}
