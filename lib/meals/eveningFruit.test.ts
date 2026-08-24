import { describe, it, expect } from 'vitest'
import type { Dish } from './types'
import { pickEveningFruitBatch } from './eveningFruit'

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
const seq = (vals: number[]) => { let i = 0; return () => vals[i++ % vals.length] }

describe('pickEveningFruitBatch', () => {
  it('picks exactly `cap` dishes when the pool is larger', () => {
    const pool = [dish({ id: 'a' }), dish({ id: 'b' }), dish({ id: 'c' })]
    const batch = pickEveningFruitBatch(pool, [], 2, seq([0.1, 0.9]))
    expect(batch.length).toBe(2)
    expect(new Set(batch.map(d => d.id)).size).toBe(2)
  })
  it('returns the whole pool when it is smaller than the cap', () => {
    const pool = [dish({ id: 'a' })]
    const batch = pickEveningFruitBatch(pool, [], 2, seq([0.5]))
    expect(batch.map(d => d.id)).toEqual(['a'])
  })
  it('always keeps mustInclude ids', () => {
    const pool = [dish({ id: 'a' }), dish({ id: 'b' }), dish({ id: 'c' })]
    const batch = pickEveningFruitBatch(pool, ['c'], 1, seq([0.1]))
    expect(batch.map(d => d.id)).toEqual(['c'])
  })
  it('excludes inactive and garnish dishes', () => {
    const pool = [dish({ id: 'a', active: false }), dish({ id: 'b', is_garnish: true }), dish({ id: 'c' })]
    const batch = pickEveningFruitBatch(pool, [], 2, seq([0.5]))
    expect(batch.map(d => d.id)).toEqual(['c'])
  })
  it('excludes monthly-cadence fruit when monthlyEligible is false', () => {
    const monthly = dish({ id: 'm', cadence: 'monthly' })
    const occasional = dish({ id: 'o', cadence: 'occasional' })
    const batch = pickEveningFruitBatch([monthly, occasional], [], 2, seq([0.1]), { monthlyEligible: false })
    expect(batch.map(d => d.id)).toEqual(['o'])
  })
  it('includes monthly-cadence fruit when monthlyEligible is true', () => {
    const monthly = dish({ id: 'm', cadence: 'monthly' })
    const batch = pickEveningFruitBatch([monthly], [], 2, seq([0.5]), { monthlyEligible: true })
    expect(batch.map(d => d.id)).toEqual(['m'])
  })
  it('deprioritizes an occasional-cadence fruit relative to a monthly one of equal rating', () => {
    const monthly = dish({ id: 'm', cadence: 'monthly', rating: 3 })
    const occasional = dish({ id: 'o', cadence: 'occasional', rating: 3 })
    // rng landing near the end of the combined weight range should favor the
    // heavier (monthly) candidate over the deprioritized occasional one.
    const batch = pickEveningFruitBatch([occasional, monthly], [], 1, seq([0.9]))
    expect(batch[0].id).toBe('m')
  })
})
