import { prepDateFor, mondayOf, shiftWeek, dayNameShort } from './dates'

export type PlannedDish = {
  cook_date: string
  dish_id: string
  dish_name: string
  prep_type: string | null
  prep_lead_days: number | null
  prep_note: string | null
  protein: string
}

export type PrepTaskDraft = {
  cook_date: string
  prep_date: string
  dish_id: string | null
  dish_name: string | null
  prep_type: string
  instruction: string
  assigned_to: string
}

function templateFor(prepType: string, dishName: string): string {
  switch (prepType) {
    case 'marinate': return `Marinate ${dishName}`
    case 'cook_overnight': return `Masak ${dishName} malam ini (untuk besok)`
    case 'cut': return `Potong ${dishName}`
    case 'portion': return `Porsi ${dishName}`
    default: return `Siapkan ${dishName}`
  }
}

// Per-dish tasks: marinate, cook_overnight, cut, portion, and the
// marinate half of thaw_marinate. A plain 'thaw' emits nothing here — see
// deriveWeekendBatch, which consolidates all thawing into one weekend task.
export function deriveDishTasks(planned: PlannedDish[]): PrepTaskDraft[] {
  const drafts: PrepTaskDraft[] = []
  for (const d of planned) {
    if (!d.prep_type) continue
    const effectiveType = d.prep_type === 'thaw_marinate' ? 'marinate' : d.prep_type
    if (effectiveType === 'thaw') continue
    const prep_date = prepDateFor(d.cook_date, d.prep_lead_days)
    const instruction = d.prep_note?.trim() || templateFor(effectiveType, d.dish_name)
    drafts.push({
      cook_date: d.cook_date, prep_date, dish_id: d.dish_id, dish_name: d.dish_name,
      prep_type: effectiveType, instruction, assigned_to: 'Wife',
    })
  }
  return drafts
}

// One task covering every 'thaw'/'thaw_marinate' dish planned for the
// week, dated the Sunday immediately before the week starts (weekStart is
// always a Monday, per mondayOf/weekDates convention).
export function deriveWeekendBatch(weekStart: string, planned: PlannedDish[]): PrepTaskDraft | null {
  const thawDishes = planned.filter(d => d.prep_type === 'thaw' || d.prep_type === 'thaw_marinate')
  if (thawDishes.length === 0) return null
  const prep_date = shiftWeek(mondayOf(weekStart), -1)
  const parts = thawDishes.map(d => `${d.protein || d.dish_name} (${dayNameShort(d.cook_date)})`)
  return {
    cook_date: weekStart, prep_date, dish_id: null, dish_name: null,
    prep_type: 'thaw_batch', instruction: `Pindah ke chiller: ${parts.join(', ')}`, assigned_to: 'Wife',
  }
}

export function deriveWeekPrepTasks(weekStart: string, planned: PlannedDish[]): PrepTaskDraft[] {
  const batch = deriveWeekendBatch(weekStart, planned)
  return [...deriveDishTasks(planned), ...(batch ? [batch] : [])]
}
