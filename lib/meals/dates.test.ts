import { describe, it, expect } from 'vitest'
import { isoDate, weekDates, daysBetween, currentMonday, shiftWeek, mondayOf, prepDateFor, dayNameShort } from './dates'

describe('date helpers', () => {
  it('weekDates returns 7 consecutive local dates from Monday', () => {
    expect(weekDates('2026-08-10')).toEqual([
      '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13',
      '2026-08-14', '2026-08-15', '2026-08-16',
    ])
  })
  it('daysBetween counts whole days, b minus a', () => {
    expect(daysBetween('2026-08-10', '2026-08-13')).toBe(3)
    expect(daysBetween('2026-08-13', '2026-08-10')).toBe(-3)
  })
  it('isoDate formats a local Date as YYYY-MM-DD', () => {
    expect(isoDate(new Date(2026, 7, 3))).toBe('2026-08-03')
  })
})

describe('week helpers', () => {
  it('shiftWeek adds days across a month boundary', () => {
    expect(shiftWeek('2026-08-31', 7)).toBe('2026-09-07')
    expect(shiftWeek('2026-09-07', -7)).toBe('2026-08-31')
  })
  it('mondayOf maps any weekday to that week Monday', () => {
    expect(mondayOf('2026-08-13')).toBe('2026-08-10') // Thu -> Mon
    expect(mondayOf('2026-08-10')).toBe('2026-08-10') // Mon -> Mon
    expect(mondayOf('2026-08-16')).toBe('2026-08-10') // Sun -> Mon
  })
  it('currentMonday returns a Monday (getDay === 1)', () => {
    const [y, m, d] = currentMonday().split('-').map(Number)
    expect(new Date(y, m - 1, d).getDay()).toBe(1)
  })
})

describe('dayNameShort', () => {
  it('formats a date as a short English weekday name', () => {
    expect(dayNameShort('2026-08-24')).toBe('Mon')
    expect(dayNameShort('2026-08-30')).toBe('Sun')
  })
})

describe('prepDateFor', () => {
  it('subtracts the given lead days', () => {
    expect(prepDateFor('2026-08-27', 3)).toBe('2026-08-24')
  })
  it('floors a null lead to 1 day', () => {
    expect(prepDateFor('2026-08-27', null)).toBe('2026-08-26')
  })
  it('floors a 0 lead to 1 day', () => {
    expect(prepDateFor('2026-08-27', 0)).toBe('2026-08-26')
  })
})
