import { describe, it, expect } from 'vitest'
import type { Dish } from './types'
import { computeCakeEligible, computeLastWeekBatchIds, computeMonthlyFruitEligible, type DessertHistoryRow } from './dessertHistory'

describe('computeCakeEligible', () => {
  it('is eligible when no cake appears in the history at all', () => {
    expect(computeCakeEligible([], '2026-08-24')).toBe(true)
  })
  it('is ineligible when a cake appeared within the cooldown window', () => {
    const history: DessertHistoryRow[] = [{ week_start: '2026-08-10', dish_id: 'brownie', kind: 'dessert_cake' }]
    expect(computeCakeEligible(history, '2026-08-24', 3)).toBe(false)
  })
  it('is eligible again once the cake is outside the cooldown window', () => {
    const history: DessertHistoryRow[] = [{ week_start: '2026-07-27', dish_id: 'brownie', kind: 'dessert_cake' }]
    expect(computeCakeEligible(history, '2026-08-24', 3)).toBe(true)
  })
  it('ignores a dessert_batch (non-cake) row in the same window', () => {
    const history: DessertHistoryRow[] = [{ week_start: '2026-08-17', dish_id: 'kacang-ijo', kind: 'dessert_batch' }]
    expect(computeCakeEligible(history, '2026-08-24', 3)).toBe(true)
  })
})

describe('computeLastWeekBatchIds', () => {
  it('returns dish_ids from exactly the immediately preceding week', () => {
    const history: DessertHistoryRow[] = [
      { week_start: '2026-08-17', dish_id: 'kacang-ijo', kind: 'dessert_batch' },
      { week_start: '2026-08-17', dish_id: 'yogurt', kind: 'dessert_batch' },
      { week_start: '2026-08-10', dish_id: 'stale', kind: 'dessert_batch' },
    ]
    expect(computeLastWeekBatchIds(history, '2026-08-24').sort()).toEqual(['kacang-ijo', 'yogurt'])
  })
  it('includes a cake row from last week too', () => {
    const history: DessertHistoryRow[] = [{ week_start: '2026-08-17', dish_id: 'brownie', kind: 'dessert_cake' }]
    expect(computeLastWeekBatchIds(history, '2026-08-24')).toEqual(['brownie'])
  })
  it('returns empty when there is no history for last week', () => {
    expect(computeLastWeekBatchIds([], '2026-08-24')).toEqual([])
  })
})

function dish(over: Partial<Dish> & { id: string }): Dish {
  return {
    name: over.id, slot: 'fruit', protein: 'none', tier: 'everyday', method: null,
    spicy: false, rating: 3, active: true, no_repeat_days: null,
    ingredients: null, recipe_steps: null, recipe_image_url: null,
    richness: 'medium', provides_soup: false, saltiness: 'normal', difficulty: 'medium',
    is_garnish: false, recipe_links: null, qty_amount: null, qty_unit: null, qty_note: null,
    veg_portions: 0, fruit_portions: 1, fruit_context: null, cadence: null, produce_role: null, ...over,
  } as Dish
}

describe('computeMonthlyFruitEligible', () => {
  it('is eligible when no monthly evening-fruit appears in the history', () => {
    const dishById = new Map([['apple', dish({ id: 'apple', cadence: 'monthly' })]])
    expect(computeMonthlyFruitEligible([], '2026-08-24', dishById)).toBe(true)
  })
  it('is ineligible when a monthly-cadence fruit was shown within the cooldown window', () => {
    const dishById = new Map([['apple', dish({ id: 'apple', cadence: 'monthly' })]])
    const history: DessertHistoryRow[] = [{ week_start: '2026-08-17', dish_id: 'apple', kind: 'evening_fruit' }]
    expect(computeMonthlyFruitEligible(history, '2026-08-24', dishById, 2)).toBe(false)
  })
  it('ignores an occasional-cadence fruit in the history', () => {
    const dishById = new Map([['semangka', dish({ id: 'semangka', cadence: 'occasional' })]])
    const history: DessertHistoryRow[] = [{ week_start: '2026-08-17', dish_id: 'semangka', kind: 'evening_fruit' }]
    expect(computeMonthlyFruitEligible(history, '2026-08-24', dishById, 2)).toBe(true)
  })
  it('is eligible again once the monthly fruit is outside the cooldown window', () => {
    const dishById = new Map([['apple', dish({ id: 'apple', cadence: 'monthly' })]])
    const history: DessertHistoryRow[] = [{ week_start: '2026-08-03', dish_id: 'apple', kind: 'evening_fruit' }]
    expect(computeMonthlyFruitEligible(history, '2026-08-24', dishById, 2)).toBe(true)
  })
})
