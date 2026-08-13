import { describe, it, expect } from 'vitest'
import type { Dish, MealPlan, Pick, Slot } from './types'
import {
  noRepeatOk, proteinOk, specialOk, friedOk, spicyOk, passesHardRules,
  type PickContext,
} from './engine'

function dish(over: Partial<Dish> & { id: string; slot: Slot }): Dish {
  return {
    name: over.id, protein: 'chicken', tier: 'everyday', method: null,
    spicy: false, rating: 3, active: true, no_repeat_days: null, ...over,
  } as Dish
}
function plan(over: Partial<MealPlan> & { plan_date: string; slot: Slot }): MealPlan {
  return { id: 'p-' + Math.random(), dish_id: null, dish_name: null, locked: false, ...over } as MealPlan
}
function pick(over: Partial<Pick> & { plan_date: string; slot: Slot }): Pick {
  return { dish_id: null, dish_name: null, locked: false, ...over } as Pick
}

function ctx(over: Partial<PickContext> & { date: string; slot: Slot; dishes: Dish[] }): PickContext {
  const dishById = new Map(over.dishes.map(d => [d.id, d]))
  return {
    date: over.date, slot: over.slot,
    priorPlans: over.priorPlans ?? [], runPicks: over.runPicks ?? [],
    dishById, specialDays: over.specialDays ?? new Set(),
    relax: over.relax ?? { spicy: false, fried: false, noRepeatFactor: 1 },
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

describe('spicyOk', () => {
  it('rejects a spicy dish when it would make <2 non-spicy possible', () => {
    // day has 5 slots; utama,kuah,pelengkap,sayuran already spicy-picked; this is desert (last slot)
    const d = dish({ id: 'sp', slot: 'desert', spicy: true })
    const spicyPick = (slot: Slot, id: string) => pick({ plan_date: '2026-08-13', slot, dish_id: id })
    const c = ctx({ date: '2026-08-13', slot: 'desert', dishes: [d],
      runPicks: [spicyPick('utama','a'), spicyPick('kuah','b'), spicyPick('pelengkap','c'), spicyPick('sayuran','e')] })
    for (const id of ['a','b','c','e']) c.dishById.set(id, dish({ id, slot: 'utama', spicy: true }))
    expect(spicyOk(d, c)).toBe(false)
  })
  it('is not enforced when relax.spicy is true', () => {
    const d = dish({ id: 'sp', slot: 'desert', spicy: true })
    const c = ctx({ date: '2026-08-13', slot: 'desert', dishes: [d],
      relax: { spicy: true, fried: false, noRepeatFactor: 1 } })
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
    const onlySpicy = dish({ id: 'sp', slot: 'desert', spicy: true })
    // day already has 4 spicy picks -> spicyOk would reject at level 0
    const runPicks = ['utama','kuah','pelengkap','sayuran'].map(
      (s) => pick({ plan_date: '2026-08-13', slot: s as Slot, dish_id: 'x-' + s }))
    const c = ctx({ date: '2026-08-13', slot: 'desert', dishes: [onlySpicy], runPicks })
    for (const s of ['utama','kuah','pelengkap','sayuran'])
      c.dishById.set('x-' + s, dish({ id: 'x-' + s, slot: 'utama', spicy: true }))
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

import { preassignSpecialDays, generateWeek } from './engine'

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

describe('generateWeek', () => {
  it('fills 35 cells and never overwrites a locked cell', () => {
    // small but sufficient pools per slot
    const mk = (slot: Slot, n: number, over: Partial<Dish> = {}) =>
      Array.from({ length: n }, (_, i) => dish({ id: `${slot}-${i}`, slot, ...over,
        protein: slot === 'utama' ? ['beef','chicken','fish','egg','tofu_tempe','shrimp','duck'][i % 7] : 'none' }))
    const dishesBySlot = {
      utama: mk('utama', 10), kuah: mk('kuah', 8), pelengkap: mk('pelengkap', 9),
      sayuran: mk('sayuran', 8), desert: mk('desert', 8),
    }
    // ensure some special utama exist
    dishesBySlot.utama[0].tier = 'special'
    dishesBySlot.utama[1].tier = 'special'
    dishesBySlot.utama[2].tier = 'special'
    const allDishes = Object.values(dishesBySlot).flat()
    const locked = [plan({ plan_date: '2026-08-12', slot: 'kuah', dish_id: 'kuah-3', dish_name: 'kuah-3', locked: true })]
    const picks = generateWeek({
      weekStart: '2026-08-10', days: WEEK, dishesBySlot, allDishes,
      priorPlans: [], lockedCells: locked, rng: seq([0.3, 0.6, 0.1, 0.8, 0.5, 0.2, 0.9, 0.4, 0.7, 0.05]),
    })
    expect(picks.length).toBe(35)
    const lockedPick = picks.find(p => p.plan_date === '2026-08-12' && p.slot === 'kuah')!
    expect(lockedPick.dish_id).toBe('kuah-3')
    expect(lockedPick.locked).toBe(true)
  })
  it('places at most 2 special mains, on non-adjacent days', () => {
    const mk = (slot: Slot, n: number) =>
      Array.from({ length: n }, (_, i) => dish({ id: `${slot}-${i}`, slot,
        tier: slot === 'utama' && i < 3 ? 'special' : 'everyday',
        protein: slot === 'utama' ? ['beef','chicken','fish','egg','tofu_tempe','shrimp','duck'][i % 7] : 'none' }))
    const dishesBySlot = { utama: mk('utama',10), kuah: mk('kuah',8), pelengkap: mk('pelengkap',9), sayuran: mk('sayuran',8), desert: mk('desert',8) }
    const picks = generateWeek({ weekStart: '2026-08-10', days: WEEK, dishesBySlot,
      allDishes: Object.values(dishesBySlot).flat(), priorPlans: [], lockedCells: [],
      rng: seq([0.3,0.6,0.1,0.8,0.5,0.2,0.9,0.4,0.7,0.05]) })
    const byId = new Map(Object.values(dishesBySlot).flat().map(d => [d.id, d]))
    const specialMainDays = picks.filter(p => p.slot === 'utama' && byId.get(p.dish_id!)?.tier === 'special')
      .map(p => WEEK.indexOf(p.plan_date)).sort((a,b)=>a-b)
    expect(specialMainDays.length).toBeLessThanOrEqual(2)
    if (specialMainDays.length === 2) expect(specialMainDays[1] - specialMainDays[0]).toBeGreaterThanOrEqual(2)
  })
})
