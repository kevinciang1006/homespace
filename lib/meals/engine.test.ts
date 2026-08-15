import { describe, it, expect } from 'vitest'
import type { Dish, MealPlan, Pick, Slot } from './types'
import {
  noRepeatOk, proteinOk, specialOk, friedOk, spicyOk, passesHardRules,
  type PickContext,
} from './engine'

function dish(over: Partial<Dish> & { id: string; slot: Slot }): Dish {
  return {
    name: over.id, protein: 'chicken', tier: 'everyday', method: null,
    spicy: false, rating: 3, active: true, no_repeat_days: null,
    ingredients: null, recipe_steps: null, recipe_image_url: null,
    richness: 'medium', provides_soup: false,
    saltiness: 'normal', difficulty: 'medium', ...over,
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
    relax: over.relax ?? { spicy: false, fried: false, noRepeatFactor: 1 },
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
    const onlySpicy = dish({ id: 'sp', slot: 'pelengkap', spicy: true })
    // spicy main already placed, no more picks planned -> a spicy side breaks the floor at level 0
    const c = ctx({ date: '2026-08-13', slot: 'pelengkap', dishes: [onlySpicy],
      role: 'support', plannedRemaining: 0,
      runPicks: [pick({ plan_date: '2026-08-13', slot: 'utama', dish_id: 'm', role: 'main' })] })
    c.dishById.set('m', dish({ id: 'm', slot: 'utama', spicy: true }))
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

function pools() {
  const mk = (slot: Slot, n: number, over: Partial<Dish> = {}) =>
    Array.from({ length: n }, (_, i) => dish({ id: `${slot}-${i}`, slot, ...over,
      protein: slot === 'utama' ? ['beef','chicken','fish','egg','tofu_tempe','shrimp','duck'][i % 7] : 'none' }))
  return {
    utama: mk('utama', 12), kuah: mk('kuah', 8), pelengkap: mk('pelengkap', 9),
    sayuran: mk('sayuran', 8), desert: mk('desert', 8),
  }
}

describe('composeDay', () => {
  it('heavy main → main + veg + desert only (no side/soup dish)', () => {
    const dishesBySlot = pools()
    dishesBySlot.utama.forEach(d => { d.richness = 'heavy' })
    const dishById = new Map(Object.values(dishesBySlot).flat().map(d => [d.id, d]))
    const runPicks: Pick[] = []
    const created = composeDay({ date: '2026-08-10', dishesBySlot, dishById, priorPlans: [], runPicks,
      lockedByCell: new Map(), specialDays: new Set(), rng: seq([0.3,0.6,0.1,0.8,0.5]) })
    expect(created.filter(p => p.role === 'main').length).toBe(1)
    expect(created.some(p => p.slot === 'sayuran' && p.role === 'support')).toBe(true)
    expect(created.some(p => p.slot === 'pelengkap')).toBe(false) // no side for heavy
    expect(created.some(p => p.slot === 'kuah' && p.dish_id)).toBe(false) // no soup dish
    expect(created.some(p => p.slot === 'desert' && p.role === 'optional')).toBe(true)
  })

  it('medium main → main + veg + one side + desert', () => {
    const dishesBySlot = pools()
    dishesBySlot.utama.forEach(d => { d.richness = 'medium'; d.provides_soup = false })
    const dishById = new Map(Object.values(dishesBySlot).flat().map(d => [d.id, d]))
    const created = composeDay({ date: '2026-08-10', dishesBySlot, dishById, priorPlans: [], runPicks: [],
      lockedByCell: new Map(), specialDays: new Set(), rng: seq([0.3,0.6,0.1,0.8,0.5,0.2]) })
    expect(created.some(p => p.slot === 'sayuran' && p.dish_id)).toBe(true)
    expect(created.some(p => p.slot === 'pelengkap' && p.dish_id)).toBe(true)
    expect(created.some(p => p.slot === 'desert' && p.role === 'optional')).toBe(true)
  })

  it('main that provides soup → skipped kuah row, no soup dish', () => {
    const dishesBySlot = pools()
    dishesBySlot.utama.forEach(d => { d.richness = 'medium'; d.provides_soup = true })
    const dishById = new Map(Object.values(dishesBySlot).flat().map(d => [d.id, d]))
    const created = composeDay({ date: '2026-08-10', dishesBySlot, dishById, priorPlans: [], runPicks: [],
      lockedByCell: new Map(), specialDays: new Set(), rng: seq([0.3,0.6,0.1,0.8,0.5,0.2]) })
    const kuah = created.find(p => p.slot === 'kuah')!
    expect(kuah.skipped).toBe(true)
    expect(kuah.dish_id).toBeNull()
    expect(created.some(p => p.slot === 'kuah' && p.dish_id)).toBe(false)
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
})
