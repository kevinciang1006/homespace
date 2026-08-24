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
    veg_portions: 0, fruit_portions: 0, fruit_context: null, cadence: null, produce_role: null, ...over,
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

describe('pickDessertBatch (cake gating)', () => {
  it('excludes dessert_cake dishes entirely when cakeEligible is false', () => {
    const staple = dish({ id: 's', produce_role: 'dessert_batch' })
    const cake = dish({ id: 'c', produce_role: 'dessert_cake' })
    const batch = pickDessertBatch([staple, cake], [], 2, seq([0.1, 0.9]), { cakeEligible: false })
    expect(batch.map(d => d.id)).toEqual(['s'])
  })
  it('allows a cake to fill a slot when cakeEligible is true, even though it rarely wins', () => {
    const staple = dish({ id: 's', produce_role: 'dessert_batch', rating: 3 })
    const cake = dish({ id: 'c', produce_role: 'dessert_cake', rating: 3 })
    // With only 2 candidates and a cap of 2, both must be picked regardless of weight —
    // the low cake weight only affects which is picked FIRST among >2 candidates.
    const batch = pickDessertBatch([staple, cake], [], 2, seq([0.99, 0.99]), { cakeEligible: true })
    expect(batch.map(d => d.id).sort()).toEqual(['c', 's'])
  })
  it('a low-weighted cake rarely wins over a normal-weighted staple when there are more candidates than the cap', () => {
    const cake = dish({ id: 'cake', produce_role: 'dessert_cake', rating: 5 })
    const staples = [dish({ id: 's1', produce_role: 'dessert_batch', rating: 3 }), dish({ id: 's2', produce_role: 'dessert_batch', rating: 3 })]
    // rng near 0 always lands in the first (heaviest-weighted-first) bucket; with the cake's
    // weight multiplied down, a low rng value should still land on a staple, not the cake.
    const batch = pickDessertBatch([cake, ...staples], [], 1, seq([0.99]), { cakeEligible: true })
    expect(batch[0].id).not.toBe('cake')
  })
})

describe('pickDessertBatch (cross-week memory)', () => {
  it('deprioritizes a dish that was in last week\'s batch when more candidates exist than the cap', () => {
    const repeated = dish({ id: 'r', produce_role: 'dessert_batch', rating: 3 })
    const fresh = dish({ id: 'f', produce_role: 'dessert_batch', rating: 3 })
    const batch = pickDessertBatch([repeated, fresh], [], 1, seq([0.4]), { lastWeekBatchIds: ['r'] })
    expect(batch[0].id).toBe('f')
  })
  it('still includes a repeated dish when the cap requires it (pool == cap)', () => {
    const repeated = dish({ id: 'r', produce_role: 'dessert_batch' })
    const fresh = dish({ id: 'f', produce_role: 'dessert_batch' })
    const batch = pickDessertBatch([repeated, fresh], [], 2, seq([0.99]), { lastWeekBatchIds: ['r'] })
    expect(batch.map(d => d.id).sort()).toEqual(['f', 'r'])
  })
})
