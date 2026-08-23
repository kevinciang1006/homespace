import { describe, it, expect } from 'vitest'
import { groupPrepByDate, prepPhrase, type PrepCandidate } from './prep'

function candidate(over: Partial<PrepCandidate> & Pick<PrepCandidate, 'dish_id' | 'dish_name' | 'cook_date'>): PrepCandidate {
  return { needs_thaw: false, needs_marinate: false, prep_lead_days: null, prep_note: null, ...over }
}

describe('groupPrepByDate', () => {
  it('groups a dish under its computed prep date', () => {
    const rows = [candidate({ dish_id: '1', dish_name: 'Ayam', cook_date: '2026-08-24', needs_thaw: true, prep_lead_days: 1 })]
    const batches = groupPrepByDate(rows)
    expect(batches.get('2026-08-23')).toEqual([
      { dish_id: '1', dish_name: 'Ayam', cook_date: '2026-08-24', needs_thaw: true, needs_marinate: false, prep_note: null },
    ])
  })

  it('batches multiple dishes sharing the same computed prep date', () => {
    const rows = [
      candidate({ dish_id: '1', dish_name: 'Ayam', cook_date: '2026-08-25', needs_thaw: true, prep_lead_days: 1 }),
      candidate({ dish_id: '2', dish_name: 'Ikan', cook_date: '2026-08-25', needs_marinate: true, prep_lead_days: 1 }),
    ]
    expect(groupPrepByDate(rows).get('2026-08-24')).toHaveLength(2)
  })

  it('keeps dishes with different lead times in separate buckets', () => {
    const rows = [
      candidate({ dish_id: '1', dish_name: 'Ayam', cook_date: '2026-08-24', needs_thaw: true, prep_lead_days: 1 }),
      candidate({ dish_id: '2', dish_name: 'Babi', cook_date: '2026-08-27', needs_marinate: true, prep_lead_days: 3 }),
    ]
    const batches = groupPrepByDate(rows)
    expect(batches.get('2026-08-23')).toHaveLength(1)
    expect(batches.get('2026-08-24')).toHaveLength(1)
  })

  it('drops dishes needing neither thaw nor marinate', () => {
    const rows = [candidate({ dish_id: '1', dish_name: 'Nasi', cook_date: '2026-08-24' })]
    expect(groupPrepByDate(rows).size).toBe(0)
  })
})

describe('prepPhrase', () => {
  it('prefers prep_note when present', () => {
    expect(prepPhrase({ needs_thaw: true, needs_marinate: true, prep_note: 'tahan seminggu' })).toBe('tahan seminggu')
  })
  it('derives "thaw + marinate" when both flags are set', () => {
    expect(prepPhrase({ needs_thaw: true, needs_marinate: true, prep_note: null })).toBe('thaw + marinate')
  })
  it('derives "thaw" alone', () => {
    expect(prepPhrase({ needs_thaw: true, needs_marinate: false, prep_note: null })).toBe('thaw')
  })
  it('derives "marinate" alone', () => {
    expect(prepPhrase({ needs_thaw: false, needs_marinate: true, prep_note: null })).toBe('marinate')
  })
})
