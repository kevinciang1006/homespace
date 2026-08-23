import { describe, it, expect } from 'vitest'
import {
  jakartaToday, upcomingSaturday, tomorrowOf, targetWeekStart,
  prepDateFor, indonesianDayName, jakartaDateTimeToUtcIso,
} from './schedule'

describe('jakartaToday', () => {
  it('rolls over to the next day once UTC+7 crosses midnight', () => {
    // 2026-08-22T18:00:00Z + 7h = 2026-08-23T01:00 Jakarta
    expect(jakartaToday(new Date('2026-08-22T18:00:00Z'))).toBe('2026-08-23')
  })
  it('stays on the same day otherwise', () => {
    expect(jakartaToday(new Date('2026-08-22T01:00:00Z'))).toBe('2026-08-22')
  })
})

describe('upcomingSaturday', () => {
  it('returns today when today is Saturday', () => {
    expect(upcomingSaturday('2026-08-22')).toBe('2026-08-22') // a Saturday
  })
  it('returns 6 days out when today is Sunday', () => {
    expect(upcomingSaturday('2026-08-23')).toBe('2026-08-29') // Sunday -> next Saturday
  })
  it('returns the Saturday later this week for a midweek day', () => {
    expect(upcomingSaturday('2026-08-17')).toBe('2026-08-22') // Monday -> that week's Saturday
  })
})

describe('tomorrowOf', () => {
  it('adds one day', () => {
    expect(tomorrowOf('2026-08-31')).toBe('2026-09-01')
  })
})

describe('targetWeekStart', () => {
  it('is the Monday of the week after the Saturday\'s own week', () => {
    // Saturday 2026-08-22 is in the Mon-Sun week starting 2026-08-17
    expect(targetWeekStart('2026-08-22')).toBe('2026-08-24')
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

describe('indonesianDayName', () => {
  it('maps known dates to Indonesian weekday names', () => {
    expect(indonesianDayName('2026-08-17')).toBe('Senin') // Monday
    expect(indonesianDayName('2026-08-22')).toBe('Sabtu') // Saturday
    expect(indonesianDayName('2026-08-23')).toBe('Minggu') // Sunday
  })
})

describe('jakartaDateTimeToUtcIso', () => {
  it('subtracts the 7h offset', () => {
    expect(jakartaDateTimeToUtcIso('2026-08-22', '09:00')).toBe('2026-08-22T02:00:00.000Z')
  })
  it('rolls the UTC date back when the Jakarta time is before 07:00', () => {
    expect(jakartaDateTimeToUtcIso('2026-08-22', '01:00')).toBe('2026-08-21T18:00:00.000Z')
  })
})
