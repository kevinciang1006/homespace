import { describe, it, expect } from 'vitest'
import { deriveDishTasks, deriveWeekendBatch, deriveWeekPrepTasks, type PlannedDish } from './prepTasks'

function dish(over: Partial<PlannedDish> & Pick<PlannedDish, 'cook_date' | 'dish_id' | 'dish_name'>): PlannedDish {
  return { prep_type: null, prep_lead_days: null, prep_note: null, protein: 'chicken', ...over }
}

describe('deriveDishTasks', () => {
  it('templates a marinate task', () => {
    const tasks = deriveDishTasks([dish({ dish_id: '1', dish_name: 'Ayam bumbu bakar', cook_date: '2026-08-25', prep_type: 'marinate', prep_lead_days: 1 })])
    expect(tasks).toEqual([{
      cook_date: '2026-08-25', prep_date: '2026-08-24', dish_id: '1', dish_name: 'Ayam bumbu bakar',
      prep_type: 'marinate', instruction: 'Marinate Ayam bumbu bakar', assigned_to: 'Wife',
    }])
  })
  it('templates a cook_overnight task', () => {
    const tasks = deriveDishTasks([dish({ dish_id: '2', dish_name: 'Rendang ayam', cook_date: '2026-08-25', prep_type: 'cook_overnight', prep_lead_days: 1 })])
    expect(tasks[0].instruction).toBe('Masak Rendang ayam malam ini (untuk besok)')
  })
  it('templates cut and portion tasks', () => {
    const cut = deriveDishTasks([dish({ dish_id: '3', dish_name: 'Sayur asem', cook_date: '2026-08-25', prep_type: 'cut', prep_lead_days: 1 })])
    expect(cut[0].instruction).toBe('Potong Sayur asem')
    const portion = deriveDishTasks([dish({ dish_id: '4', dish_name: 'Kacang ijo', cook_date: '2026-08-25', prep_type: 'portion', prep_lead_days: 1 })])
    expect(portion[0].instruction).toBe('Porsi Kacang ijo')
  })
  it('prep_note overrides the template', () => {
    const tasks = deriveDishTasks([dish({ dish_id: '5', dish_name: 'Iga bumbu bakar', cook_date: '2026-08-25', prep_type: 'marinate', prep_lead_days: 1, prep_note: 'rendam bumbu semalaman' })])
    expect(tasks[0].instruction).toBe('rendam bumbu semalaman')
  })
  it('emits only the marinate half of thaw_marinate — no separate thaw entry', () => {
    const tasks = deriveDishTasks([dish({ dish_id: '6', dish_name: 'Udang kecap', cook_date: '2026-08-25', prep_type: 'thaw_marinate', prep_lead_days: 1 })])
    expect(tasks).toHaveLength(1)
    expect(tasks[0].prep_type).toBe('marinate')
    expect(tasks[0].instruction).toBe('Marinate Udang kecap')
  })
  it('emits nothing for a plain thaw dish (handled by the weekend batch instead)', () => {
    const tasks = deriveDishTasks([dish({ dish_id: '7', dish_name: 'Ayam frozen', cook_date: '2026-08-25', prep_type: 'thaw', prep_lead_days: 1 })])
    expect(tasks).toEqual([])
  })
  it('skips dishes with no prep_type', () => {
    const tasks = deriveDishTasks([dish({ dish_id: '8', dish_name: 'Nasi', cook_date: '2026-08-25' })])
    expect(tasks).toEqual([])
  })
})

describe('deriveWeekendBatch', () => {
  it('returns null when no dish needs thawing', () => {
    const planned = [dish({ dish_id: '1', dish_name: 'Nasi', cook_date: '2026-08-25' })]
    expect(deriveWeekendBatch('2026-08-24', planned)).toBeNull()
  })
  it('consolidates thaw and thaw_marinate dishes into one Sunday-dated task', () => {
    const planned = [
      dish({ dish_id: '1', dish_name: 'Ayam frozen', cook_date: '2026-08-25', prep_type: 'thaw', protein: 'ayam' }),
      dish({ dish_id: '2', dish_name: 'Udang kecap', cook_date: '2026-08-27', prep_type: 'thaw_marinate', protein: 'udang' }),
      dish({ dish_id: '3', dish_name: 'Nasi', cook_date: '2026-08-25' }), // not thaw-related, excluded
    ]
    const batch = deriveWeekendBatch('2026-08-24', planned)
    expect(batch).not.toBeNull()
    expect(batch!.prep_date).toBe('2026-08-23') // Sunday before Monday 2026-08-24
    expect(batch!.dish_id).toBeNull()
    expect(batch!.prep_type).toBe('thaw_batch')
    expect(batch!.instruction).toBe('Pindah ke chiller: ayam (Tue), udang (Thu)')
  })
})

describe('deriveWeekPrepTasks', () => {
  it('combines per-dish tasks and the weekend batch', () => {
    const planned = [
      dish({ dish_id: '1', dish_name: 'Ayam frozen', cook_date: '2026-08-25', prep_type: 'thaw', protein: 'ayam' }),
      dish({ dish_id: '2', dish_name: 'Ayam bumbu bakar', cook_date: '2026-08-26', prep_type: 'marinate', prep_lead_days: 1 }),
    ]
    const all = deriveWeekPrepTasks('2026-08-24', planned)
    expect(all).toHaveLength(2)
    expect(all.some(t => t.prep_type === 'thaw_batch')).toBe(true)
    expect(all.some(t => t.prep_type === 'marinate')).toBe(true)
  })
  it('omits the batch entirely when nothing needs thawing', () => {
    const planned = [dish({ dish_id: '1', dish_name: 'Ayam bumbu bakar', cook_date: '2026-08-26', prep_type: 'marinate', prep_lead_days: 1 })]
    expect(deriveWeekPrepTasks('2026-08-24', planned)).toHaveLength(1)
  })
})
