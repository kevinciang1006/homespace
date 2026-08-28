import { describe, it, expect } from 'vitest'
import type { BacklogItem, NudgeContext } from './types'
import { slotForTime, selectNudgeCandidate, backlogTail, composeBacklogNudge } from './engine'

function item(over: Partial<BacklogItem> & { id: string; title: string }): BacklogItem {
  return {
    category: 'other', status: 'ready', blocked_by: null,
    time_of_day: ['any'], day_pref: 'any',
    needs_daylight: false, needs_dry: false, prep_ahead: false, lead_time_hours: null,
    mutex_group: null, recurring: false, recurrence: null, deadline: null, priority: 0,
    last_suggested_at: null, last_done_at: null, snooze_until: null, notes: null,
    created_at: '2026-08-01T00:00:00Z',
    ...over,
  }
}

function ctx(over: Partial<NudgeContext> = {}): NudgeContext {
  return {
    slot: 'evening', dayType: 'weekday', today: '2026-08-27',
    now: new Date('2026-08-27T12:30:00Z'), excludedMutexGroups: [],
    ...over,
  }
}

describe('slotForTime', () => {
  it('buckets clock times into time-of-day', () => {
    expect(slotForTime('03:00')).toBe('night')
    expect(slotForTime('08:15')).toBe('morning')
    expect(slotForTime('13:00')).toBe('afternoon')
    expect(slotForTime('19:30')).toBe('evening')
    expect(slotForTime('22:45')).toBe('night')
  })
})

describe('selectNudgeCandidate', () => {
  it('returns null for an empty pool', () => {
    expect(selectNudgeCandidate([], ctx())).toBeNull()
  })

  it('picks a matching ready item', () => {
    const got = selectNudgeCandidate([item({ id: 'a', title: 'Bake banana bread' })], ctx())
    expect(got?.id).toBe('a')
  })

  it('excludes items whose snooze_until is still in the future', () => {
    const got = selectNudgeCandidate(
      [item({ id: 'a', title: 'X', snooze_until: '2026-08-28' })],
      ctx({ today: '2026-08-27' }),
    )
    expect(got).toBeNull()
  })

  it('includes an item whose snooze_until is today or past', () => {
    const got = selectNudgeCandidate(
      [item({ id: 'a', title: 'X', snooze_until: '2026-08-27' })],
      ctx({ today: '2026-08-27' }),
    )
    expect(got?.id).toBe('a')
  })

  it('excludes items whose time_of_day does not include the slot (and is not "any")', () => {
    const got = selectNudgeCandidate(
      [item({ id: 'a', title: 'X', time_of_day: ['morning'] })],
      ctx({ slot: 'evening' }),
    )
    expect(got).toBeNull()
  })

  it('excludes weekend-only items on a weekday', () => {
    const got = selectNudgeCandidate(
      [item({ id: 'a', title: 'X', day_pref: 'weekend' })],
      ctx({ dayType: 'weekday' }),
    )
    expect(got).toBeNull()
  })

  it('excludes recurring items from the main pick', () => {
    const got = selectNudgeCandidate(
      [item({ id: 'a', title: 'Taobao', recurring: true, recurrence: 'daily' })],
      ctx(),
    )
    expect(got).toBeNull()
  })

  it('soft-auto-snoozes items suggested within the last 4 days', () => {
    const recent = new Date('2026-08-25T00:00:00Z').toISOString() // 2 days before now
    const got = selectNudgeCandidate(
      [item({ id: 'a', title: 'X', last_suggested_at: recent })],
      ctx({ now: new Date('2026-08-27T00:00:00Z') }),
    )
    expect(got).toBeNull()
  })

  it('re-allows items last suggested more than 4 days ago', () => {
    const old = new Date('2026-08-20T00:00:00Z').toISOString() // 7 days before now
    const got = selectNudgeCandidate(
      [item({ id: 'a', title: 'X', last_suggested_at: old })],
      ctx({ now: new Date('2026-08-27T00:00:00Z') }),
    )
    expect(got?.id).toBe('a')
  })

  it('excludes items in a mutex group already suggested/done today', () => {
    const got = selectNudgeCandidate(
      [item({ id: 'a', title: 'Clean car interior', mutex_group: 'car_clean' })],
      ctx({ excludedMutexGroups: ['car_clean'] }),
    )
    expect(got).toBeNull()
  })

  it('orders by priority desc, then oldest last_suggested_at first (nulls first)', () => {
    const items = [
      item({ id: 'lowprio', title: 'low', priority: 0 }),
      item({ id: 'hi-recent', title: 'hi recent', priority: 2, last_suggested_at: '2026-08-01T00:00:00Z' }),
      item({ id: 'hi-never', title: 'hi never', priority: 2, last_suggested_at: null }),
    ]
    const got = selectNudgeCandidate(items, ctx({ now: new Date('2026-09-15T00:00:00Z') }))
    expect(got?.id).toBe('hi-never')
  })
})

describe('backlogTail', () => {
  it('is empty when nothing is recurring-due or deadline-near', () => {
    expect(backlogTail([item({ id: 'a', title: 'X' })], '2026-08-27')).toEqual([])
  })

  it('emits a countdown line for a deadline within 7 days', () => {
    const lines = backlogTail(
      [item({ id: 'a', title: 'Check Taobao for pizza oven promo', deadline: '2026-09-02' })],
      '2026-08-27',
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('Check Taobao for pizza oven promo')
    expect(lines[0]).toContain('6 days')
  })

  it('does not emit a countdown for a deadline more than 7 days out', () => {
    const lines = backlogTail(
      [item({ id: 'a', title: 'X', deadline: '2026-09-30' })],
      '2026-08-27',
    )
    expect(lines).toEqual([])
  })

  it('emits a plain reminder for a daily-recurring item with no near deadline', () => {
    const lines = backlogTail(
      [item({ id: 'a', title: 'Water the plants', recurring: true, recurrence: 'daily' })],
      '2026-08-27',
    )
    expect(lines).toEqual(['Water the plants'])
  })

  it('for an item that is both recurring-due and deadline-near, emits ONE (countdown) line', () => {
    const lines = backlogTail(
      [item({ id: 'a', title: 'Check Taobao for pizza oven promo', recurring: true, recurrence: 'daily', deadline: '2026-09-02' })],
      '2026-08-27',
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('6 days')
  })
})

describe('composeBacklogNudge', () => {
  it('returns null when there is no candidate and no tail', () => {
    expect(composeBacklogNudge(null, [])).toBeNull()
  })

  it('frames a direct item as "<title> tonight" with the note appended', () => {
    const msg = composeBacklogNudge(item({ id: 'a', title: 'Bake banana bread', notes: 'use the aging bananas' }), [])
    expect(msg).toContain('🔧 Evening idea: bake banana bread tonight')
    expect(msg).toContain('use the aging bananas')
    expect(msg!.endsWith('/backlog')).toBe(true)
  })

  it('frames a prep_ahead item as a prep step that never implies finishable-now, mentioning lead time', () => {
    const msg = composeBacklogNudge(
      item({ id: 'a', title: 'Ninja Creami - rainbow (for son)', prep_ahead: true, lead_time_hours: 24 }),
      [],
    )
    expect(msg).toMatch(/prep .* tonight/i)
    expect(msg).toContain('24h')
  })

  it('appends tail lines and can be tail-only', () => {
    const msg = composeBacklogNudge(null, ['Check Taobao for pizza oven promo — 6 days left'])
    expect(msg).toContain('Check Taobao for pizza oven promo — 6 days left')
    expect(msg!.endsWith('/backlog')).toBe(true)
  })
})
