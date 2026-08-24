import { describe, it, expect } from 'vitest'
import type { Dish, MealPlan, Pick, Slot } from './types'
import {
  noRepeatOk, proteinOk, proteinClashOk, specialOk, friedOk, spicyOk, passesHardRules,
  type PickContext,
} from './engine'

function dish(over: Partial<Dish> & { id: string; slot: Slot }): Dish {
  return {
    name: over.id, protein: 'chicken', tier: 'everyday', method: null,
    spicy: false, rating: 3, active: true, no_repeat_days: null,
    ingredients: null, recipe_steps: null, recipe_image_url: null,
    richness: 'medium', provides_soup: false,
    saltiness: 'normal', difficulty: 'medium', is_garnish: false, fruit_context: null, ...over,
  } as Dish
}
function plan(over: Partial<MealPlan> & { plan_date: string; slot: Slot }): MealPlan {
  return { id: 'p-' + Math.random(), dish_id: null, dish_name: null, locked: false,
    role: 'support', skipped: false, ...over } as MealPlan
}
function pick(over: Partial<Pick> & { plan_date: string; slot: Slot }): Pick {
  return { dish_id: null, dish_name: null, locked: false, role: 'support', skipped: false, ...over } as Pick
}

function ctx(over: Partial<PickContext> & { date: string; slot: Slot; dishes: Dish[] }): PickContext {
  const dishById = new Map(over.dishes.map(d => [d.id, d]))
  return {
    date: over.date, slot: over.slot,
    priorPlans: over.priorPlans ?? [], runPicks: over.runPicks ?? [],
    dishById, specialDays: over.specialDays ?? new Set(),
    hardDays: over.hardDays ?? new Set<string>(),
    relax: over.relax ?? { spicy: false, fried: false, hardDay: false, hardSpacing: false, proteinClash: false, spicyMainSpacing: false, noRepeatFactor: 1 },
    role: over.role ?? 'support', spicyFloor: over.spicyFloor ?? 1,
    plannedRemaining: over.plannedRemaining ?? 5,
  }
}

describe('noRepeatOk', () => {
  it('rejects a dish used within its window in prior plans', () => {
    const d = dish({ id: 'a', slot: 'kuah' }) // default window 7
    const c = ctx({ date: '2026-08-13', slot: 'kuah', dishes: [d],
      priorPlans: [plan({ plan_date: '2026-08-10', slot: 'kuah', dish_id: 'a' })] })
    expect(noRepeatOk(d, c)).toBe(false)
  })
  it('allows a dish used outside its window', () => {
    const d = dish({ id: 'a', slot: 'kuah' })
    const c = ctx({ date: '2026-08-13', slot: 'kuah', dishes: [d],
      priorPlans: [plan({ plan_date: '2026-08-01', slot: 'kuah', dish_id: 'a' })] })
    expect(noRepeatOk(d, c)).toBe(true)
  })
  it('also checks picks made earlier this run', () => {
    const d = dish({ id: 'a', slot: 'kuah' })
    const c = ctx({ date: '2026-08-13', slot: 'kuah', dishes: [d],
      runPicks: [pick({ plan_date: '2026-08-12', slot: 'kuah', dish_id: 'a' })] })
    expect(noRepeatOk(d, c)).toBe(false)
  })
  it('uses dish.no_repeat_days when set', () => {
    const d = dish({ id: 'a', slot: 'desert', no_repeat_days: 2 })
    const c = ctx({ date: '2026-08-13', slot: 'desert', dishes: [d],
      priorPlans: [plan({ plan_date: '2026-08-10', slot: 'desert', dish_id: 'a' })] })
    expect(noRepeatOk(d, c)).toBe(true) // 3 days >= 2
  })
})

describe('proteinOk', () => {
  it('rejects utama whose protein equals previous day utama protein', () => {
    const beef = dish({ id: 'b', slot: 'utama', protein: 'beef' })
    const c = ctx({ date: '2026-08-13', slot: 'utama', dishes: [beef],
      runPicks: [pick({ plan_date: '2026-08-12', slot: 'utama', dish_id: 'x' })],
    })
    c.dishById.set('x', dish({ id: 'x', slot: 'utama', protein: 'beef' }))
    expect(proteinOk(beef, c)).toBe(false)
  })
  it('allows non-utama slots regardless', () => {
    const d = dish({ id: 'k', slot: 'kuah', protein: 'beef' })
    const c = ctx({ date: '2026-08-13', slot: 'kuah', dishes: [d] })
    expect(proteinOk(d, c)).toBe(true)
  })
})

describe('proteinClashOk (no two dishes share a real protein on a plate)', () => {
  function withMain(mainProtein: string) {
    const c = ctx({ date: '2026-08-13', slot: 'pelengkap', dishes: [],
      runPicks: [pick({ plan_date: '2026-08-13', slot: 'utama', dish_id: 'm', role: 'main' })] })
    c.dishById.set('m', dish({ id: 'm', slot: 'utama', protein: mainProtein }))
    return c
  }
  it('rejects a support whose protein matches the chicken main', () => {
    const support = dish({ id: 's', slot: 'pelengkap', protein: 'chicken' })
    expect(proteinClashOk(support, withMain('chicken'))).toBe(false)
  })
  it('allows a support with a different meat protein', () => {
    const support = dish({ id: 's', slot: 'pelengkap', protein: 'beef' })
    expect(proteinClashOk(support, withMain('chicken'))).toBe(true)
  })
  it('treats none/egg/tofu_tempe as neutral — never clashes', () => {
    for (const p of ['none', 'egg', 'tofu_tempe', 'mixed']) {
      const support = dish({ id: 's', slot: 'pelengkap', protein: p })
      // even against a same-named neutral main, no clash
      expect(proteinClashOk(support, withMain(p))).toBe(true)
    }
  })
  it('is pairwise — rejects a 2nd support clashing with an earlier support, not the main', () => {
    const support = dish({ id: 's2', slot: 'sayuran', protein: 'beef' })
    const c = ctx({ date: '2026-08-13', slot: 'sayuran', dishes: [],
      runPicks: [
        pick({ plan_date: '2026-08-13', slot: 'utama', dish_id: 'm', role: 'main' }),
        pick({ plan_date: '2026-08-13', slot: 'pelengkap', dish_id: 's1' }),
      ] })
    c.dishById.set('m', dish({ id: 'm', slot: 'utama', protein: 'chicken' }))
    c.dishById.set('s1', dish({ id: 's1', slot: 'pelengkap', protein: 'beef' }))
    expect(proteinClashOk(support, c)).toBe(false)
  })
  it('is relaxable via relax.proteinClash', () => {
    const support = dish({ id: 's', slot: 'pelengkap', protein: 'chicken' })
    const c = withMain('chicken')
    c.relax = { ...c.relax, proteinClash: true }
    expect(proteinClashOk(support, c)).toBe(true)
  })
})

describe('specialOk', () => {
  it('rejects special utama on a non-special day', () => {
    const d = dish({ id: 's', slot: 'utama', tier: 'special' })
    const c = ctx({ date: '2026-08-13', slot: 'utama', dishes: [d], specialDays: new Set() })
    expect(specialOk(d, c)).toBe(false)
  })
  it('allows special utama on a special day when no other special that day', () => {
    const d = dish({ id: 's', slot: 'utama', tier: 'special' })
    const c = ctx({ date: '2026-08-13', slot: 'utama', dishes: [d],
      specialDays: new Set(['2026-08-13']) })
    expect(specialOk(d, c)).toBe(true)
  })
  it('forces a special-tier utama on a pre-assigned special day', () => {
    const everyday = dish({ id: 'e', slot: 'utama', tier: 'everyday' })
    const special = dish({ id: 's', slot: 'utama', tier: 'special' })
    const c = ctx({ date: '2026-08-13', slot: 'utama', dishes: [everyday, special],
      specialDays: new Set(['2026-08-13']) })
    expect(specialOk(everyday, c)).toBe(false) // everyday not allowed on a special day
    expect(specialOk(special, c)).toBe(true)
  })
  it('rejects any special when the day already has a special', () => {
    const kuahSpecial = dish({ id: 'ks', slot: 'kuah', tier: 'special' })
    const c = ctx({ date: '2026-08-13', slot: 'kuah', dishes: [kuahSpecial],
      runPicks: [pick({ plan_date: '2026-08-13', slot: 'utama', dish_id: 'us' })] })
    c.dishById.set('us', dish({ id: 'us', slot: 'utama', tier: 'special' }))
    expect(specialOk(kuahSpecial, c)).toBe(false)
  })
})

describe('friedOk', () => {
  it('rejects a 3rd fried dish on the same day', () => {
    const d = dish({ id: 'f3', slot: 'pelengkap', method: 'fried' })
    const c = ctx({ date: '2026-08-13', slot: 'pelengkap', dishes: [d],
      runPicks: [
        pick({ plan_date: '2026-08-13', slot: 'utama', dish_id: 'f1' }),
        pick({ plan_date: '2026-08-13', slot: 'kuah', dish_id: 'f2' }),
      ] })
    c.dishById.set('f1', dish({ id: 'f1', slot: 'utama', method: 'fried' }))
    c.dishById.set('f2', dish({ id: 'f2', slot: 'kuah', method: 'fried' }))
    expect(friedOk(d, c)).toBe(false)
  })
})

describe('spicyOk (floor of 1 non-spicy among main+supports)', () => {
  it('rejects a spicy dish that would make the plate all-spicy with none left', () => {
    const d = dish({ id: 'sp', slot: 'pelengkap', spicy: true })
    const c = ctx({ date: '2026-08-13', slot: 'pelengkap', dishes: [d],
      role: 'support', plannedRemaining: 0,
      runPicks: [pick({ plan_date: '2026-08-13', slot: 'utama', dish_id: 'm', role: 'main' })] })
    c.dishById.set('m', dish({ id: 'm', slot: 'utama', spicy: true }))
    expect(spicyOk(d, c)).toBe(false)
  })
  it('allows a spicy dish when a non-spicy pick still remains', () => {
    const d = dish({ id: 'sp', slot: 'utama', spicy: true })
    const c = ctx({ date: '2026-08-13', slot: 'utama', dishes: [d], role: 'main', plannedRemaining: 1 })
    expect(spicyOk(d, c)).toBe(true)
  })
  it('exempts the desert (optional role)', () => {
    const d = dish({ id: 'sp', slot: 'desert', spicy: true })
    const c = ctx({ date: '2026-08-13', slot: 'desert', dishes: [d], role: 'optional', plannedRemaining: 0 })
    expect(spicyOk(d, c)).toBe(true)
  })
  it('is not enforced when relax.spicy is true', () => {
    const d = dish({ id: 'sp', slot: 'pelengkap', spicy: true })
    const c = ctx({ date: '2026-08-13', slot: 'pelengkap', dishes: [d], role: 'support', plannedRemaining: 0,
      relax: { spicy: true, fried: false, hardDay: false, hardSpacing: false, proteinClash: false, spicyMainSpacing: false, noRepeatFactor: 1 } })
    expect(spicyOk(d, c)).toBe(true)
  })
})

import { freshnessFactor, weightFor, weightedPick, pickForSlot, type Rng } from './engine'

const seq = (vals: number[]): Rng => { let i = 0; return () => vals[i++ % vals.length] }

describe('freshnessFactor', () => {
  it('is 2 for a never-served dish', () => {
    const d = dish({ id: 'a', slot: 'kuah' })
    const c = ctx({ date: '2026-08-13', slot: 'kuah', dishes: [d] })
    expect(freshnessFactor(d, c)).toBe(2)
  })
  it('scales days_since_last / window, capped at 2 and floored at 1', () => {
    const d = dish({ id: 'a', slot: 'kuah' }) // window 7
    const c = ctx({ date: '2026-08-13', slot: 'kuah', dishes: [d],
      priorPlans: [plan({ plan_date: '2026-08-06', slot: 'kuah', dish_id: 'a' })] }) // 7 days
    expect(freshnessFactor(d, c)).toBe(1) // 7/7 = 1
  })
})

describe('weightFor', () => {
  it('is rating squared times freshness', () => {
    const d = dish({ id: 'a', slot: 'kuah', rating: 5 })
    const c = ctx({ date: '2026-08-13', slot: 'kuah', dishes: [d] })
    expect(weightFor(d, c)).toBe(25 * 2) // never served -> freshness 2
  })
})

describe('weightedPick', () => {
  it('is deterministic under a seeded rng', () => {
    const a = dish({ id: 'a', slot: 'kuah', rating: 1 })
    const b = dish({ id: 'b', slot: 'kuah', rating: 5 })
    const c = ctx({ date: '2026-08-13', slot: 'kuah', dishes: [a, b] })
    // rng near 1 lands in the heavier (b) bucket
    expect(weightedPick([a, b], c, seq([0.99]))?.id).toBe('b')
    expect(weightedPick([a, b], c, seq([0.0]))?.id).toBe('a')
  })
})

describe('pickForSlot relaxation ladder', () => {
  it('relaxes spicy floor when the only candidate is spicy', () => {
    const onlySpicy = dish({ id: 'sp', slot: 'pelengkap', spicy: true, protein: 'none' })
    // spicy main already placed, no more picks planned -> a spicy side breaks the floor at level 0
    // (neutral proteins keep the protein-clash rule out of the way so only the spicy floor bites)
    const c = ctx({ date: '2026-08-13', slot: 'pelengkap', dishes: [onlySpicy],
      role: 'support', plannedRemaining: 0,
      runPicks: [pick({ plan_date: '2026-08-13', slot: 'utama', dish_id: 'm', role: 'main' })] })
    c.dishById.set('m', dish({ id: 'm', slot: 'utama', spicy: true, protein: 'none' }))
    const result = pickForSlot([onlySpicy], c, seq([0.5]))
    expect(result.dish_id).toBe('sp')
    expect(result.note).toContain('spicy')
  })
  it('returns a null pick with a note when no dish exists at all', () => {
    const c = ctx({ date: '2026-08-13', slot: 'desert', dishes: [] })
    const result = pickForSlot([], c, seq([0.5]))
    expect(result.dish_id).toBeNull()
    expect(result.note).toBeTruthy()
  })
})

import { preassignSpecialDays, generateWeek, composeDay } from './engine'
import type { Role } from './types'

const WEEK = ['2026-08-10','2026-08-11','2026-08-12','2026-08-13','2026-08-14','2026-08-15','2026-08-16']

describe('preassignSpecialDays', () => {
  it('returns exactly 2 non-adjacent days', () => {
    const specialUtama = [dish({ id: 'su', slot: 'utama', tier: 'special' })]
    const dishById = new Map(specialUtama.map(d => [d.id, d]))
    const days = preassignSpecialDays(WEEK, [], dishById, seq([0.1, 0.4, 0.7, 0.2, 0.9, 0.3, 0.6]))
    expect(days.size).toBe(2)
    const idx = [...days].map(d => WEEK.indexOf(d)).sort((a,b)=>a-b)
    expect(idx[1] - idx[0]).toBeGreaterThanOrEqual(2)
  })
  it('honors a locked special utama day', () => {
    const dishById = new Map([['su', dish({ id: 'su', slot: 'utama', tier: 'special' })]])
    const locked = [plan({ plan_date: '2026-08-13', slot: 'utama', dish_id: 'su', locked: true })]
    const days = preassignSpecialDays(WEEK, locked, dishById, seq([0.5]))
    expect(days.has('2026-08-13')).toBe(true)
  })
})

import { preassignBreakfastSpecialDays, breakfastSpecialOk, breakfastCandidates, pickBreakfast } from './engine'

describe('preassignBreakfastSpecialDays', () => {
  it('returns exactly 2 non-adjacent days', () => {
    const dishById = new Map([['sb', dish({ id: 'sb', slot: 'breakfast', tier: 'special' })]])
    const days = preassignBreakfastSpecialDays(WEEK, [], dishById, seq([0.1, 0.4, 0.7, 0.2, 0.9, 0.3, 0.6]))
    expect(days.size).toBe(2)
    const idx = [...days].map(d => WEEK.indexOf(d)).sort((a, b) => a - b)
    expect(idx[1] - idx[0]).toBeGreaterThanOrEqual(2)
  })
  it('honors a locked special breakfast day', () => {
    const dishById = new Map([['sb', dish({ id: 'sb', slot: 'breakfast', tier: 'special' })]])
    const locked = [plan({ plan_date: '2026-08-13', slot: 'breakfast', dish_id: 'sb', locked: true })]
    const days = preassignBreakfastSpecialDays(WEEK, locked, dishById, seq([0.5]))
    expect(days.has('2026-08-13')).toBe(true)
  })
  it('ignores a locked special DINNER dish — independent of the dinner quota', () => {
    const dishById = new Map([
      ['su', dish({ id: 'su', slot: 'utama', tier: 'special' })],
      ['bf', dish({ id: 'bf', slot: 'breakfast', tier: 'special' })],
    ])
    const locked = [plan({ plan_date: '2026-08-13', slot: 'utama', dish_id: 'su', locked: true })]
    const days = preassignBreakfastSpecialDays(WEEK, locked, dishById, seq([0.5]))
    expect(days.has('2026-08-13')).toBe(false)
  })
  it('returns an empty set when the breakfast pool has no special dishes', () => {
    const dishById = new Map([['bf', dish({ id: 'bf', slot: 'breakfast', tier: 'everyday' })]])
    const days = preassignBreakfastSpecialDays(WEEK, [], dishById, seq([0.5]))
    expect(days.size).toBe(0)
  })
})

describe('breakfastSpecialOk', () => {
  it('requires a special dish on a special day', () => {
    const everyday = dish({ id: 'e', slot: 'breakfast', tier: 'everyday' })
    const special = dish({ id: 's', slot: 'breakfast', tier: 'special' })
    expect(breakfastSpecialOk(special, true)).toBe(true)
    expect(breakfastSpecialOk(everyday, true)).toBe(false)
  })
  it('forbids a special dish on a non-special day', () => {
    const everyday = dish({ id: 'e', slot: 'breakfast', tier: 'everyday' })
    const special = dish({ id: 's', slot: 'breakfast', tier: 'special' })
    expect(breakfastSpecialOk(everyday, false)).toBe(true)
    expect(breakfastSpecialOk(special, false)).toBe(false)
  })
})

describe('pickBreakfast', () => {
  const bfPool = () => [
    dish({ id: 'e1', slot: 'breakfast', tier: 'everyday' }),
    dish({ id: 'e2', slot: 'breakfast', tier: 'everyday' }),
    dish({ id: 's1', slot: 'breakfast', tier: 'special' }),
  ]
  it('only picks special-tier dishes on a special day', () => {
    const pool = bfPool()
    const c = ctx({ date: '2026-08-13', slot: 'breakfast', role: 'breakfast', dishes: pool })
    const p = pickBreakfast(pool, c, true, seq([0.5]))
    expect(p.dish_id).toBe('s1')
  })
  it('only picks everyday-tier dishes on a non-special day', () => {
    const pool = bfPool()
    const c = ctx({ date: '2026-08-13', slot: 'breakfast', role: 'breakfast', dishes: pool })
    const p = pickBreakfast(pool, c, false, seq([0.5]))
    expect(['e1', 'e2']).toContain(p.dish_id)
  })
  it('respects the no-repeat window before relaxing', () => {
    const pool = [dish({ id: 'e1', slot: 'breakfast', tier: 'everyday' }), dish({ id: 'e2', slot: 'breakfast', tier: 'everyday' })]
    const c = ctx({ date: '2026-08-13', slot: 'breakfast', role: 'breakfast', dishes: pool,
      priorPlans: [plan({ plan_date: '2026-08-11', slot: 'breakfast', dish_id: 'e1' })] }) // 2 days ago, window 4
    const p = pickBreakfast(pool, c, false, seq([0.5]))
    expect(p.dish_id).toBe('e2')
  })
  it('relaxes the no-repeat window rather than leaving the slot empty', () => {
    const pool = [dish({ id: 'e1', slot: 'breakfast', tier: 'everyday' })]
    const c = ctx({ date: '2026-08-13', slot: 'breakfast', role: 'breakfast', dishes: pool,
      priorPlans: [plan({ plan_date: '2026-08-11', slot: 'breakfast', dish_id: 'e1' })] }) // window 4 blocks; factor 0.5 -> window 2 allows (gap 2)
    const p = pickBreakfast(pool, c, false, seq([0.5]))
    expect(p.dish_id).toBe('e1')
  })
  it('returns dish_id null when the pool has no dish of the required tier', () => {
    const pool = [dish({ id: 'e1', slot: 'breakfast', tier: 'everyday' })]
    const c = ctx({ date: '2026-08-13', slot: 'breakfast', role: 'breakfast', dishes: pool })
    const p = pickBreakfast(pool, c, true, seq([0.5]))
    expect(p.dish_id).toBeNull()
  })
})

import { fruitPoolFor } from './engine'

describe('fruitPoolFor', () => {
  it('includes a dish with fruit_context "any" for either context', () => {
    const any1 = dish({ id: 'a', slot: 'fruit', fruit_context: 'any' })
    expect(fruitPoolFor('breakfast', [any1]).map(d => d.id)).toEqual(['a'])
    expect(fruitPoolFor('dessert', [any1]).map(d => d.id)).toEqual(['a'])
  })
  it('includes a dish with no context set for either context', () => {
    const noCtx = dish({ id: 'n', slot: 'fruit', fruit_context: null })
    expect(fruitPoolFor('breakfast', [noCtx]).map(d => d.id)).toEqual(['n'])
    expect(fruitPoolFor('dessert', [noCtx]).map(d => d.id)).toEqual(['n'])
  })
  it('excludes a context-specific dish from the other context', () => {
    const bfOnly = dish({ id: 'b', slot: 'fruit', fruit_context: 'breakfast' })
    expect(fruitPoolFor('breakfast', [bfOnly]).map(d => d.id)).toEqual(['b'])
    expect(fruitPoolFor('dessert', [bfOnly])).toEqual([])
  })
  it('excludes garnish and inactive dishes', () => {
    const garnish = dish({ id: 'g', slot: 'fruit', fruit_context: 'any', is_garnish: true })
    const inactive = dish({ id: 'i', slot: 'fruit', fruit_context: 'any', active: false })
    expect(fruitPoolFor('breakfast', [garnish, inactive])).toEqual([])
  })
})

import { pickDessertForDay } from './engine'

describe('pickDessertForDay', () => {
  it('returns a skipped null pick when the batch is empty', () => {
    const c = ctx({ date: '2026-08-13', slot: 'desert', dishes: [] })
    const p = pickDessertForDay([], c, seq([0.5]))
    expect(p.dish_id).toBeNull()
    expect(p.skipped).toBe(true)
  })
  it('avoids a batch item used within the short repeat window', () => {
    const a = dish({ id: 'a', slot: 'desert' })
    const b = dish({ id: 'b', slot: 'desert' })
    const c = ctx({ date: '2026-08-13', slot: 'desert', dishes: [a, b],
      runPicks: [pick({ plan_date: '2026-08-12', slot: 'desert', dish_id: 'a' })] })
    const p = pickDessertForDay([a, b], c, seq([0.5]))
    expect(p.dish_id).toBe('b')
  })
  it('relaxes to allow a repeat when every batch item was used recently', () => {
    const a = dish({ id: 'a', slot: 'desert' })
    const c = ctx({ date: '2026-08-13', slot: 'desert', dishes: [a],
      runPicks: [pick({ plan_date: '2026-08-12', slot: 'desert', dish_id: 'a' })] })
    const p = pickDessertForDay([a], c, seq([0.5]))
    expect(p.dish_id).toBe('a')
  })
  it('checks priorPlans across the week boundary too', () => {
    const a = dish({ id: 'a', slot: 'desert' })
    const b = dish({ id: 'b', slot: 'desert' })
    const c = ctx({ date: '2026-08-13', slot: 'desert', dishes: [a, b],
      priorPlans: [plan({ plan_date: '2026-08-12', slot: 'desert', dish_id: 'a' })] })
    const p = pickDessertForDay([a, b], c, seq([0.5]))
    expect(p.dish_id).toBe('b')
  })
})

function pools() {
  const mk = (slot: Slot, n: number, over: Partial<Dish> = {}) =>
    Array.from({ length: n }, (_, i) => dish({ id: `${slot}-${i}`, slot, ...over,
      protein: slot === 'utama' ? ['beef','chicken','fish','egg','tofu_tempe','shrimp','duck'][i % 7] : 'none' }))
  return {
    breakfast: [] as Dish[], utama: mk('utama', 12), kuah: mk('kuah', 8), pelengkap: mk('pelengkap', 9),
    sayuran: mk('sayuran', 8), fruit: [] as Dish[], desert: mk('desert', 8),
  }
}

describe('composeDay (3-component plate)', () => {
  const run = (dishesBySlot: Record<Slot, Dish[]>) => {
    const dishById = new Map(Object.values(dishesBySlot).flat().map(d => [d.id, d]))
    return composeDay({ date: '2026-08-10', dishesBySlot, dishById, priorPlans: [], runPicks: [],
      lockedByCell: new Map(), specialDays: new Set(), hardDays: new Set(), breakfastSpecialDays: new Set(),
      dessertBatch: dishesBySlot.desert, rng: seq([0.3,0.6,0.1,0.8,0.5,0.2]) })
  }

  it('main that does NOT provide soup → main + sayuran + soup + desert, no pelengkap', () => {
    const p = pools(); p.utama.forEach(d => { d.provides_soup = false })
    const created = run(p)
    expect(created.filter(x => x.role === 'main' && x.slot === 'utama').length).toBe(1)
    expect(created.some(x => x.slot === 'sayuran' && x.dish_id)).toBe(true)
    expect(created.some(x => x.slot === 'kuah' && x.dish_id && !x.skipped)).toBe(true)
    expect(created.some(x => x.slot === 'desert' && x.role === 'optional')).toBe(true)
    expect(created.some(x => x.slot === 'pelengkap')).toBe(false)
  })

  it('main that provides soup → kuah slot becomes a SECOND sayuran (no separate soup), no pelengkap', () => {
    const p = pools(); p.utama.forEach(d => { d.provides_soup = true })
    const dishById = new Map(Object.values(p).flat().map(d => [d.id, d]))
    const created = composeDay({ date: '2026-08-10', dishesBySlot: p, dishById, priorPlans: [], runPicks: [],
      lockedByCell: new Map(), specialDays: new Set(), hardDays: new Set(), breakfastSpecialDays: new Set(),
      dessertBatch: p.desert, rng: seq([0.3,0.6,0.1,0.8,0.5,0.2]) })
    const kuah = created.find(x => x.slot === 'kuah')!
    expect(kuah.dish_id).toBeTruthy()          // freed slot is filled, not blanked
    expect(kuah.skipped).toBe(false)
    expect(dishById.get(kuah.dish_id!)!.slot).toBe('sayuran')   // it's a vegetable, not a soup
    // two DISTINCT vegetables on the plate (sayuran slot + the converted kuah slot)
    const vegIds = created.filter(x => (x.slot === 'sayuran' || x.slot === 'kuah') && x.dish_id).map(x => x.dish_id)
    expect(new Set(vegIds).size).toBe(2)
    // no actual soup dish anywhere
    expect(created.some(x => x.dish_id && dishById.get(x.dish_id)!.slot === 'kuah')).toBe(false)
    expect(created.some(x => x.slot === 'pelengkap')).toBe(false)
  })

  it('LOCKED provides-soup main (reshuffle case) → kuah still converts to a 2nd veg, no soup', () => {
    const p = pools()
    const tomyam = dish({ id: 'tomyam', slot: 'utama', name: 'Tomyam udang', protein: 'shrimp', provides_soup: true })
    p.utama = [tomyam, ...p.utama]
    const dishById = new Map(Object.values(p).flat().map(d => [d.id, d]))
    // simulate the day-reshuffle: main is LOCKED to Tomyam, everything else recomposes
    const lockedByCell = new Map([['2026-08-10|utama', { plan_date: '2026-08-10', slot: 'utama', dish_id: 'tomyam' } as MealPlan]])
    const runPicks: Pick[] = [pick({ plan_date: '2026-08-10', slot: 'utama', dish_id: 'tomyam', role: 'main', locked: true })]
    const created = composeDay({ date: '2026-08-10', dishesBySlot: p, dishById, priorPlans: [], runPicks,
      lockedByCell, specialDays: new Set(), hardDays: new Set(), breakfastSpecialDays: new Set(),
      dessertBatch: p.desert, rng: seq([0.3,0.6,0.1,0.8,0.5,0.2]) })
    const kuah = created.find(x => x.slot === 'kuah')!
    expect(kuah.dish_id).toBeTruthy()
    expect(dishById.get(kuah.dish_id!)!.slot).toBe('sayuran')   // second veg, not a soup
    expect(created.some(x => x.dish_id && dishById.get(x.dish_id)!.slot === 'kuah')).toBe(false)
  })

  it('provides-soup main with no second veg available → kuah falls back to the broth note', () => {
    const p = pools(); p.utama.forEach(d => { d.provides_soup = true })
    p.sayuran = [dish({ id: 'only-veg', slot: 'sayuran', protein: 'none' })]  // single veg → no distinct second
    const dishById = new Map(Object.values(p).flat().map(d => [d.id, d]))
    const created = composeDay({ date: '2026-08-10', dishesBySlot: p, dishById, priorPlans: [], runPicks: [],
      lockedByCell: new Map(), specialDays: new Set(), hardDays: new Set(), breakfastSpecialDays: new Set(),
      dessertBatch: p.desert, rng: seq([0.3,0.6,0.1,0.8,0.5,0.2]) })
    const kuah = created.find(x => x.slot === 'kuah')!
    expect(kuah.skipped).toBe(true)            // broth note fallback
    expect(kuah.dish_id).toBeNull()
    expect(created.some(x => x.dish_id && dishById.get(x.dish_id)!.slot === 'kuah')).toBe(false)  // never a stranded soup
  })
})

describe('composeDay (breakfast + evening fruit)', () => {
  const withBreakfastAndFruit = (): Record<Slot, Dish[]> => ({
    ...pools(),
    breakfast: [
      dish({ id: 'bf-e1', slot: 'breakfast', tier: 'everyday' }),
      dish({ id: 'bf-e2', slot: 'breakfast', tier: 'everyday' }),
    ],
    fruit: [
      dish({ id: 'fr-1', slot: 'fruit', tier: 'everyday', protein: 'none' }),
      dish({ id: 'fr-2', slot: 'fruit', tier: 'everyday', protein: 'none' }),
    ],
  })
  const run = (dishesBySlot: Record<Slot, Dish[]>, breakfastSpecialDays = new Set<string>(), lockedByCell = new Map<string, MealPlan>()) => {
    const dishById = new Map(Object.values(dishesBySlot).flat().map(d => [d.id, d]))
    return composeDay({ date: '2026-08-10', dishesBySlot, dishById, priorPlans: [], runPicks: [],
      lockedByCell, specialDays: new Set(), hardDays: new Set(), breakfastSpecialDays,
      dessertBatch: dishesBySlot.desert, rng: seq([0.3,0.6,0.1,0.8,0.5,0.2,0.9,0.4]) })
  }

  it('adds a breakfast dish and a breakfast-fruit pairing alongside the dinner plate', () => {
    const created = run(withBreakfastAndFruit())
    expect(created.filter(x => x.slot === 'breakfast').length).toBe(1)
    expect(created.find(x => x.slot === 'breakfast')!.dish_id).toBeTruthy()
    const bfFruit = created.find(x => x.slot === 'fruit' && x.role === 'breakfast')
    expect(bfFruit?.dish_id).toBeTruthy()
  })

  it('picks a special breakfast only on an assigned breakfastSpecialDays date', () => {
    const p = withBreakfastAndFruit()
    p.breakfast.push(dish({ id: 'bf-s1', slot: 'breakfast', tier: 'special' }))
    const dishById = new Map(Object.values(p).flat().map(d => [d.id, d]))
    const created = composeDay({ date: '2026-08-10', dishesBySlot: p, dishById, priorPlans: [], runPicks: [],
      lockedByCell: new Map(), specialDays: new Set(), hardDays: new Set(), breakfastSpecialDays: new Set(['2026-08-10']),
      dessertBatch: p.desert, rng: seq([0.3,0.6,0.1,0.8,0.5,0.2,0.9,0.4]) })
    const bf = created.find(x => x.slot === 'breakfast')!
    expect(dishById.get(bf.dish_id!)!.tier).toBe('special')
  })

  it('honors a locked breakfast and locked breakfast-fruit cell (does not overwrite them)', () => {
    const p = withBreakfastAndFruit()
    const lockedByCell = new Map<string, MealPlan>([
      ['2026-08-10|breakfast', { plan_date: '2026-08-10', slot: 'breakfast', role: 'breakfast', dish_id: 'bf-e1' } as MealPlan],
      ['2026-08-10|fruit|breakfast', { plan_date: '2026-08-10', slot: 'fruit', role: 'breakfast', dish_id: 'fr-1' } as MealPlan],
    ])
    const created = run(p, new Set(), lockedByCell)
    expect(created.some(x => x.slot === 'breakfast')).toBe(false)
    expect(created.some(x => x.slot === 'fruit' && x.role === 'breakfast')).toBe(false)
  })

  it('an empty breakfast/fruit pool produces a null-dish row rather than throwing', () => {
    const created = run(pools()) // breakfast: [], fruit: [] from the shared helper
    expect(created.find(x => x.slot === 'breakfast')!.dish_id).toBeNull()
    expect(created.find(x => x.slot === 'fruit' && x.role === 'breakfast')!.dish_id).toBeNull()
  })
})

describe('generateWeek (breakfast + fruit)', () => {
  it('gives every day exactly one breakfast and one evening fruit; breakfast specials are <=2/week non-adjacent', () => {
    const dishesBySlot = pools()
    dishesBySlot.utama[0].tier = 'special'; dishesBySlot.utama[1].tier = 'special'
    dishesBySlot.breakfast = [
      dish({ id: 'bf-e1', slot: 'breakfast', tier: 'everyday' }),
      dish({ id: 'bf-e2', slot: 'breakfast', tier: 'everyday' }),
      dish({ id: 'bf-e3', slot: 'breakfast', tier: 'everyday' }),
      dish({ id: 'bf-s1', slot: 'breakfast', tier: 'special' }),
    ]
    dishesBySlot.fruit = [
      dish({ id: 'fr-1', slot: 'fruit', tier: 'everyday', protein: 'none' }),
      dish({ id: 'fr-2', slot: 'fruit', tier: 'everyday', protein: 'none' }),
    ]
    const allDishes = Object.values(dishesBySlot).flat()
    const byId = new Map(allDishes.map(d => [d.id, d]))
    const picks = generateWeek({ weekStart: '2026-08-10', days: WEEK, dishesBySlot, allDishes,
      priorPlans: [], lockedCells: [], rng: seq([0.3,0.6,0.1,0.8,0.5,0.2,0.9,0.4,0.7,0.05]) })
    for (const date of WEEK) {
      const day = picks.filter(p => p.plan_date === date)
      expect(day.filter(p => p.slot === 'breakfast').length).toBe(1)
      expect(day.filter(p => p.slot === 'fruit' && p.role === 'breakfast').length).toBe(1)
      expect(day.filter(p => p.slot === 'fruit' && p.role === 'optional').length).toBe(1)
    }
    const bfSpecialDays = [...new Set(picks.filter(p => p.slot === 'breakfast' && byId.get(p.dish_id ?? '')?.tier === 'special').map(p => p.plan_date))]
    expect(bfSpecialDays.length).toBeLessThanOrEqual(2)
    const idx = bfSpecialDays.map(d => WEEK.indexOf(d)).sort((a, b) => a - b)
    if (idx.length === 2) expect(idx[1] - idx[0]).toBeGreaterThanOrEqual(2)
  })
})

describe('generateWeek (dessert batch)', () => {
  it('never uses more than DESSERT_WEEK_CAP distinct dessert dishes across the week', () => {
    const dishesBySlot = pools() // desert: mk('desert', 8) — 8 candidates, cap should still bind to 3
    const picks = generateWeek({ weekStart: '2026-08-10', days: WEEK, dishesBySlot,
      allDishes: Object.values(dishesBySlot).flat(), priorPlans: [], lockedCells: [],
      rng: seq([0.3,0.6,0.1,0.8,0.5,0.2,0.9,0.4,0.7,0.05]) })
    const dessertIds = new Set(picks.filter(p => p.slot === 'desert' && p.dish_id).map(p => p.dish_id))
    expect(dessertIds.size).toBeLessThanOrEqual(3)
  })
  it('keeps a locked dessert dish in the batch so other days can still show it', () => {
    const dishesBySlot = pools()
    const lockedDish = dishesBySlot.desert[5] // pick one not among the first weighted picks typically
    const locked = [{ id: 'L', plan_date: '2026-08-12', slot: 'desert' as Slot, dish_id: lockedDish.id,
      dish_name: lockedDish.name, locked: true, role: 'optional' as Role, skipped: false }]
    const picks = generateWeek({ weekStart: '2026-08-10', days: WEEK, dishesBySlot,
      allDishes: Object.values(dishesBySlot).flat(), priorPlans: [], lockedCells: locked,
      rng: seq([0.3,0.6,0.1,0.8,0.5,0.2,0.9,0.4,0.7,0.05]) })
    const lockedCell = picks.find(p => p.plan_date === '2026-08-12' && p.slot === 'desert')!
    expect(lockedCell.dish_id).toBe(lockedDish.id)
    expect(lockedCell.locked).toBe(true)
  })
})

describe('generateWeek (compose)', () => {
  it('each day has exactly one main and always a desert; specials 2/week non-adjacent', () => {
    const dishesBySlot = pools()
    dishesBySlot.utama[0].tier = 'special'; dishesBySlot.utama[1].tier = 'special'; dishesBySlot.utama[2].tier = 'special'
    const picks = generateWeek({ weekStart: '2026-08-10', days: WEEK, dishesBySlot,
      allDishes: Object.values(dishesBySlot).flat(), priorPlans: [], lockedCells: [],
      rng: seq([0.3,0.6,0.1,0.8,0.5,0.2,0.9,0.4,0.7,0.05]) })
    const byId = new Map(Object.values(dishesBySlot).flat().map(d => [d.id, d]))
    for (const date of WEEK) {
      const day = picks.filter(p => p.plan_date === date)
      expect(day.filter(p => p.role === 'main').length).toBe(1)
      expect(day.filter(p => p.slot === 'desert' && p.role === 'optional').length).toBe(1)
    }
    const specialDays = picks.filter(p => p.role === 'main' && byId.get(p.dish_id!)?.tier === 'special')
      .map(p => WEEK.indexOf(p.plan_date)).sort((a,b)=>a-b)
    expect(specialDays.length).toBe(2)
    expect(specialDays[1] - specialDays[0]).toBeGreaterThanOrEqual(2)
    expect(picks.some(p => p.slot === 'pelengkap' && p.dish_id)).toBe(false)
  })

  it('preserves a locked cell', () => {
    const dishesBySlot = pools()
    const locked = [{ id: 'L', plan_date: '2026-08-12', slot: 'sayuran' as Slot, dish_id: 'sayuran-3',
      dish_name: 'sayuran-3', locked: true, role: 'support' as Role, skipped: false }]
    const picks = generateWeek({ weekStart: '2026-08-10', days: WEEK, dishesBySlot,
      allDishes: Object.values(dishesBySlot).flat(), priorPlans: [], lockedCells: locked,
      rng: seq([0.3,0.6,0.1,0.8,0.5,0.2,0.9,0.4,0.7,0.05]) })
    const cell = picks.find(p => p.plan_date === '2026-08-12' && p.slot === 'sayuran')!
    expect(cell.dish_id).toBe('sayuran-3')
    expect(cell.locked).toBe(true)
  })

  it('provides-soup mains all week → validateWeek reports no separate-soup violation (Tomyam case)', () => {
    const dishesBySlot = pools()
    dishesBySlot.utama.forEach(d => { d.provides_soup = true })   // every main is wet (like Tomyam udang)
    const allDishes = Object.values(dishesBySlot).flat()
    const byId = new Map(allDishes.map(d => [d.id, d]))
    const picks = generateWeek({ weekStart: '2026-08-10', days: WEEK, dishesBySlot,
      allDishes, priorPlans: [], lockedCells: [], rng: seq([0.3,0.6,0.1,0.8,0.5,0.2,0.9,0.4,0.7,0.05]) })
    const report = validateWeek(picks.map(p => ({ plan_date: p.plan_date, dish_id: p.dish_id, skipped: p.skipped })), byId)
    expect(report.filter(v => v.includes('soup'))).toEqual([])            // no stranded soups
    for (const date of WEEK) {
      const day = picks.filter(p => p.plan_date === date && p.dish_id).map(p => byId.get(p.dish_id!)!)
      expect(day.some(d => d.slot === 'kuah')).toBe(false)               // never a real soup dish
      expect(day.filter(d => d.slot === 'sayuran').length).toBe(2)       // freed slot → a second vegetable
    }
  })
})

import { saltinessOk, difficultyOk, preassignHardDays } from './engine'

describe('saltinessOk (max 1 non-normal per day)', () => {
  it('allows a normal dish always', () => {
    const d = dish({ id: 'n', slot: 'utama', saltiness: 'normal' })
    expect(saltinessOk(d, ctx({ date: '2026-08-13', slot: 'utama', dishes: [d] }))).toBe(true)
  })
  it('rejects a 2nd non-normal dish on the same day', () => {
    const salty = dish({ id: 's', slot: 'pelengkap', saltiness: 'salty' })
    const c = ctx({ date: '2026-08-13', slot: 'pelengkap', dishes: [salty],
      runPicks: [pick({ plan_date: '2026-08-13', slot: 'utama', dish_id: 'v' })] })
    c.dishById.set('v', dish({ id: 'v', slot: 'utama', saltiness: 'very_salty' }))
    expect(saltinessOk(salty, c)).toBe(false)
  })
  it('treats very_salty the same as salty for the per-day cap', () => {
    const vs = dish({ id: 'vs', slot: 'pelengkap', saltiness: 'very_salty' })
    const c = ctx({ date: '2026-08-13', slot: 'pelengkap', dishes: [vs],
      runPicks: [pick({ plan_date: '2026-08-13', slot: 'utama', dish_id: 'sm' })] })
    c.dishById.set('sm', dish({ id: 'sm', slot: 'utama', saltiness: 'salty' }))
    expect(saltinessOk(vs, c)).toBe(false)
  })
})

describe('difficultyOk (hard: hard-days only, <=1/day, non-adjacent)', () => {
  it('non-hard dishes always pass', () => {
    const d = dish({ id: 'e', slot: 'utama', difficulty: 'easy' })
    expect(difficultyOk(d, ctx({ date: '2026-08-13', slot: 'utama', dishes: [d] }))).toBe(true)
  })
  it('rejects a hard dish off a hard-day', () => {
    const d = dish({ id: 'h', slot: 'utama', difficulty: 'hard' })
    const c = ctx({ date: '2026-08-13', slot: 'utama', dishes: [d], hardDays: new Set(['2026-08-11']) })
    expect(difficultyOk(d, c)).toBe(false)
  })
  it('allows a hard dish on a hard-day with no prior hard', () => {
    const d = dish({ id: 'h', slot: 'utama', difficulty: 'hard' })
    const c = ctx({ date: '2026-08-13', slot: 'utama', dishes: [d], hardDays: new Set(['2026-08-13']) })
    expect(difficultyOk(d, c)).toBe(true)
  })
  it('rejects a 2nd hard dish on the same day', () => {
    const d = dish({ id: 'h2', slot: 'pelengkap', difficulty: 'hard' })
    const c = ctx({ date: '2026-08-13', slot: 'pelengkap', dishes: [d], hardDays: new Set(['2026-08-13']),
      runPicks: [pick({ plan_date: '2026-08-13', slot: 'utama', dish_id: 'h1' })] })
    c.dishById.set('h1', dish({ id: 'h1', slot: 'utama', difficulty: 'hard' }))
    expect(difficultyOk(d, c)).toBe(false)
  })
  it('is relaxable via relax.hardDay', () => {
    const d = dish({ id: 'h', slot: 'utama', difficulty: 'hard' })
    const c = ctx({ date: '2026-08-13', slot: 'utama', dishes: [d], hardDays: new Set(),
      relax: { spicy: false, fried: false, hardDay: true, hardSpacing: true, proteinClash: false, spicyMainSpacing: false, noRepeatFactor: 1 } })
    expect(difficultyOk(d, c)).toBe(true)
  })
})

describe('preassignHardDays', () => {
  const WEEK2 = ['2026-08-10','2026-08-11','2026-08-12','2026-08-13','2026-08-14','2026-08-15','2026-08-16']
  it('includes the special days and tops up to 2 non-adjacent', () => {
    const hd = preassignHardDays(WEEK2, new Set(['2026-08-12']), seq([0.1,0.5,0.9,0.3,0.7,0.2]))
    expect(hd.has('2026-08-12')).toBe(true)
    expect(hd.size).toBe(2)
    const idx = [...hd].map(d => WEEK2.indexOf(d)).sort((a,b)=>a-b)
    expect(idx[1] - idx[0]).toBeGreaterThanOrEqual(2)
  })
  it('keeps 2 special days as-is', () => {
    const hd = preassignHardDays(WEEK2, new Set(['2026-08-10','2026-08-13']), seq([0.5]))
    expect([...hd].sort()).toEqual(['2026-08-10','2026-08-13'])
  })
})

describe('weightFor mild-main bias', () => {
  it('favors a normal-saltiness main over a very_salty one (equal rating)', () => {
    const normal = dish({ id: 'n', slot: 'utama', saltiness: 'normal', rating: 3 })
    const vs = dish({ id: 'v', slot: 'utama', saltiness: 'very_salty', rating: 3 })
    const c = ctx({ date: '2026-08-13', slot: 'utama', dishes: [normal, vs], role: 'main' })
    expect(weightFor(normal, c)).toBeGreaterThan(weightFor(vs, c))
  })
  it('does not bias non-main slots', () => {
    const normal = dish({ id: 'n', slot: 'pelengkap', saltiness: 'normal', rating: 3 })
    const vs = dish({ id: 'v', slot: 'pelengkap', saltiness: 'very_salty', rating: 3 })
    const c = ctx({ date: '2026-08-13', slot: 'pelengkap', dishes: [normal, vs], role: 'support' })
    expect(weightFor(normal, c)).toBe(weightFor(vs, c))
  })
})

describe('generateWeek (saltiness + difficulty)', () => {
  it('keeps <=2 hard/week on special, non-adjacent days and <=1 salty accent/day', () => {
    const mk = (slot: Slot, n: number, over: (i: number) => Partial<Dish> = () => ({})) =>
      Array.from({ length: n }, (_, i) => dish({ id: `${slot}-${i}`, slot, ...over(i),
        protein: slot === 'utama' ? ['beef','chicken','fish','egg','tofu_tempe','shrimp','duck'][i % 7] : 'none' }))
    const dishesBySlot = {
      breakfast: [] as Dish[],
      utama: mk('utama', 12, i => ({ tier: (i < 3 ? 'special' : 'everyday') as Dish['tier'], difficulty: (i < 4 ? 'hard' : 'medium') as Dish['difficulty'] })),
      kuah: mk('kuah', 8, i => ({ difficulty: (i === 0 ? 'hard' : 'easy') as Dish['difficulty'], saltiness: (i === 1 ? 'salty' : 'normal') as Dish['saltiness'] })),
      pelengkap: mk('pelengkap', 9, i => ({ saltiness: (i < 3 ? 'very_salty' : 'normal') as Dish['saltiness'] })),
      sayuran: mk('sayuran', 8), fruit: [] as Dish[], desert: mk('desert', 8),
    }
    const all = Object.values(dishesBySlot).flat()
    const byId = new Map(all.map(d => [d.id, d]))
    const picks = generateWeek({ weekStart: '2026-08-10', days: WEEK, dishesBySlot, allDishes: all,
      priorPlans: [], lockedCells: [], rng: seq([0.3,0.6,0.1,0.8,0.5,0.2,0.9,0.4,0.7,0.05]) })
    for (const date of WEEK) {
      const nonNormal = picks.filter(p => p.plan_date === date && !p.skipped && p.dish_id && byId.get(p.dish_id)!.saltiness !== 'normal')
      expect(nonNormal.length).toBeLessThanOrEqual(1)
    }
    const hardDates = [...new Set(picks.filter(p => byId.get(p.dish_id ?? '')?.difficulty === 'hard').map(p => WEEK.indexOf(p.plan_date)))].sort((a,b)=>a-b)
    expect(hardDates.length).toBeLessThanOrEqual(2)
    if (hardDates.length === 2) expect(hardDates[1] - hardDates[0]).toBeGreaterThanOrEqual(2)
  })
})

describe('saltiness cap is absolute (regression: two salty dishes on one day)', () => {
  it('never places a 2nd non-normal dish; relaxes no-repeat instead', () => {
    const salty = dish({ id: 's1', slot: 'pelengkap', saltiness: 'salty' })      // never served
    const normal = dish({ id: 'n1', slot: 'pelengkap', saltiness: 'normal' })     // blocked by no-repeat at factor 1
    const main = dish({ id: 'm', slot: 'utama', saltiness: 'very_salty' })
    const c = ctx({ date: '2026-08-13', slot: 'pelengkap', dishes: [salty, normal, main], role: 'support',
      runPicks: [pick({ plan_date: '2026-08-13', slot: 'utama', dish_id: 'm' })],
      priorPlans: [plan({ plan_date: '2026-08-09', slot: 'pelengkap', dish_id: 'n1' })] }) // 4d ago: blocked@f1, ok@f0.5
    const result = pickForSlot([salty, normal], c, seq([0.5]))
    expect(result.dish_id).toBe('n1') // must NOT pick the 2nd salty dish
  })
  it('leaves the slot empty rather than adding a 2nd salty when only salty candidates exist', () => {
    const salty = dish({ id: 's1', slot: 'pelengkap', saltiness: 'salty' })
    const c = ctx({ date: '2026-08-13', slot: 'pelengkap', dishes: [salty], role: 'support',
      runPicks: [pick({ plan_date: '2026-08-13', slot: 'utama', dish_id: 'm' })] })
    c.dishById.set('m', dish({ id: 'm', slot: 'utama', saltiness: 'very_salty' }))
    const result = pickForSlot([salty], c, seq([0.5]))
    expect(result.dish_id).toBeNull()
  })
})

import { validateWeek } from './engine'

describe('validateWeek', () => {
  it('flags a day with two non-normal saltiness dishes', () => {
    const byId = new Map<string, Dish>([
      ['a', dish({ id: 'a', slot: 'utama', name: 'Cumi telur asin', saltiness: 'very_salty' })],
      ['b', dish({ id: 'b', slot: 'pelengkap', name: 'Sambel tempe teri', saltiness: 'very_salty' })],
    ])
    const rows = [
      { plan_date: '2026-08-17', dish_id: 'a' },
      { plan_date: '2026-08-17', dish_id: 'b' },
    ]
    const report = validateWeek(rows, byId)
    expect(report.some(v => v.includes('2026-08-17') && v.includes('2 salty'))).toBe(true)
  })
  it('returns clean for a compliant week', () => {
    const byId = new Map<string, Dish>([
      ['a', dish({ id: 'a', slot: 'utama', protein: 'beef', saltiness: 'salty' })],
      ['b', dish({ id: 'b', slot: 'sayuran', protein: 'none', saltiness: 'normal' })],
    ])
    const rows = [
      { plan_date: '2026-08-17', dish_id: 'a' },
      { plan_date: '2026-08-17', dish_id: 'b' },
      { plan_date: '2026-08-18', dish_id: null, skipped: true },
    ]
    expect(validateWeek(rows, byId)).toEqual([])
  })
  it('flags a garnish dish and a pelengkap pick in the week', () => {
    const byId = new Map<string, Dish>([
      ['g', dish({ id: 'g', slot: 'sayuran', name: 'Teri krispi', is_garnish: true })],
      ['p', dish({ id: 'p', slot: 'pelengkap', name: 'Old side' })],
    ])
    const rows = [
      { plan_date: '2026-08-17', dish_id: 'g' },
      { plan_date: '2026-08-18', dish_id: 'p' },
    ]
    const report = validateWeek(rows, byId)
    expect(report.some(v => v.includes('garnish') && v.includes('Teri krispi'))).toBe(true)
    expect(report.some(v => v.includes('pelengkap'))).toBe(true)
  })
  it('flags a plate with two dishes sharing a meat protein', () => {
    const byId = new Map<string, Dish>([
      ['a', dish({ id: 'a', slot: 'utama', name: 'Ayam Jahe', protein: 'chicken' })],
      ['b', dish({ id: 'b', slot: 'pelengkap', name: 'Ayam Goreng', protein: 'chicken' })],
    ])
    const rows = [
      { plan_date: '2026-08-17', dish_id: 'a' },
      { plan_date: '2026-08-17', dish_id: 'b' },
    ]
    const report = validateWeek(rows, byId)
    expect(report.some(v => v.includes('2026-08-17') && v.includes('2 chicken'))).toBe(true)
  })
  it('does not flag repeated neutral proteins (two none dishes)', () => {
    const byId = new Map<string, Dish>([
      ['a', dish({ id: 'a', slot: 'sayuran', protein: 'none' })],
      ['b', dish({ id: 'b', slot: 'kuah', protein: 'none' })],
    ])
    const rows = [
      { plan_date: '2026-08-17', dish_id: 'a' },
      { plan_date: '2026-08-17', dish_id: 'b' },
    ]
    expect(validateWeek(rows, byId)).toEqual([])
  })
  it('flags two spicy mains on adjacent days', () => {
    const byId = new Map<string, Dish>([
      ['a', dish({ id: 'a', slot: 'utama', name: 'Ayam pedas', protein: 'chicken', spicy: true })],
      ['b', dish({ id: 'b', slot: 'utama', name: 'Ikan cabe', protein: 'fish', spicy: true })],
    ])
    const rows = [
      { plan_date: '2026-08-13', dish_id: 'a' },
      { plan_date: '2026-08-14', dish_id: 'b' },
    ]
    const report = validateWeek(rows, byId)
    expect(report.some(v => v.includes('spicy mains adjacent'))).toBe(true)
  })
  it('flags a provides-soup main sharing a day with a separate soup', () => {
    const byId = new Map<string, Dish>([
      ['m', dish({ id: 'm', slot: 'utama', name: 'Tomyam udang', protein: 'shrimp', provides_soup: true })],
      ['s', dish({ id: 's', slot: 'kuah', name: 'Sup ayam', protein: 'chicken' })],
    ])
    const rows = [
      { plan_date: '2026-08-17', dish_id: 'm' },
      { plan_date: '2026-08-17', dish_id: 's' },
    ]
    const report = validateWeek(rows, byId)
    expect(report.some(v => v.includes('2026-08-17') && v.includes('soup'))).toBe(true)
  })
  it('does NOT flag a provides-soup main whose kuah slot holds a second vegetable', () => {
    const byId = new Map<string, Dish>([
      ['m', dish({ id: 'm', slot: 'utama', name: 'Tomyam udang', protein: 'shrimp', provides_soup: true })],
      ['v', dish({ id: 'v', slot: 'sayuran', name: 'Tumis buncis', protein: 'none' })],  // veg placed in the freed slot
    ])
    const rows = [
      { plan_date: '2026-08-17', dish_id: 'm' },
      { plan_date: '2026-08-17', dish_id: 'v' },
    ]
    expect(validateWeek(rows, byId).some(v => v.includes('soup'))).toBe(false)
  })
})

describe('validateWeek (breakfast + evening fruit)', () => {
  it('flags a day with no breakfast planned', () => {
    const byId = new Map<string, Dish>([['bf', dish({ id: 'bf', slot: 'breakfast' })]])
    const rows = [
      { plan_date: '2026-08-17', slot: 'breakfast' as Slot, dish_id: 'bf' },
      { plan_date: '2026-08-18', slot: 'breakfast' as Slot, dish_id: null },
    ]
    const report = validateWeek(rows, byId)
    expect(report.some(v => v.includes('2026-08-18') && v.includes('no breakfast'))).toBe(true)
    expect(report.some(v => v.includes('2026-08-17') && v.includes('no breakfast'))).toBe(false)
  })
  it('flags more than 2 eat-out breakfasts in the week', () => {
    const byId = new Map<string, Dish>([['bf', dish({ id: 'bf', slot: 'breakfast', tier: 'special' })]])
    const rows = ['2026-08-10', '2026-08-13', '2026-08-16'].map(date => ({ plan_date: date, slot: 'breakfast' as Slot, dish_id: 'bf' }))
    const report = validateWeek(rows, byId)
    expect(report.some(v => v.includes('3 eat-out breakfasts'))).toBe(true)
  })
  it('flags eat-out breakfasts on adjacent days', () => {
    const byId = new Map<string, Dish>([['bf', dish({ id: 'bf', slot: 'breakfast', tier: 'special' })]])
    const rows = [
      { plan_date: '2026-08-10', slot: 'breakfast' as Slot, dish_id: 'bf' },
      { plan_date: '2026-08-11', slot: 'breakfast' as Slot, dish_id: 'bf' },
    ]
    const report = validateWeek(rows, byId)
    expect(report.some(v => v.includes('eat-out breakfasts on adjacent days'))).toBe(true)
  })
  it('does not count a special DINNER dish toward the breakfast eat-out quota', () => {
    const byId = new Map<string, Dish>([
      ['bf', dish({ id: 'bf', slot: 'breakfast', tier: 'everyday' })],
      ['dn', dish({ id: 'dn', slot: 'utama', tier: 'special' })],
    ])
    const rows = [
      { plan_date: '2026-08-17', slot: 'breakfast' as Slot, dish_id: 'bf' },
      { plan_date: '2026-08-17', slot: 'utama' as Slot, dish_id: 'dn' },
    ]
    const report = validateWeek(rows, byId)
    expect(report.some(v => v.includes('eat-out breakfast'))).toBe(false)
  })
  it('flags a day with no breakfast-fruit planned', () => {
    const byId = new Map<string, Dish>([['fr', dish({ id: 'fr', slot: 'fruit' })]])
    const rows = [
      { plan_date: '2026-08-17', slot: 'fruit' as Slot, role: 'breakfast' as Role, dish_id: 'fr' },
      { plan_date: '2026-08-18', slot: 'fruit' as Slot, role: 'breakfast' as Role, dish_id: null },
    ]
    const report = validateWeek(rows, byId)
    expect(report.some(v => v.includes('2026-08-18') && v.includes('no breakfast fruit'))).toBe(true)
    expect(report.some(v => v.includes('2026-08-17') && v.includes('no breakfast fruit'))).toBe(false)
  })
  it('flags a day with no dessert-fruit planned', () => {
    const byId = new Map<string, Dish>([['fr', dish({ id: 'fr', slot: 'fruit' })]])
    const rows = [
      { plan_date: '2026-08-17', slot: 'fruit' as Slot, role: 'optional' as Role, dish_id: 'fr' },
      { plan_date: '2026-08-18', slot: 'fruit' as Slot, role: 'optional' as Role, dish_id: null },
    ]
    const report = validateWeek(rows, byId)
    expect(report.some(v => v.includes('2026-08-18') && v.includes('no dessert fruit'))).toBe(true)
  })
  it('gives an advisory when fewer than 5 of 7 days reach ~2 fruit portions', () => {
    const byId = new Map<string, Dish>([
      ['fr', dish({ id: 'fr', slot: 'fruit', fruit_portions: 1 })],
      ['ds', dish({ id: 'ds', slot: 'desert', fruit_portions: 0 })],
    ])
    const rows = WEEK.flatMap(date => [
      { plan_date: date, slot: 'fruit' as Slot, dish_id: 'fr' },
      { plan_date: date, slot: 'desert' as Slot, dish_id: 'ds' },
    ])
    const report = validateWeek(rows, byId)
    expect(report.some(v => v.includes('0 of 7 days reach ~2 fruit portions'))).toBe(true)
  })
  it('gives no advisory when most days reach ~2 fruit portions', () => {
    const byId = new Map<string, Dish>([
      ['fr', dish({ id: 'fr', slot: 'fruit', fruit_portions: 1 })],
      ['ds', dish({ id: 'ds', slot: 'desert', fruit_portions: 1 })],
    ])
    const rows = WEEK.flatMap(date => [
      { plan_date: date, slot: 'fruit' as Slot, dish_id: 'fr' },
      { plan_date: date, slot: 'desert' as Slot, dish_id: 'ds' },
    ])
    const report = validateWeek(rows, byId)
    expect(report.some(v => v.includes('fruit portions'))).toBe(false)
  })
  it("does not couple a salty/fried breakfast dish into dinner's per-day caps", () => {
    const byId = new Map<string, Dish>([
      ['bf', dish({ id: 'bf', slot: 'breakfast', saltiness: 'salty', method: 'fried' })],
      ['dn', dish({ id: 'dn', slot: 'utama', saltiness: 'salty' })],
    ])
    const rows = [
      { plan_date: '2026-08-17', slot: 'breakfast' as Slot, dish_id: 'bf' },
      { plan_date: '2026-08-17', slot: 'utama' as Slot, dish_id: 'dn' },
    ]
    const report = validateWeek(rows, byId)
    expect(report.some(v => v.includes('salty'))).toBe(false)
  })
})

import { staleSoupRowIds } from './engine'

describe('validateWeek (dessert cap)', () => {
  it('flags more than DESSERT_WEEK_CAP distinct dessert dishes in the week', () => {
    const byId = new Map<string, Dish>([
      ['d1', dish({ id: 'd1', slot: 'desert', name: 'Kacang ijo' })],
      ['d2', dish({ id: 'd2', slot: 'desert', name: 'Yogurt' })],
      ['d3', dish({ id: 'd3', slot: 'desert', name: 'Brownie' })],
      ['d4', dish({ id: 'd4', slot: 'desert', name: 'Banana cake' })],
    ])
    const rows = [
      { plan_date: '2026-08-10', slot: 'desert' as Slot, dish_id: 'd1' },
      { plan_date: '2026-08-11', slot: 'desert' as Slot, dish_id: 'd2' },
      { plan_date: '2026-08-12', slot: 'desert' as Slot, dish_id: 'd3' },
      { plan_date: '2026-08-13', slot: 'desert' as Slot, dish_id: 'd4' },
    ]
    const report = validateWeek(rows, byId)
    expect(report.some(v => v.includes('4 dessert types'))).toBe(true)
  })
  it('does not flag exactly DESSERT_WEEK_CAP distinct dessert dishes', () => {
    const byId = new Map<string, Dish>([
      ['d1', dish({ id: 'd1', slot: 'desert' })],
      ['d2', dish({ id: 'd2', slot: 'desert' })],
      ['d3', dish({ id: 'd3', slot: 'desert' })],
    ])
    const rows = [
      { plan_date: '2026-08-10', slot: 'desert' as Slot, dish_id: 'd1' },
      { plan_date: '2026-08-11', slot: 'desert' as Slot, dish_id: 'd2' },
      { plan_date: '2026-08-12', slot: 'desert' as Slot, dish_id: 'd3' },
    ]
    expect(validateWeek(rows, byId).some(v => v.includes('dessert types'))).toBe(false)
  })
})

describe('staleSoupRowIds (consistency: wet main must not keep a separate soup)', () => {
  const row = (over: { slot: Slot; id?: string; locked?: boolean; role?: MealPlan['role']
    soup?: boolean; wetMain?: boolean; dryMain?: boolean; vegInKuah?: boolean }): MealPlan => {
    const dishes = over.wetMain ? { provides_soup: true, slot: 'utama' as Slot }
      : over.dryMain ? { provides_soup: false, slot: 'utama' as Slot }
      : over.soup ? { provides_soup: false, slot: 'kuah' as Slot }
      : over.vegInKuah ? { provides_soup: false, slot: 'sayuran' as Slot }
      : null
    return {
      id: over.id ?? 'r-' + Math.random(), plan_date: '2026-08-17', slot: over.slot,
      dish_id: dishes ? 'd' : null, dish_name: null, locked: over.locked ?? false,
      role: over.role ?? 'support', skipped: false,
      dishes: dishes as MealPlan['dishes'],
    }
  }
  it('flags the soup row when the day has a provides-soup main and a real soup', () => {
    const rows = [
      row({ slot: 'utama', role: 'main', wetMain: true }),
      row({ id: 'soup1', slot: 'kuah', soup: true }),
    ]
    expect(staleSoupRowIds(rows)).toEqual(['soup1'])
  })
  it('ignores a LOCKED soup row (honor the lock)', () => {
    const rows = [
      row({ slot: 'utama', role: 'main', wetMain: true }),
      row({ id: 'soup1', slot: 'kuah', soup: true, locked: true }),
    ]
    expect(staleSoupRowIds(rows)).toEqual([])
  })
  it('ignores a kuah slot that already holds a second vegetable', () => {
    const rows = [
      row({ slot: 'utama', role: 'main', wetMain: true }),
      row({ id: 'veg', slot: 'kuah', vegInKuah: true }),
    ]
    expect(staleSoupRowIds(rows)).toEqual([])
  })
  it('ignores a dry main with a normal soup', () => {
    const rows = [
      row({ slot: 'utama', role: 'main', dryMain: true }),
      row({ id: 'soup1', slot: 'kuah', soup: true }),
    ]
    expect(staleSoupRowIds(rows)).toEqual([])
  })
})

import { candidates } from './engine'

describe('garnish + inactive exclusion', () => {
  it('excludes garnish and inactive dishes from candidates', () => {
    const ok = dish({ id: 'ok', slot: 'sayuran' })
    const garnish = dish({ id: 'g', slot: 'sayuran', is_garnish: true })
    const inactive = dish({ id: 'i', slot: 'sayuran', active: false })
    const c = ctx({ date: '2026-08-13', slot: 'sayuran', dishes: [ok, garnish, inactive] })
    expect(passesHardRules(ok, c)).toBe(true)
    expect(passesHardRules(garnish, c)).toBe(false)
    expect(passesHardRules(inactive, c)).toBe(false)
    expect(candidates([ok, garnish, inactive], c).map(d => d.id)).toEqual(['ok'])
  })
  it('never picks a garnish dish even at last resort', () => {
    const garnish = dish({ id: 'g', slot: 'sayuran', is_garnish: true })
    const c = ctx({ date: '2026-08-13', slot: 'sayuran', dishes: [garnish] })
    expect(pickForSlot([garnish], c, seq([0.5])).dish_id).toBeNull()
  })
})

import { spicyMainSpacingOk } from './engine'

describe('spicyMainSpacingOk (no consecutive spicy mains)', () => {
  it('blocks a spicy main when the previous day main is spicy', () => {
    const d = dish({ id: 'm', slot: 'utama', spicy: true })
    const c = ctx({ date: '2026-08-14', slot: 'utama', dishes: [d], role: 'main',
      runPicks: [pick({ plan_date: '2026-08-13', slot: 'utama', dish_id: 'y', role: 'main' })] })
    c.dishById.set('y', dish({ id: 'y', slot: 'utama', spicy: true }))
    expect(spicyMainSpacingOk(d, c)).toBe(false)
  })
  it('blocks across the week boundary via priorPlans', () => {
    const d = dish({ id: 'm', slot: 'utama', spicy: true })
    const c = ctx({ date: '2026-08-17', slot: 'utama', dishes: [d], role: 'main',
      priorPlans: [plan({ plan_date: '2026-08-16', slot: 'utama', dish_id: 'y' })] })
    c.dishById.set('y', dish({ id: 'y', slot: 'utama', spicy: true }))
    expect(spicyMainSpacingOk(d, c)).toBe(false)
  })
  it('allows a spicy main next to a spicy SAYURAN (only mains count)', () => {
    const d = dish({ id: 'm', slot: 'utama', spicy: true })
    const c = ctx({ date: '2026-08-14', slot: 'utama', dishes: [d], role: 'main',
      runPicks: [pick({ plan_date: '2026-08-13', slot: 'sayuran', dish_id: 'v' })] })
    c.dishById.set('v', dish({ id: 'v', slot: 'sayuran', spicy: true }))
    expect(spicyMainSpacingOk(d, c)).toBe(true)
  })
  it('allows a non-spicy main, and any non-utama dish', () => {
    const nm = dish({ id: 'n', slot: 'utama', spicy: false })
    const c = ctx({ date: '2026-08-14', slot: 'utama', dishes: [nm], role: 'main',
      runPicks: [pick({ plan_date: '2026-08-13', slot: 'utama', dish_id: 'y' })] })
    c.dishById.set('y', dish({ id: 'y', slot: 'utama', spicy: true }))
    expect(spicyMainSpacingOk(nm, c)).toBe(true)
    const side = dish({ id: 's', slot: 'sayuran', spicy: true })
    expect(spicyMainSpacingOk(side, { ...c, slot: 'sayuran' })).toBe(true)
  })
  it('is relaxable via relax.spicyMainSpacing', () => {
    const d = dish({ id: 'm', slot: 'utama', spicy: true })
    const c = ctx({ date: '2026-08-14', slot: 'utama', dishes: [d], role: 'main',
      relax: { spicy: false, fried: false, hardDay: false, hardSpacing: false, proteinClash: false, spicyMainSpacing: true, noRepeatFactor: 1 },
      runPicks: [pick({ plan_date: '2026-08-13', slot: 'utama', dish_id: 'y', role: 'main' })] })
    c.dishById.set('y', dish({ id: 'y', slot: 'utama', spicy: true }))
    expect(spicyMainSpacingOk(d, c)).toBe(true)
  })
})
