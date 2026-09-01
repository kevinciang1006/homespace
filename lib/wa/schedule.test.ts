import { describe, it, expect } from 'vitest'
import {
  jakartaToday, upcomingSaturday, upcomingDow, tomorrowOf, shoppingWeekStart,
  indonesianDayName, jakartaDateTimeToUtcIso, jakartaClock,
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

describe('upcomingDow', () => {
  it('returns today when today already matches the target weekday', () => {
    expect(upcomingDow('2026-08-17', 0)).toBe('2026-08-17') // Monday, target Mon=0
  })
  it('returns the next occurrence later in the same week', () => {
    expect(upcomingDow('2026-08-17', 3)).toBe('2026-08-20') // Monday -> Thursday
  })
  it('wraps to next week when the target weekday already passed', () => {
    expect(upcomingDow('2026-08-20', 0)).toBe('2026-08-24') // Thursday -> next Monday
  })
  it('matches upcomingSaturday for target=5', () => {
    expect(upcomingDow('2026-08-17', 5)).toBe(upcomingSaturday('2026-08-17'))
    expect(upcomingDow('2026-08-23', 5)).toBe(upcomingSaturday('2026-08-23'))
  })
})

describe('tomorrowOf', () => {
  it('adds one day', () => {
    expect(tomorrowOf('2026-08-31')).toBe('2026-09-01')
  })
})

describe('shoppingWeekStart', () => {
  it('targets THIS week on days before the cutoff', () => {
    expect(shoppingWeekStart('2026-08-17', 4)).toBe('2026-08-17') // Monday, dow=0 < 4
    expect(shoppingWeekStart('2026-08-27', 4)).toBe('2026-08-24') // Thursday, dow=3 < 4
  })
  it('targets NEXT week on/after the cutoff (default 4 = Friday)', () => {
    expect(shoppingWeekStart('2026-08-21', 4)).toBe('2026-08-24') // Friday, dow=4
    expect(shoppingWeekStart('2026-08-22', 4)).toBe('2026-08-24') // Saturday, dow=5
    expect(shoppingWeekStart('2026-08-23', 4)).toBe('2026-08-24') // Sunday, dow=6
  })
  it('honors a custom cutoff', () => {
    expect(shoppingWeekStart('2026-08-22', 6)).toBe('2026-08-17') // Saturday, dow=5 < 6 -> this week
    expect(shoppingWeekStart('2026-08-23', 6)).toBe('2026-08-24') // Sunday, dow=6 >= 6 -> next week
    expect(shoppingWeekStart('2026-08-17', 0)).toBe('2026-08-24') // Monday, dow=0 >= 0 -> next week
  })
})

describe('indonesianDayName', () => {
  it('maps known dates to Indonesian weekday names', () => {
    expect(indonesianDayName('2026-08-17')).toBe('Senin') // Monday
    expect(indonesianDayName('2026-08-22')).toBe('Sabtu') // Saturday
    expect(indonesianDayName('2026-08-23')).toBe('Minggu') // Sunday
  })
})

describe('jakartaClock', () => {
  it('reads the Jakarta wall clock (UTC+7) for the instant', () => {
    // 2026-09-01T00:00:00Z + 7h = 2026-09-01 07:00 Jakarta (a Tuesday)
    expect(jakartaClock(new Date('2026-09-01T00:00:00Z'))).toEqual({
      hour: 7, weekday: 'Tuesday', prettyDate: '1 Sep 2026',
    })
  })
  it('gives hour 0-23 (h23) and rolls the date/weekday past Jakarta midnight', () => {
    // 2026-09-01T17:00:00Z + 7h = 2026-09-02 00:00 Jakarta (a Wednesday)
    expect(jakartaClock(new Date('2026-09-01T17:00:00Z'))).toEqual({
      hour: 0, weekday: 'Wednesday', prettyDate: '2 Sep 2026',
    })
  })
  it('marks the edges of the 07:00-11:59 send window', () => {
    expect(jakartaClock(new Date('2026-08-31T22:00:00Z')).hour).toBe(5)  // 05:00 Jakarta
    expect(jakartaClock(new Date('2026-09-01T00:00:00Z')).hour).toBe(7)  // 07:00 — in
    expect(jakartaClock(new Date('2026-09-01T04:59:00Z')).hour).toBe(11) // 11:59 — in
    expect(jakartaClock(new Date('2026-09-01T05:00:00Z')).hour).toBe(12) // 12:00 — out
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
