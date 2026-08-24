import { describe, it, expect } from 'vitest'
import type { Dish } from './types'
import { pickDessertBatch } from './dessert'

function dish(over: Partial<Dish> & { id: string }): Dish {
  return {
    name: over.id, slot: 'desert', protein: 'none', tier: 'everyday', method: null,
    spicy: false, rating: 3, active: true, no_repeat_days: null,
    ingredients: null, recipe_steps: null, recipe_image_url: null,
    richness: 'medium', provides_soup: false, saltiness: 'normal', difficulty: 'medium',
    is_garnish: false, recipe_links: null, qty_amount: null, qty_unit: null, qty_note: null,
    veg_portions: 0, fruit_portions: 0, fruit_context: null, ...over,
  } as Dish
}
const seq = (vals: number[]) => { let i = 0; return () => vals[i++ % vals.length] }

describe('pickDessertBatch', () => {
  it('picks exactly `cap` dishes when the pool is larger', () => {
    const pool = [dish({ id: 'a' }), dish({ id: 'b' }), dish({ id: 'c' }), dish({ id: 'd' })]
    const batch = pickDessertBatch(pool, [], 3, seq([0.1, 0.5, 0.9]))
    expect(batch.length).toBe(3)
    expect(new Set(batch.map(d => d.id)).size).toBe(3) // no duplicates
  })
  it('returns the whole pool when it is smaller than the cap', () => {
    const pool = [dish({ id: 'a' }), dish({ id: 'b' })]
    const batch = pickDessertBatch(pool, [], 3, seq([0.5]))
    expect(batch.map(d => d.id).sort()).toEqual(['a', 'b'])
  })
  it('always keeps mustInclude ids, filling the rest of the cap from the pool', () => {
    const pool = [dish({ id: 'a' }), dish({ id: 'b' }), dish({ id: 'c' }), dish({ id: 'd' })]
    const batch = pickDessertBatch(pool, ['d'], 2, seq([0.1]))
    expect(batch.map(d => d.id)).toContain('d')
    expect(batch.length).toBe(2)
  })
  it('excludes inactive and garnish dishes', () => {
    const pool = [dish({ id: 'a', active: false }), dish({ id: 'b', is_garnish: true }), dish({ id: 'c' })]
    const batch = pickDessertBatch(pool, [], 3, seq([0.5]))
    expect(batch.map(d => d.id)).toEqual(['c'])
  })
})
