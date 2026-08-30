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

// A dish with several ingredients under the same prep_action/prep_note
// (e.g. Kentang wortel: both Kentang and Wortel are "potong dadu/sesuai")
// used to render as two identical, unattributable lines — "potong
// dadu/sesuai (2 pcs); potong dadu/sesuai (2 pcs)", no way to tell which
// was which. Leading with the ingredient name fixes that; shared by the
// persisted prep_tasks.instruction (below) and the WA message (lib/wa/
// messages.ts's own copy of this same format).
export function formatStepLine(step: { ingredient_name: string; instruction: string; amount_display: string | null }): string {
  const amount = step.amount_display ? ` (${step.amount_display})` : ''
  return `${step.ingredient_name}${amount} — ${step.instruction}`
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
        instruction: formatStepLine(step),
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

// ---- WA "packing list" view: grouped by COURSE, one line per dish/bag -------
// A completely different shape from the dish-grouped view above. That view
// (BatchPrepDishBlock, feeding prep_tasks and the /meals/prep page) lists
// every ingredient as its own checkable step — right for a checklist, but as
// a WhatsApp message it read as one long, increasingly unreadable line per
// dish. This is a short PACKING list instead: what bag goes with which
// course, one line each, built from the dish's FULL ingredient set (not
// just the ones tagged with a prep_action — a soup's line is "what's in the
// bag", which includes components like a whole fishball that need no active
// prep at all, not just the ones that need cutting).

export type PackingIngredient = {
  ingredient_name: string
  category: string
  amount: number | null
  unit: string | null
  prep_action: string
  prep_note: string | null
}

export type PackingDish = {
  dish_id: string
  dish_name: string
  cook_date: string
  slot: string
  bumbu_packet: string | null
  ingredients: PackingIngredient[]
}

export type CourseSection = 'main' | 'soup' | 'veg'

// utama (the main) and pelengkap (its fried dish-helper) both pack into the
// same "Main" course; kuah -> Soup; sayuran -> Veg. Anything else (breakfast,
// fruit, desert) isn't part of this list at all.
export function sectionForSlot(slot: string): CourseSection | null {
  if (slot === 'utama' || slot === 'pelengkap') return 'main'
  if (slot === 'kuah') return 'soup'
  if (slot === 'sayuran') return 'veg'
  return null
}

// The soup base template (see the kuah normalization pass this followed):
// every non-clear soup gets ceker ayam or tulang ayam as its bone stock,
// plus wortel. Shortened labels match how a home cook actually names the
// bundle ("+ ceker", not "+ Ceker ayam").
const BASE_LABELS: Record<string, string> = { 'ceker ayam': 'ceker', 'tulang ayam': 'tulang ayam', wortel: 'wortel' }
// Aromatics that round out a soup's flavor but aren't a discrete "thing" you
// pack — always garam/merica-adjacent seasoning, not a bundle component.
const AROMATICS = new Set(['daun bawang', 'daun bawang prei', 'seledri'])
// Proteins that ride along a main dish (tofu, egg) but aren't what the dish
// is "about" — excluded from being the headline unless nothing else qualifies.
const MINOR_PROTEINS = new Set(['tahu', 'tahu kuning', 'telur', 'tempe'])

function sentenceCase(parts: string[]): string {
  const text = parts.join(' + ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// bumbu_packet already names the real product ("Bumbu Rendang", "PRONAS Saus
// Barbeque") so it's used as-is; only falls back to guessing from the dish
// name (bakar/kecap/rendang) when there's no packet linked at all.
function bumbuLabel(dishName: string, bumbuPacket: string | null): string | null {
  if (bumbuPacket) return bumbuPacket.toLowerCase()
  const lower = dishName.toLowerCase()
  if (lower.includes('bakar')) return 'bumbu bakar'
  if (lower.includes('rendang')) return 'bumbu rendang'
  if (lower.includes('kecap')) return 'bumbu kecap'
  return null
}

// "potong ring" -> "ring"; a bare "potong" (no style) -> null.
function extractCutStyle(instruction: string): string | null {
  const m = /^potong\s+(.+)$/i.exec(instruction.trim())
  return m ? m[1].trim() : null
}

// The one ingredient a Main line is "about" — the protein actually being
// marinated or cut ahead, not a tofu/egg riding along. Falls back to a
// minor protein only when there's no major candidate at all.
function pickHeadlineProtein(ingredients: PackingIngredient[]): PackingIngredient | null {
  const candidates = ingredients.filter(i => i.category === 'protein' && (i.prep_action === 'marinate' || i.prep_action === 'cut'))
  if (candidates.length === 0) return null
  const major = candidates.filter(i => !MINOR_PROTEINS.has(i.ingredient_name.toLowerCase()))
  const pool = major.length > 0 ? major : candidates
  const weighted = pool.filter(i => i.unit && unitKind(i.unit) === 'weight')
  return weighted[0] ?? pool[0]
}

type MainEntry = { key: string; label: string; amount: number | null; unit: string | null }

function mainEntry(dish: PackingDish): MainEntry | null {
  const star = pickHeadlineProtein(dish.ingredients)
  if (!star) return null
  let label: string
  if (star.prep_action === 'marinate') {
    const bumbu = bumbuLabel(dish.dish_name, dish.bumbu_packet)
    label = bumbu ? `${star.ingredient_name} + ${bumbu}` : star.ingredient_name
  } else if (star.prep_action === 'cut') {
    const style = extractCutStyle(stepInstruction(star))
    label = style ? `${star.ingredient_name} potong ${style}` : `${star.ingredient_name} potong`
  } else {
    label = star.ingredient_name
  }
  return { key: `${label}::${star.amount ?? ''}${star.unit ?? ''}`, label, amount: star.amount, unit: star.unit }
}

// Different dishes that reduce to the identical headline (two separate cumi
// dishes, both "potong ring" at 500g) merge into one line with a pack count
// — "Cumi-Cumi potong ring — 2 pack (500g each)" — rather than repeating the
// same line twice.
export function buildMainLines(dishes: PackingDish[]): string[] {
  const entries = dishes
    .filter(d => sectionForSlot(d.slot) === 'main')
    .map(mainEntry)
    .filter((e): e is MainEntry => e !== null)
  const grouped = new Map<string, { label: string; amount: number | null; unit: string | null; count: number }>()
  for (const e of entries) {
    const existing = grouped.get(e.key)
    if (existing) existing.count += 1
    else grouped.set(e.key, { label: e.label, amount: e.amount, unit: e.unit, count: 1 })
  }
  return [...grouped.values()].map(g => {
    const amt = formatIngredientAmount(g.amount, g.unit)
    if (g.count > 1) return amt ? `${g.label} — ${g.count} pack (${amt} each)` : `${g.label} — ${g.count} pack`
    return amt ? `${g.label} — 1 pack (${amt})` : `${g.label} — 1 pack`
  })
}

// A soup's line is just its bundle contents by name — star ingredient(s)
// first, then the base (wortel before the bone stock) — no amounts, no
// verbs, no pantry/aromatics/packets. Not gated on prep_action at all:
// even a soup with nothing that needs active cutting (Bakso ikan tahu —
// fishballs and tofu, nothing to prep) still needs its components bagged
// together, so it still gets a line.
function soupLine(dish: PackingDish): string | null {
  const eligible = dish.ingredients.filter(i =>
    i.category !== 'pantry' && i.category !== 'bumbu' && !AROMATICS.has(i.ingredient_name.toLowerCase()))
  if (eligible.length === 0) return null
  const star: string[] = []
  const base: string[] = []
  for (const i of eligible) {
    const label = BASE_LABELS[i.ingredient_name.toLowerCase()]
    if (label) base.push(label)
    else star.push(i.ingredient_name.toLowerCase())
  }
  base.sort((a, b) => (a === 'wortel' ? -1 : b === 'wortel' ? 1 : 0))
  const parts = [...star, ...base]
  return parts.length ? sentenceCase(parts) : null
}

export function buildSoupLines(dishes: PackingDish[]): string[] {
  return dishes.filter(d => sectionForSlot(d.slot) === 'soup')
    .map(soupLine).filter((l): l is string => l !== null)
}

// A veg line only appears when there's something to actually cut/chop —
// unlike soup, a vegetable side with nothing tagged (bought pre-cut, or
// just seasoning) doesn't need a bag prepped ahead.
function vegLine(dish: PackingDish): string | null {
  const star = dish.ingredients.find(i =>
    i.category !== 'pantry' && i.category !== 'bumbu' &&
    (i.prep_action === 'cut' || i.prep_action === 'chop' || i.prep_action === 'slice'))
  return star ? `${star.ingredient_name} — ${stepInstruction(star)}` : null
}

export function buildVegLines(dishes: PackingDish[]): string[] {
  return dishes.filter(d => sectionForSlot(d.slot) === 'veg')
    .map(vegLine).filter((l): l is string => l !== null)
}
