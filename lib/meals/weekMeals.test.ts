import { describe, it, expect } from 'vitest'
import { buildWeekMealsSummary } from './weekMeals'

describe('buildWeekMealsSummary', () => {
  const weekStart = '2026-08-24' // Monday

  it('splits the main dish from supporting dishes per day', () => {
    const out = buildWeekMealsSummary(weekStart, [
      { plan_date: '2026-08-24', dish_name: 'Ayam bumbu bakar', role: 'main', skipped: false },
      { plan_date: '2026-08-24', dish_name: 'Tahu goreng', role: 'support', skipped: false },
      { plan_date: '2026-08-24', dish_name: 'Bayam tumis', role: 'support', skipped: false },
    ])
    expect(out[0]).toEqual({ date: '2026-08-24', main: 'Ayam bumbu bakar', supports: ['Tahu goreng', 'Bayam tumis'] })
  })

  it('covers all 7 days of the week even with no plans', () => {
    const out = buildWeekMealsSummary(weekStart, [])
    expect(out).toHaveLength(7)
    expect(out.every(d => d.main === null && d.supports.length === 0)).toBe(true)
  })

  it('ignores skipped rows and rows with no dish_name', () => {
    const out = buildWeekMealsSummary(weekStart, [
      { plan_date: '2026-08-25', dish_name: 'Rendang ayam', role: 'main', skipped: true },
      { plan_date: '2026-08-25', dish_name: null, role: 'support', skipped: false },
    ])
    expect(out[1]).toEqual({ date: '2026-08-25', main: null, supports: [] })
  })

  it('falls back to no main if no row has role "main" (supports still listed)', () => {
    const out = buildWeekMealsSummary(weekStart, [
      { plan_date: '2026-08-26', dish_name: 'Kentang goreng', role: 'support', skipped: false },
    ])
    expect(out[2]).toEqual({ date: '2026-08-26', main: null, supports: ['Kentang goreng'] })
  })
})
