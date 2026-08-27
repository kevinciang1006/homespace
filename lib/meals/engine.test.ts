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
    saltiness: 'normal', difficulty: 'medium', is_garnish: false, fruit_context: null,
    is_dish_helper: false, veg_style: null, base_key: null, self_sufficient_main: false, cadence: null, produce_role: null, ...over,
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

import { pickBreakfastFruit } from './engine'

describe('pickBreakfastFruit (daily-staple alternation)', () => {
  it('alternates away from yesterday\'s daily-staple pick', () => {
    const banana = dish({ id: 'banana', slot: 'fruit', produce_role: 'breakfast_fruit' })
    const pepaya = dish({ id: 'pepaya', slot: 'fruit', produce_role: 'breakfast_fruit' })
    const c = ctx({ date: '2026-08-13', slot: 'fruit', role: 'breakfast', dishes: [banana, pepaya],
      runPicks: [pick({ plan_date: '2026-08-12', slot: 'fruit', role: 'breakfast', dish_id: 'banana' })] })
    const p = pickBreakfastFruit([banana, pepaya], c, seq([0.5]))
    expect(p.dish_id).toBe('pepaya')
  })
  it('relaxes and repeats when only one daily-staple is available', () => {
    const banana = dish({ id: 'banana', slot: 'fruit', produce_role: 'breakfast_fruit' })
    const c = ctx({ date: '2026-08-13', slot: 'fruit', role: 'breakfast', dishes: [banana],
      runPicks: [pick({ plan_date: '2026-08-12', slot: 'fruit', role: 'breakfast', dish_id: 'banana' })] })
    const p = pickBreakfastFruit([banana], c, seq([0.5]))
    expect(p.dish_id).toBe('banana')
  })
  it('falls back to the full breakfast-context pool when no dish is tagged breakfast_fruit', () => {
    const guava = dish({ id: 'guava', slot: 'fruit', fruit_context: 'any', produce_role: null })
    const c = ctx({ date: '2026-08-13', slot: 'fruit', role: 'breakfast', dishes: [guava] })
    const p = pickBreakfastFruit([guava], c, seq([0.5]))
    expect(p.dish_id).toBe('guava')
  })
  it('ignores a fruit tagged for the dessert context only', () => {
    const dessertOnly = dish({ id: 'd', slot: 'fruit', fruit_context: 'dessert', produce_role: 'evening_fruit' })
    const c = ctx({ date: '2026-08-13', slot: 'fruit', role: 'breakfast', dishes: [dessertOnly] })
    const p = pickBreakfastFruit([dessertOnly], c, seq([0.5]))
    expect(p.dish_id).toBeNull()
  })
})

import { preassignEveningFruitDays } from './engine'

describe('preassignEveningFruitDays', () => {
  it('picks exactly targetCount days out of the week', () => {
    const days = preassignEveningFruitDays(WEEK, 3, seq([0.1,0.4,0.7,0.2,0.9,0.3,0.6]))
    expect(days.size).toBe(3)
    expect([...days].every(d => WEEK.includes(d))).toBe(true)
  })
  it('caps at the number of days available', () => {
    const days = preassignEveningFruitDays(WEEK, 30, seq([0.5]))
    expect(days.size).toBe(WEEK.length)
  })
})

import { pickEveningFruitForDay } from './engine'

describe('pickEveningFruitForDay', () => {
  it('returns a skipped null pick when the batch is empty', () => {
    const c = ctx({ date: '2026-08-13', slot: 'fruit', role: 'optional', dishes: [] })
    const p = pickEveningFruitForDay([], c, seq([0.5]))
    expect(p.dish_id).toBeNull()
    expect(p.skipped).toBe(true)
  })
  it('avoids a batch item shown within the short repeat window', () => {
    const a = dish({ id: 'a', slot: 'fruit' })
    const b = dish({ id: 'b', slot: 'fruit' })
    const c = ctx({ date: '2026-08-13', slot: 'fruit', role: 'optional', dishes: [a, b],
      runPicks: [pick({ plan_date: '2026-08-12', slot: 'fruit', role: 'optional', dish_id: 'a' })] })
    const p = pickEveningFruitForDay([a, b], c, seq([0.5]))
    expect(p.dish_id).toBe('b')
  })
  it('relaxes to allow a repeat when every batch item was shown recently', () => {
    const a = dish({ id: 'a', slot: 'fruit' })
    const c = ctx({ date: '2026-08-13', slot: 'fruit', role: 'optional', dishes: [a],
      runPicks: [pick({ plan_date: '2026-08-12', slot: 'fruit', role: 'optional', dish_id: 'a' })] })
    const p = pickEveningFruitForDay([a], c, seq([0.5]))
    expect(p.dish_id).toBe('a')
  })
})

function pools() {
  const mk = (slot: Slot, n: number, over: Partial<Dish> = {}) =>
    Array.from({ length: n }, (_, i) => dish({ id: `${slot}-${i}`, slot, ...over,
      protein: slot === 'utama' ? ['beef','chicken','fish','egg','tofu_tempe','shrimp','duck'][i % 7] : 'none' }))
  // Fried dish-helpers live in MIXED dish.slot values in real data (some
  // 'pelengkap', some 'sayuran', e.g. Tahu/Tempe goreng) — mirror that here so
  // the helper pool has candidates from both slots, like production. Added
  // ON TOP of the plain pools (not converted from them) so tests that rely on
  // sayuran's original real-vegetable capacity are unaffected.
  const pelengkap = mk('pelengkap', 9)
  pelengkap.slice(0, 3).forEach(d => { d.is_dish_helper = true; d.method = 'fried' })
  const sayuran = mk('sayuran', 8, { veg_style: 'dry' }) // most tests just need "a real veg exists"
  sayuran.push(dish({ id: 'sayuran-helper', slot: 'sayuran', protein: 'tofu_tempe', is_dish_helper: true, method: 'fried' }))
  return {
    breakfast: [] as Dish[], utama: mk('utama', 12), kuah: mk('kuah', 8), pelengkap,
    sayuran, fruit: [] as Dish[], desert: mk('desert', 8),
  }
}

describe('composeDay (interchangeable soup-or-veg plate)', () => {
  const run = (dishesBySlot: Record<Slot, Dish[]>, rngSeq = [0.3,0.6,0.1,0.8,0.5,0.2]) => {
    const dishById = new Map(Object.values(dishesBySlot).flat().map(d => [d.id, d]))
    return composeDay({ date: '2026-08-10', dishesBySlot, dishById, priorPlans: [], runPicks: [],
      lockedByCell: new Map(), specialDays: new Set(), hardDays: new Set(), breakfastSpecialDays: new Set(),
      dessertBatch: dishesBySlot.desert, eveningFruitBatch: [], eveningFruitDays: new Set(),
      rng: seq(rngSeq) })
  }

  it('non-fried, non-wet main → soup preferred (sayuran skipped) + a fried helper: 3 items', () => {
    const p = pools(); p.utama.forEach(d => { d.provides_soup = false; d.method = null })
    const created = run(p)
    expect(created.filter(x => x.role === 'main' && x.slot === 'utama').length).toBe(1)
    const kuah = created.find(x => x.slot === 'kuah')!
    expect(kuah.dish_id).toBeTruthy()
    expect(kuah.skipped).toBe(false)
    const sayuran = created.find(x => x.slot === 'sayuran')!
    expect(sayuran.dish_id).toBeNull()
    expect(sayuran.skipped).toBe(true)          // soup won the one slot
    expect(created.some(x => x.slot === 'desert' && x.role === 'optional')).toBe(true)
    const pelengkap = created.find(x => x.slot === 'pelengkap')!
    expect(pelengkap.dish_id).toBeTruthy()
    expect(pelengkap.skipped).toBe(false)
  })

  it('non-fried, WET (provides_soup) main → veg only (kuah skipped) + a fried helper: 3 items', () => {
    const p = pools(); p.utama.forEach(d => { d.provides_soup = true; d.method = null })
    const dishById = new Map(Object.values(p).flat().map(d => [d.id, d]))
    const created = composeDay({ date: '2026-08-10', dishesBySlot: p, dishById, priorPlans: [], runPicks: [],
      lockedByCell: new Map(), specialDays: new Set(), hardDays: new Set(), breakfastSpecialDays: new Set(),
      dessertBatch: p.desert, eveningFruitBatch: [], eveningFruitDays: new Set(),
      rng: seq([0.3,0.6,0.1,0.8,0.5,0.2]) })
    const sayuran = created.find(x => x.slot === 'sayuran')!
    expect(sayuran.dish_id).toBeTruthy()
    expect(sayuran.skipped).toBe(false)
    expect(dishById.get(sayuran.dish_id!)!.is_dish_helper).toBeFalsy()   // a real veg, not a helper
    const kuah = created.find(x => x.slot === 'kuah')!
    expect(kuah.dish_id).toBeNull()
    expect(kuah.skipped).toBe(true)             // wet main already has broth — no separate soup
    expect(created.find(x => x.slot === 'pelengkap')!.dish_id).toBeTruthy()   // still not fried → still gets a helper
  })

  it('self_sufficient_main=true → BOTH a soup and a veg, no helper: 3 items, no all-fried day', () => {
    const p = pools(); p.utama.forEach(d => { d.self_sufficient_main = true; d.provides_soup = false })
    const dishById = new Map(Object.values(p).flat().map(d => [d.id, d]))
    const created = composeDay({ date: '2026-08-10', dishesBySlot: p, dishById, priorPlans: [], runPicks: [],
      lockedByCell: new Map(), specialDays: new Set(), hardDays: new Set(), breakfastSpecialDays: new Set(),
      dessertBatch: p.desert, eveningFruitBatch: [], eveningFruitDays: new Set(),
      rng: seq([0.3,0.6,0.1,0.8,0.5,0.2]) })
    const sayuran = created.find(x => x.slot === 'sayuran')!
    const kuah = created.find(x => x.slot === 'kuah')!
    expect(sayuran.dish_id).toBeTruthy()
    expect(kuah.dish_id).toBeTruthy()
    const pelengkap = created.find(x => x.slot === 'pelengkap')!
    expect(pelengkap.dish_id).toBeNull()
    expect(pelengkap.skipped).toBe(true)        // self-sufficient main → no helper
  })

  it('self_sufficient_main is driven by the flag, NOT by method — a stirfry main can be self-sufficient (Cumi cabe setan case)', () => {
    const p = pools(); p.utama.forEach(d => { d.self_sufficient_main = true; d.method = 'stirfry'; d.provides_soup = false })
    const dishById = new Map(Object.values(p).flat().map(d => [d.id, d]))
    const created = composeDay({ date: '2026-08-10', dishesBySlot: p, dishById, priorPlans: [], runPicks: [],
      lockedByCell: new Map(), specialDays: new Set(), hardDays: new Set(), breakfastSpecialDays: new Set(),
      dessertBatch: p.desert, eveningFruitBatch: [], eveningFruitDays: new Set(),
      rng: seq([0.3,0.6,0.1,0.8,0.5,0.2]) })
    expect(created.find(x => x.slot === 'sayuran')!.dish_id).toBeTruthy()
    expect(created.find(x => x.slot === 'kuah')!.dish_id).toBeTruthy()
    expect(created.find(x => x.slot === 'pelengkap')!.skipped).toBe(true)
  })

  it('a literally fried/grilled main WITHOUT the flag no longer earns the exception — gets a helper like any other main', () => {
    const p = pools(); p.utama.forEach(d => { d.method = 'fried'; d.self_sufficient_main = false; d.provides_soup = false })
    const dishById = new Map(Object.values(p).flat().map(d => [d.id, d]))
    const created = composeDay({ date: '2026-08-10', dishesBySlot: p, dishById, priorPlans: [], runPicks: [],
      lockedByCell: new Map(), specialDays: new Set(), hardDays: new Set(), breakfastSpecialDays: new Set(),
      dessertBatch: p.desert, eveningFruitBatch: [], eveningFruitDays: new Set(),
      rng: seq([0.3,0.6,0.1,0.8,0.5,0.2]) })
    expect(created.find(x => x.slot === 'pelengkap')!.dish_id).toBeTruthy()   // helper present
  })

  it('provides_soup always wins — a self_sufficient_main=true wet main is treated as a plain wet main (veg + helper, no soup)', () => {
    const p = pools(); p.utama.forEach(d => { d.self_sufficient_main = true; d.provides_soup = true })
    const dishById = new Map(Object.values(p).flat().map(d => [d.id, d]))
    const created = composeDay({ date: '2026-08-10', dishesBySlot: p, dishById, priorPlans: [], runPicks: [],
      lockedByCell: new Map(), specialDays: new Set(), hardDays: new Set(), breakfastSpecialDays: new Set(),
      dessertBatch: p.desert, eveningFruitBatch: [], eveningFruitDays: new Set(),
      rng: seq([0.3,0.6,0.1,0.8,0.5,0.2]) })
    expect(created.find(x => x.slot === 'sayuran')!.dish_id).toBeTruthy()
    expect(created.find(x => x.slot === 'kuah')!.skipped).toBe(true)         // never a soup for a wet main
    expect(created.find(x => x.slot === 'pelengkap')!.dish_id).toBeTruthy()  // helper present — not treated as self-sufficient
  })

  it('LOCKED wet main (reshuffle case) → veg only, kuah skipped', () => {
    const p = pools()
    const tomyam = dish({ id: 'tomyam', slot: 'utama', name: 'Tomyam udang', protein: 'shrimp', provides_soup: true })
    p.utama = [tomyam, ...p.utama]
    const dishById = new Map(Object.values(p).flat().map(d => [d.id, d]))
    // simulate the day-reshuffle: main is LOCKED to Tomyam, everything else recomposes
    const lockedByCell = new Map([['2026-08-10|utama', { plan_date: '2026-08-10', slot: 'utama', dish_id: 'tomyam' } as MealPlan]])
    const runPicks: Pick[] = [pick({ plan_date: '2026-08-10', slot: 'utama', dish_id: 'tomyam', role: 'main', locked: true })]
    const created = composeDay({ date: '2026-08-10', dishesBySlot: p, dishById, priorPlans: [], runPicks,
      lockedByCell, specialDays: new Set(), hardDays: new Set(), breakfastSpecialDays: new Set(),
      dessertBatch: p.desert, eveningFruitBatch: [], eveningFruitDays: new Set(),
      rng: seq([0.3,0.6,0.1,0.8,0.5,0.2]) })
    const sayuran = created.find(x => x.slot === 'sayuran')!
    const kuah = created.find(x => x.slot === 'kuah')!
    expect(sayuran.dish_id).toBeTruthy()
    expect(kuah.dish_id).toBeNull()
    expect(kuah.skipped).toBe(true)
  })

  it('non-fried, non-wet main with NO soup candidates at all → falls back to a veg', () => {
    const p = pools(); p.utama.forEach(d => { d.provides_soup = false; d.method = null })
    p.kuah = [] // no soup pool at all
    const dishById = new Map(Object.values(p).flat().map(d => [d.id, d]))
    const created = composeDay({ date: '2026-08-10', dishesBySlot: p, dishById, priorPlans: [], runPicks: [],
      lockedByCell: new Map(), specialDays: new Set(), hardDays: new Set(), breakfastSpecialDays: new Set(),
      dessertBatch: p.desert, eveningFruitBatch: [], eveningFruitDays: new Set(),
      rng: seq([0.3,0.6,0.1,0.8,0.5,0.2]) })
    const kuah = created.find(x => x.slot === 'kuah')!
    expect(kuah.dish_id).toBeNull()             // pickForSlot's own "no candidate" convention (skipped: false)
    expect(kuah.skipped).toBe(false)
    const sayuran = created.find(x => x.slot === 'sayuran')!
    expect(sayuran.dish_id).toBeTruthy()        // veg fallback, since no soup exists
  })
})

describe('composeDay (breakfast fruit + opportunistic evening fruit)', () => {
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
  const run = (dishesBySlot: Record<Slot, Dish[]>, breakfastSpecialDays = new Set<string>(),
    lockedByCell = new Map<string, MealPlan>(), eveningFruitDays = new Set(['2026-08-10'])) => {
    const dishById = new Map(Object.values(dishesBySlot).flat().map(d => [d.id, d]))
    return composeDay({ date: '2026-08-10', dishesBySlot, dishById, priorPlans: [], runPicks: [],
      lockedByCell, specialDays: new Set(), hardDays: new Set(), breakfastSpecialDays,
      dessertBatch: dishesBySlot.desert, eveningFruitBatch: dishesBySlot.fruit, eveningFruitDays,
      rng: seq([0.3,0.6,0.1,0.8,0.5,0.2,0.9,0.4]) })
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
      dessertBatch: p.desert, eveningFruitBatch: p.fruit, eveningFruitDays: new Set(['2026-08-10']),
      rng: seq([0.3,0.6,0.1,0.8,0.5,0.2,0.9,0.4]) })
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

  it('picks a real evening-fruit dish on a day chosen for it', () => {
    const created = run(withBreakfastAndFruit(), new Set(), new Map(), new Set(['2026-08-10']))
    const evFruit = created.find(x => x.slot === 'fruit' && x.role === 'optional')
    expect(evFruit?.dish_id).toBeTruthy()
    expect(evFruit?.skipped).toBe(false)
  })

  it('skips the evening-fruit cell (still one row, but empty) on a day NOT chosen for it', () => {
    const created = run(withBreakfastAndFruit(), new Set(), new Map(), new Set()) // no days chosen this week
    const evFruit = created.find(x => x.slot === 'fruit' && x.role === 'optional')
    expect(evFruit).toBeTruthy()          // the row still exists...
    expect(evFruit!.dish_id).toBeNull()   // ...just empty
    expect(evFruit!.skipped).toBe(true)
  })

  it('never picks an evening-fruit dish outside the given batch, even if the wider pool has others', () => {
    const p = withBreakfastAndFruit()
    const created = composeDay({ date: '2026-08-10', dishesBySlot: p, dishById: new Map(Object.values(p).flat().map(d => [d.id, d])),
      priorPlans: [], runPicks: [], lockedByCell: new Map(), specialDays: new Set(), hardDays: new Set(),
      breakfastSpecialDays: new Set(), dessertBatch: p.desert,
      eveningFruitBatch: [p.fruit.find(d => d.id === 'fr-2')!], eveningFruitDays: new Set(['2026-08-10']),
      rng: seq([0.3,0.6,0.1,0.8,0.5,0.2,0.9,0.4]) })
    const evFruit = created.find(x => x.slot === 'fruit' && x.role === 'optional')
    expect(evFruit?.dish_id).toBe('fr-2')
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
    const dishesBySlot = pools() // desert: mk('desert', 8) — 8 candidates, cap should still bind to 2
    const picks = generateWeek({ weekStart: '2026-08-10', days: WEEK, dishesBySlot,
      allDishes: Object.values(dishesBySlot).flat(), priorPlans: [], lockedCells: [],
      rng: seq([0.3,0.6,0.1,0.8,0.5,0.2,0.9,0.4,0.7,0.05]) })
    const dessertIds = new Set(picks.filter(p => p.slot === 'desert' && p.dish_id).map(p => p.dish_id))
    expect(dessertIds.size).toBeLessThanOrEqual(2)
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
  it('excludes dessert_cake dishes entirely when dessertOptions.cakeEligible is false', () => {
    const dishesBySlot = pools()
    dishesBySlot.desert = [
      dish({ id: 'staple', slot: 'desert', produce_role: 'dessert_batch' }),
      dish({ id: 'cake', slot: 'desert', produce_role: 'dessert_cake' }),
    ]
    const picks = generateWeek({ weekStart: '2026-08-10', days: WEEK, dishesBySlot,
      allDishes: Object.values(dishesBySlot).flat(), priorPlans: [], lockedCells: [],
      rng: seq([0.3,0.6,0.1,0.8,0.5,0.2,0.9,0.4,0.7,0.05]),
      dessertOptions: { cakeEligible: false } })
    expect(picks.some(p => p.slot === 'desert' && p.dish_id === 'cake')).toBe(false)
  })
})

describe('generateWeek (evening fruit)', () => {
  it('shows evening fruit on only some days (opportunistic, not daily)', () => {
    const dishesBySlot = pools()
    dishesBySlot.fruit = [
      dish({ id: 'fr-1', slot: 'fruit', protein: 'none' }),
      dish({ id: 'fr-2', slot: 'fruit', protein: 'none' }),
    ]
    const picks = generateWeek({ weekStart: '2026-08-10', days: WEEK, dishesBySlot,
      allDishes: Object.values(dishesBySlot).flat(), priorPlans: [], lockedCells: [],
      rng: seq([0.3,0.6,0.1,0.8,0.5,0.2,0.9,0.4,0.7,0.05]) })
    const daysWithFruit = picks.filter(p => p.slot === 'fruit' && p.role === 'optional' && p.dish_id).length
    expect(daysWithFruit).toBeGreaterThan(0)
    expect(daysWithFruit).toBeLessThan(WEEK.length)
  })
  it('never uses more than EVENING_FRUIT_WEEK_CAP distinct evening-fruit dishes across the week', () => {
    const dishesBySlot = pools()
    dishesBySlot.fruit = Array.from({ length: 5 }, (_, i) => dish({ id: `f${i}`, slot: 'fruit', protein: 'none' }))
    const picks = generateWeek({ weekStart: '2026-08-10', days: WEEK, dishesBySlot,
      allDishes: Object.values(dishesBySlot).flat(), priorPlans: [], lockedCells: [],
      rng: seq([0.3,0.6,0.1,0.8,0.5,0.2,0.9,0.4,0.7,0.05]) })
    const evIds = new Set(picks.filter(p => p.slot === 'fruit' && p.role === 'optional' && p.dish_id).map(p => p.dish_id))
    expect(evIds.size).toBeLessThanOrEqual(2)
  })
  it('excludes monthly-cadence evening fruit when eveningFruitOptions.monthlyEligible is false', () => {
    const dishesBySlot = pools()
    dishesBySlot.fruit = [
      dish({ id: 'monthly', slot: 'fruit', protein: 'none', cadence: 'monthly' }),
      dish({ id: 'occasional', slot: 'fruit', protein: 'none', cadence: 'occasional' }),
    ]
    const picks = generateWeek({ weekStart: '2026-08-10', days: WEEK, dishesBySlot,
      allDishes: Object.values(dishesBySlot).flat(), priorPlans: [], lockedCells: [],
      rng: seq([0.3,0.6,0.1,0.8,0.5,0.2,0.9,0.4,0.7,0.05]),
      eveningFruitOptions: { monthlyEligible: false } })
    expect(picks.some(p => p.slot === 'fruit' && p.role === 'optional' && p.dish_id === 'monthly')).toBe(false)
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
    // fried dish-helper composition is covered by its own describe block below
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
      const dayPicks = picks.filter(p => p.plan_date === date && p.dish_id)
      const day = dayPicks.map(p => byId.get(p.dish_id!)!)
      expect(day.some(d => d.slot === 'kuah')).toBe(false)               // never a real soup dish
      // a wet main gets exactly ONE vegetable (sayuran) and no soup — kuah's cell
      // is skipped entirely now (no more "converts to a 2nd veg" under this model)
      expect(dayPicks.some(p => p.slot === 'sayuran' && p.dish_id)).toBe(true)
      expect(dayPicks.some(p => p.slot === 'kuah' && p.dish_id)).toBe(false)
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
  it('flags a garnish dish (a pelengkap-slot pick is no longer flagged — it\'s a valid dish-helper slot now)', () => {
    const byId = new Map<string, Dish>([
      ['g', dish({ id: 'g', slot: 'sayuran', name: 'Teri krispi', is_garnish: true })],
      ['p', dish({ id: 'p', slot: 'pelengkap', name: 'Bakwan' })],
    ])
    const rows = [
      { plan_date: '2026-08-17', dish_id: 'g' },
      { plan_date: '2026-08-18', dish_id: 'p' },
    ]
    const report = validateWeek(rows, byId)
    expect(report.some(v => v.includes('garnish') && v.includes('Teri krispi'))).toBe(true)
    expect(report.some(v => v.includes('pelengkap slot generated'))).toBe(false)
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
  it('flags the legacy separate-soup check even for a main flagged self_sufficient_main — provides_soup always wins', () => {
    const byId = new Map<string, Dish>([
      ['m', dish({ id: 'm', slot: 'utama', name: 'Udang gandum', protein: 'shrimp', provides_soup: true, self_sufficient_main: true })],
      ['s', dish({ id: 's', slot: 'kuah', name: 'Sop bayam', protein: 'none' })],
    ])
    const rows = [
      { plan_date: '2026-08-17', dish_id: 'm' },
      { plan_date: '2026-08-17', dish_id: 's' },
    ]
    expect(validateWeek(rows, byId).some(v => v.includes('separate soup'))).toBe(true)
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
  it('does NOT flag a day with no evening fruit planned — it is opportunistic, not daily', () => {
    const byId = new Map<string, Dish>([['fr', dish({ id: 'fr', slot: 'fruit' })]])
    const rows = [
      { plan_date: '2026-08-17', slot: 'fruit' as Slot, role: 'optional' as Role, dish_id: 'fr' },
      { plan_date: '2026-08-18', slot: 'fruit' as Slot, role: 'optional' as Role, dish_id: null },
    ]
    const report = validateWeek(rows, byId)
    expect(report.some(v => v.includes('no dessert fruit') || v.includes('no evening fruit'))).toBe(false)
  })
  it('reports how many days evening fruit was shown, as an informational note', () => {
    const byId = new Map<string, Dish>([['fr', dish({ id: 'fr', slot: 'fruit' })]])
    const rows = [
      { plan_date: '2026-08-17', slot: 'fruit' as Slot, role: 'optional' as Role, dish_id: 'fr' },
      { plan_date: '2026-08-18', slot: 'fruit' as Slot, role: 'optional' as Role, dish_id: null },
    ]
    const report = validateWeek(rows, byId)
    expect(report.some(v => v.includes('evening fruit shown on 1 of 2 days'))).toBe(true)
  })
  it('flags more than EVENING_FRUIT_WEEK_CAP distinct evening-fruit variations in the week', () => {
    const byId = new Map<string, Dish>([
      ['a', dish({ id: 'a', slot: 'fruit', name: 'Apple' })],
      ['b', dish({ id: 'b', slot: 'fruit', name: 'Jeruk' })],
      ['c', dish({ id: 'c', slot: 'fruit', name: 'Semangka' })],
    ])
    const rows = [
      { plan_date: '2026-08-17', slot: 'fruit' as Slot, role: 'optional' as Role, dish_id: 'a' },
      { plan_date: '2026-08-18', slot: 'fruit' as Slot, role: 'optional' as Role, dish_id: 'b' },
      { plan_date: '2026-08-19', slot: 'fruit' as Slot, role: 'optional' as Role, dish_id: 'c' },
    ]
    const report = validateWeek(rows, byId)
    expect(report.some(v => v.includes('3 evening-fruit variations'))).toBe(true)
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
    ])
    const rows = [
      { plan_date: '2026-08-10', slot: 'desert' as Slot, dish_id: 'd1' },
      { plan_date: '2026-08-11', slot: 'desert' as Slot, dish_id: 'd2' },
    ]
    expect(validateWeek(rows, byId).some(v => v.includes('dessert types'))).toBe(false)
  })
})

describe('staleSoupRowIds (consistency: wet main must not keep a separate soup)', () => {
  const row = (over: { slot: Slot; id?: string; locked?: boolean; role?: MealPlan['role']
    soup?: boolean; wetMain?: boolean; nonWetMain?: boolean; vegInKuah?: boolean }): MealPlan => {
    const dishes = over.wetMain ? { provides_soup: true, slot: 'utama' as Slot, method: null }
      : over.nonWetMain ? { provides_soup: false, slot: 'utama' as Slot, method: 'fried' }
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
  it('ignores a non-wet main with a normal soup (provides_soup is the only thing that matters here)', () => {
    const rows = [
      row({ slot: 'utama', role: 'main', nonWetMain: true }),
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

import { helperCandidates, pickHelper, baseKeyOk, pickVeg } from './engine'

describe('passesHardRules (sayuran excludes fried dish-helpers — the "real vegetable" rule)', () => {
  it('rejects an is_dish_helper dish for the sayuran slot even though dish.slot matches', () => {
    const helperVeg = dish({ id: 'tahu', slot: 'sayuran', is_dish_helper: true, method: 'fried' })
    const realVeg = dish({ id: 'kangkung', slot: 'sayuran' })
    const c = ctx({ date: '2026-08-10', slot: 'sayuran', dishes: [helperVeg, realVeg] })
    expect(passesHardRules(helperVeg, c)).toBe(false)
    expect(passesHardRules(realVeg, c)).toBe(true)
  })
  it('rejects a fried, non-helper sayuran dish too (defense in depth)', () => {
    const friedVeg = dish({ id: 'friedveg', slot: 'sayuran', method: 'fried' })
    const c = ctx({ date: '2026-08-10', slot: 'sayuran', dishes: [friedVeg] })
    expect(passesHardRules(friedVeg, c)).toBe(false)
  })
  it('does not exclude a helper-tagged dish from a non-sayuran slot', () => {
    const helper = dish({ id: 'bakwan', slot: 'pelengkap', is_dish_helper: true, method: 'fried' })
    const c = ctx({ date: '2026-08-10', slot: 'pelengkap', dishes: [helper] })
    expect(passesHardRules(helper, c)).toBe(true)
  })
})

describe('helperCandidates / pickHelper', () => {
  it('only returns is_dish_helper dishes, regardless of their own dish.slot', () => {
    const helperA = dish({ id: 'tahu', slot: 'sayuran', is_dish_helper: true, method: 'fried' })
    const helperB = dish({ id: 'bakwan', slot: 'pelengkap', is_dish_helper: true, method: 'fried' })
    const notHelper = dish({ id: 'kangkung', slot: 'sayuran' })
    const c = ctx({ date: '2026-08-10', slot: 'pelengkap', dishes: [helperA, helperB, notHelper] })
    expect(helperCandidates([helperA, helperB, notHelper], c).map(d => d.id).sort()).toEqual(['bakwan', 'tahu'])
  })
  it('respects the no-repeat window like other picks', () => {
    const helperA = dish({ id: 'tahu', slot: 'sayuran', is_dish_helper: true, method: 'fried' })
    const helperB = dish({ id: 'bakwan', slot: 'pelengkap', is_dish_helper: true, method: 'fried' })
    const priorPlans = [plan({ plan_date: '2026-08-05', slot: 'pelengkap', dish_id: 'tahu' })] // 5d ago, window=7
    const c = ctx({ date: '2026-08-10', slot: 'pelengkap', dishes: [helperA, helperB], priorPlans })
    expect(helperCandidates([helperA, helperB], c).map(d => d.id)).toEqual(['bakwan'])
  })
  it('pickHelper returns dish_id: null (not skipped) when no helper candidate exists', () => {
    const notHelper = dish({ id: 'kangkung', slot: 'sayuran' })
    const c = ctx({ date: '2026-08-10', slot: 'pelengkap', dishes: [notHelper] })
    const p = pickHelper([notHelper], c, seq([0.5]))
    expect(p.dish_id).toBeNull()
    expect(p.skipped).toBe(false)
  })
  it('excludes a helper sharing a base_key with a dish already on today\'s plate (bakso soup + bakso helper)', () => {
    const baksoHelper = dish({ id: 'bakso-goreng', slot: 'pelengkap', protein: 'none', is_dish_helper: true, method: 'fried', base_key: 'bakso' })
    const tahuHelper = dish({ id: 'tahu-goreng', slot: 'pelengkap', protein: 'none', is_dish_helper: true, method: 'fried', base_key: 'tahu' })
    const runPicks = [pick({ plan_date: '2026-08-10', slot: 'kuah', dish_id: 'bakso-soup' })]
    const c = ctx({ date: '2026-08-10', slot: 'pelengkap', dishes: [baksoHelper, tahuHelper], runPicks })
    c.dishById.set('bakso-soup', dish({ id: 'bakso-soup', slot: 'kuah', protein: 'none', base_key: 'bakso' }))
    expect(helperCandidates([baksoHelper, tahuHelper], c).map(d => d.id)).toEqual(['tahu-goreng'])
  })
})

describe('baseKeyOk (no duplicate base_key on one plate — never relaxed)', () => {
  it('passes when the dish has no base_key', () => {
    const d = dish({ id: 'x', slot: 'sayuran' })
    expect(baseKeyOk(d, ctx({ date: '2026-08-10', slot: 'sayuran', dishes: [d] }))).toBe(true)
  })
  it('rejects a 2nd dish sharing a base_key with one already on the plate today', () => {
    const helper = dish({ id: 'h', slot: 'pelengkap', base_key: 'tahu' })
    const c = ctx({ date: '2026-08-10', slot: 'pelengkap', dishes: [helper],
      runPicks: [pick({ plan_date: '2026-08-10', slot: 'sayuran', dish_id: 'v' })] })
    c.dishById.set('v', dish({ id: 'v', slot: 'sayuran', base_key: 'tahu' }))
    expect(baseKeyOk(helper, c)).toBe(false)
  })
  it('is unaffected by other days\' dishes sharing a base_key', () => {
    const helper = dish({ id: 'h', slot: 'pelengkap', base_key: 'tahu' })
    const c = ctx({ date: '2026-08-10', slot: 'pelengkap', dishes: [helper],
      runPicks: [pick({ plan_date: '2026-08-11', slot: 'sayuran', dish_id: 'v' })] })
    c.dishById.set('v', dish({ id: 'v', slot: 'sayuran', base_key: 'tahu' }))
    expect(baseKeyOk(helper, c)).toBe(true)
  })
  it('is never relaxed (ignores relax flags)', () => {
    const helper = dish({ id: 'h', slot: 'pelengkap', base_key: 'tahu' })
    const c = ctx({ date: '2026-08-10', slot: 'pelengkap', dishes: [helper],
      runPicks: [pick({ plan_date: '2026-08-10', slot: 'sayuran', dish_id: 'v' })],
      relax: { spicy: true, fried: true, hardDay: true, hardSpacing: true, proteinClash: true, spicyMainSpacing: true, noRepeatFactor: 0.5 } })
    c.dishById.set('v', dish({ id: 'v', slot: 'sayuran', base_key: 'tahu' }))
    expect(baseKeyOk(helper, c)).toBe(false)
  })
})

describe('pickVeg (prefer dry, fall back to any style)', () => {
  it('prefers a veg_style=dry candidate when preferDry is true', () => {
    const dry = dish({ id: 'dry1', slot: 'sayuran', veg_style: 'dry' })
    const wet = dish({ id: 'wet1', slot: 'sayuran', veg_style: 'wet' })
    const c = ctx({ date: '2026-08-10', slot: 'sayuran', dishes: [dry, wet] })
    const p = pickVeg([dry, wet], c, seq([0.5]), true)
    expect(p.dish_id).toBe('dry1')
  })
  it('falls back to a wet candidate when no dry one is available', () => {
    const wet = dish({ id: 'wet1', slot: 'sayuran', veg_style: 'wet' })
    const c = ctx({ date: '2026-08-10', slot: 'sayuran', dishes: [wet] })
    const p = pickVeg([wet], c, seq([0.5]), true)
    expect(p.dish_id).toBe('wet1')
  })
  it('ignores style entirely when preferDry is false', () => {
    const wet = dish({ id: 'wet1', slot: 'sayuran', veg_style: 'wet' })
    const c = ctx({ date: '2026-08-10', slot: 'sayuran', dishes: [wet] })
    const p = pickVeg([wet], c, seq([0.5]), false)
    expect(p.dish_id).toBe('wet1')
  })
})

describe('composeDay (dish-helper lock behavior)', () => {
  it('a LOCKED pelengkap cell is left untouched regardless of the (re-)composed main', () => {
    const p = pools()
    p.utama.forEach(d => { d.method = 'fried' })
    const dishById = new Map(Object.values(p).flat().map(d => [d.id, d]))
    const lockedByCell = new Map([['2026-08-10|pelengkap',
      { plan_date: '2026-08-10', slot: 'pelengkap', dish_id: 'pelengkap-0' } as MealPlan]])
    const created = composeDay({ date: '2026-08-10', dishesBySlot: p, dishById, priorPlans: [], runPicks: [],
      lockedByCell, specialDays: new Set(), hardDays: new Set(), breakfastSpecialDays: new Set(),
      dessertBatch: p.desert, eveningFruitBatch: [], eveningFruitDays: new Set(),
      rng: seq([0.3,0.6,0.1,0.8,0.5,0.2]) })
    expect(created.some(x => x.slot === 'pelengkap')).toBe(false) // locked cell isn't re-pushed
  })
})

describe('validateWeek (interchangeable soup-or-veg plate)', () => {
  function row(over: { plan_date: string; slot: Slot; dish_id: string | null; skipped?: boolean }) {
    return { skipped: false, ...over }
  }
  it('flags a self-sufficient main paired with a helper', () => {
    const byId = new Map<string, Dish>([
      ['m', dish({ id: 'm', slot: 'utama', name: 'Ayam goreng', self_sufficient_main: true })],
      ['h', dish({ id: 'h', slot: 'pelengkap', name: 'Bakwan', protein: 'none', is_dish_helper: true, method: 'fried' })],
      ['v', dish({ id: 'v', slot: 'sayuran', name: 'Tumis kangkung', protein: 'none' })],
      ['s', dish({ id: 's', slot: 'kuah', name: 'Sop bayam', protein: 'none' })],
    ])
    const rows = [
      row({ plan_date: '2026-08-17', slot: 'utama', dish_id: 'm' }),
      row({ plan_date: '2026-08-17', slot: 'pelengkap', dish_id: 'h' }),
      row({ plan_date: '2026-08-17', slot: 'sayuran', dish_id: 'v' }),
      row({ plan_date: '2026-08-17', slot: 'kuah', dish_id: 's' }),
    ]
    const report = validateWeek(rows, byId)
    expect(report.some(v => v.includes('self-sufficient main') && v.includes('a dish-helper'))).toBe(true)
  })
  it('flags a non-fried main with no dish-helper', () => {
    const byId = new Map<string, Dish>([
      ['m', dish({ id: 'm', slot: 'utama', name: 'Ayam kecap', protein: 'chicken' })],
      ['s', dish({ id: 's', slot: 'kuah', name: 'Sop bayam', protein: 'none' })],
    ])
    const rows = [
      row({ plan_date: '2026-08-17', slot: 'utama', dish_id: 'm' }),
      row({ plan_date: '2026-08-17', slot: 'kuah', dish_id: 's' }),
      row({ plan_date: '2026-08-17', slot: 'sayuran', dish_id: null, skipped: true }),
      row({ plan_date: '2026-08-17', slot: 'pelengkap', dish_id: null, skipped: true }),
    ]
    const report = validateWeek(rows, byId)
    expect(report.some(v => v.includes('no dish-helper'))).toBe(true)
  })
  it('flags a wet main missing its vegetable', () => {
    const byId = new Map<string, Dish>([
      ['m', dish({ id: 'm', slot: 'utama', name: 'Tomyam udang', protein: 'shrimp', provides_soup: true })],
      ['h', dish({ id: 'h', slot: 'pelengkap', name: 'Bakwan', protein: 'none', is_dish_helper: true, method: 'fried' })],
    ])
    const rows = [
      row({ plan_date: '2026-08-17', slot: 'utama', dish_id: 'm' }),
      row({ plan_date: '2026-08-17', slot: 'pelengkap', dish_id: 'h' }),
      row({ plan_date: '2026-08-17', slot: 'sayuran', dish_id: null, skipped: true }),
      row({ plan_date: '2026-08-17', slot: 'kuah', dish_id: null, skipped: true }),
    ]
    const report = validateWeek(rows, byId)
    expect(report.some(v => v.includes('wet main') && v.includes('missing its vegetable'))).toBe(true)
  })
  it('flags a non-fried, non-wet main with neither soup nor veg', () => {
    const byId = new Map<string, Dish>([
      ['m', dish({ id: 'm', slot: 'utama', name: 'Ayam kecap', protein: 'chicken' })],
      ['h', dish({ id: 'h', slot: 'pelengkap', name: 'Bakwan', protein: 'none', is_dish_helper: true, method: 'fried' })],
    ])
    const rows = [
      row({ plan_date: '2026-08-17', slot: 'utama', dish_id: 'm' }),
      row({ plan_date: '2026-08-17', slot: 'pelengkap', dish_id: 'h' }),
      row({ plan_date: '2026-08-17', slot: 'sayuran', dish_id: null, skipped: true }),
      row({ plan_date: '2026-08-17', slot: 'kuah', dish_id: null, skipped: true }),
    ]
    const report = validateWeek(rows, byId)
    expect(report.some(v => v.includes('no soup or vegetable planned'))).toBe(true)
  })
  it('flags a non-fried, non-wet main with BOTH soup and veg (over the one-slot cap)', () => {
    const byId = new Map<string, Dish>([
      ['m', dish({ id: 'm', slot: 'utama', name: 'Ayam kecap', protein: 'chicken' })],
      ['h', dish({ id: 'h', slot: 'pelengkap', name: 'Bakwan', protein: 'none', is_dish_helper: true, method: 'fried' })],
      ['v', dish({ id: 'v', slot: 'sayuran', name: 'Tumis kangkung', protein: 'none' })],
      ['s', dish({ id: 's', slot: 'kuah', name: 'Sop bayam', protein: 'none' })],
    ])
    const rows = [
      row({ plan_date: '2026-08-17', slot: 'utama', dish_id: 'm' }),
      row({ plan_date: '2026-08-17', slot: 'pelengkap', dish_id: 'h' }),
      row({ plan_date: '2026-08-17', slot: 'sayuran', dish_id: 'v' }),
      row({ plan_date: '2026-08-17', slot: 'kuah', dish_id: 's' }),
    ]
    const report = validateWeek(rows, byId)
    expect(report.some(v => v.includes('only one should compete for the slot'))).toBe(true)
  })
  it('flags a duplicate base_key among supporting dishes (bakso soup + bakso helper)', () => {
    const byId = new Map<string, Dish>([
      ['m', dish({ id: 'm', slot: 'utama', name: 'Ayam kecap', protein: 'chicken' })],
      ['h', dish({ id: 'h', slot: 'pelengkap', name: 'Bakso goreng', protein: 'none', is_dish_helper: true, method: 'fried', base_key: 'bakso' })],
      ['s', dish({ id: 's', slot: 'kuah', name: 'Bakso ikan', protein: 'none', base_key: 'bakso' })],
    ])
    const rows = [
      row({ plan_date: '2026-08-17', slot: 'utama', dish_id: 'm' }),
      row({ plan_date: '2026-08-17', slot: 'pelengkap', dish_id: 'h' }),
      row({ plan_date: '2026-08-17', slot: 'kuah', dish_id: 's' }),
      row({ plan_date: '2026-08-17', slot: 'sayuran', dish_id: null, skipped: true }),
    ]
    const report = validateWeek(rows, byId)
    expect(report.some(v => v.includes("duplicate base 'bakso'"))).toBe(true)
  })
  it('is clean for a compliant non-fried, non-wet day: main + helper + soup (veg skipped)', () => {
    const byId = new Map<string, Dish>([
      ['m', dish({ id: 'm', slot: 'utama', name: 'Ayam kecap', protein: 'chicken' })],
      ['h', dish({ id: 'h', slot: 'pelengkap', name: 'Bakwan', protein: 'none', is_dish_helper: true, method: 'fried' })],
      ['s', dish({ id: 's', slot: 'kuah', name: 'Sop bayam', protein: 'none' })],
    ])
    const rows = [
      row({ plan_date: '2026-08-17', slot: 'utama', dish_id: 'm' }),
      row({ plan_date: '2026-08-17', slot: 'pelengkap', dish_id: 'h' }),
      row({ plan_date: '2026-08-17', slot: 'kuah', dish_id: 's' }),
      row({ plan_date: '2026-08-17', slot: 'sayuran', dish_id: null, skipped: true }),
    ]
    expect(validateWeek(rows, byId)).toEqual([])
  })
  it('is clean for a compliant wet-main day: main + helper + veg (soup skipped)', () => {
    const byId = new Map<string, Dish>([
      ['m', dish({ id: 'm', slot: 'utama', name: 'Tomyam udang', protein: 'shrimp', provides_soup: true })],
      ['h', dish({ id: 'h', slot: 'pelengkap', name: 'Bakwan', protein: 'none', is_dish_helper: true, method: 'fried' })],
      ['v', dish({ id: 'v', slot: 'sayuran', name: 'Tumis kangkung', protein: 'none' })],
    ])
    const rows = [
      row({ plan_date: '2026-08-17', slot: 'utama', dish_id: 'm' }),
      row({ plan_date: '2026-08-17', slot: 'pelengkap', dish_id: 'h' }),
      row({ plan_date: '2026-08-17', slot: 'sayuran', dish_id: 'v' }),
      row({ plan_date: '2026-08-17', slot: 'kuah', dish_id: null, skipped: true }),
    ]
    expect(validateWeek(rows, byId)).toEqual([])
  })
  it('is clean for a wet main flagged self_sufficient_main=true — treated as a plain wet main (provides_soup wins)', () => {
    const byId = new Map<string, Dish>([
      ['m', dish({ id: 'm', slot: 'utama', name: 'Tomyam udang', protein: 'shrimp', provides_soup: true, self_sufficient_main: true })],
      ['h', dish({ id: 'h', slot: 'pelengkap', name: 'Bakwan', protein: 'none', is_dish_helper: true, method: 'fried' })],
      ['v', dish({ id: 'v', slot: 'sayuran', name: 'Tumis kangkung', protein: 'none' })],
    ])
    const rows = [
      row({ plan_date: '2026-08-17', slot: 'utama', dish_id: 'm' }),
      row({ plan_date: '2026-08-17', slot: 'pelengkap', dish_id: 'h' }),
      row({ plan_date: '2026-08-17', slot: 'sayuran', dish_id: 'v' }),
      row({ plan_date: '2026-08-17', slot: 'kuah', dish_id: null, skipped: true }),
    ]
    expect(validateWeek(rows, byId)).toEqual([])
  })
  it('is clean for a compliant self-sufficient-main day: main + soup + veg, NO helper', () => {
    const byId = new Map<string, Dish>([
      ['m', dish({ id: 'm', slot: 'utama', name: 'Ayam goreng', protein: 'chicken', self_sufficient_main: true })],
      ['v', dish({ id: 'v', slot: 'sayuran', name: 'Tumis kangkung', protein: 'none' })],
      ['s', dish({ id: 's', slot: 'kuah', name: 'Sop bayam', protein: 'none' })],
    ])
    const rows = [
      row({ plan_date: '2026-08-17', slot: 'utama', dish_id: 'm' }),
      row({ plan_date: '2026-08-17', slot: 'pelengkap', dish_id: null, skipped: true }),
      row({ plan_date: '2026-08-17', slot: 'sayuran', dish_id: 'v' }),
      row({ plan_date: '2026-08-17', slot: 'kuah', dish_id: 's' }),
    ]
    expect(validateWeek(rows, byId)).toEqual([])
  })
  it('is clean for a compliant self-sufficient-main day (stirfry method, Cumi cabe setan case)', () => {
    const byId = new Map<string, Dish>([
      ['m', dish({ id: 'm', slot: 'utama', name: 'Cumi cabe setan', protein: 'squid', method: 'stirfry', self_sufficient_main: true })],
      ['v', dish({ id: 'v', slot: 'sayuran', name: 'Tumis kangkung', protein: 'none' })],
      ['s', dish({ id: 's', slot: 'kuah', name: 'Sop bayam', protein: 'none' })],
    ])
    const rows = [
      row({ plan_date: '2026-08-17', slot: 'utama', dish_id: 'm' }),
      row({ plan_date: '2026-08-17', slot: 'pelengkap', dish_id: null, skipped: true }),
      row({ plan_date: '2026-08-17', slot: 'sayuran', dish_id: 'v' }),
      row({ plan_date: '2026-08-17', slot: 'kuah', dish_id: 's' }),
    ]
    expect(validateWeek(rows, byId)).toEqual([])
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
