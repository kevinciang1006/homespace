import { describe, it, expect } from 'vitest'
import type { MealPlan } from './types'
import { computeWeekOverview } from './overview'

type DishMeta = NonNullable<MealPlan['dishes']>
function meta(o: Partial<DishMeta> = {}): DishMeta {
  return { tier: 'everyday', spicy: false, richness: 'medium', provides_soup: false,
    recipe_image_url: null, protein: 'chicken', saltiness: 'normal', difficulty: 'medium', method: null, ...o }
}
function row(o: Partial<MealPlan> & { plan_date: string; slot: MealPlan['slot'] }): MealPlan {
  return { id: 'r-' + Math.random(), dish_id: 'd-' + Math.random(), dish_name: 'X',
    locked: false, role: 'support', skipped: false, dishes: meta(), ...o } as MealPlan
}
function mainRow(date: string, o: Partial<DishMeta>): MealPlan {
  return row({ plan_date: date, slot: 'utama', role: 'main', dishes: meta(o) })
}
const D = ['2026-08-10','2026-08-11','2026-08-12','2026-08-13','2026-08-14','2026-08-15','2026-08-16']

describe('computeWeekOverview', () => {
  it('reports no plan for an empty week', () => {
    const o = computeWeekOverview([])
    expect(o.hasPlan).toBe(false)
    expect(o.verdict).toMatch(/No plan/i)
    expect(o.signals).toEqual([])
  })
  it('flags spicy mains on adjacent days as heads-up', () => {
    const rows = [mainRow('2026-08-13', { spicy: true }), mainRow('2026-08-14', { spicy: true, protein: 'fish' })]
    const o = computeWeekOverview(rows)
    const spicy = o.signals.find(s => s.emoji === '🌶️')!
    expect(spicy.status).toBe('headsup')
  })
  it('marks two special mains as good', () => {
    const rows = [mainRow('2026-08-11', { tier: 'special' }), mainRow('2026-08-14', { tier: 'special', protein: 'fish' })]
    const o = computeWeekOverview(rows)
    expect(o.signals.find(s => s.emoji === '⭐')!.status).toBe('good')
  })
  it('flags a day with two salty dishes', () => {
    const rows = [mainRow('2026-08-11', { saltiness: 'salty' }), row({ plan_date: '2026-08-11', slot: 'sayuran', dishes: meta({ saltiness: 'very_salty', protein: 'none' }) })]
    const o = computeWeekOverview(rows)
    expect(o.signals.find(s => s.emoji === '🧂')!.status).toBe('headsup')
  })
  it('flags two same-protein mains on consecutive days', () => {
    const rows = [mainRow('2026-08-15', { protein: 'fish' }), mainRow('2026-08-16', { protein: 'fish' })]
    const o = computeWeekOverview(rows)
    expect(o.signals.find(s => s.emoji === '🥩')!.status).toBe('headsup')
  })
  it('always includes the calories placeholder', () => {
    const o = computeWeekOverview([mainRow('2026-08-11', {})])
    expect(o.signals.find(s => s.emoji === '🍚')!.detail).toMatch(/coming soon/i)
  })
  it('calls a spicy-heavy week a Spicy week', () => {
    const rows = ['2026-08-10','2026-08-12','2026-08-14'].map((d, i) => mainRow(d, { spicy: true, protein: ['fish','beef','chicken'][i] }))
    expect(computeWeekOverview(rows).verdict).toMatch(/Spicy week/)
  })
  it('calls a mild easy week a Light & easy week', () => {
    const rows = D.slice(0, 5).map((d, i) => mainRow(d, { difficulty: 'easy', spicy: false, protein: ['fish','beef','chicken','egg','duck'][i] }))
    expect(computeWeekOverview(rows).verdict).toMatch(/Light & easy/)
  })
})
