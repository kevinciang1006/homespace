import { describe, it, expect } from 'vitest'
import { formatStaplesLine } from './staples'
import type { DailyStaple } from './types'

function staple(over: Partial<DailyStaple> & { id: string; name: string; person: string }): DailyStaple {
  return { frequency: 'daily', note: null, ...over }
}

describe('formatStaplesLine', () => {
  it('returns empty string for no staples', () => {
    expect(formatStaplesLine([])).toBe('')
  })
  it('lists a single staple as "person name"', () => {
    expect(formatStaplesLine([staple({ id: '1', name: 'Susu (milk)', person: 'Son' })]))
      .toBe('Son Susu (milk)')
  })
  it('groups people sharing an identical name+note with "&"', () => {
    const staples = [
      staple({ id: '1', name: 'Susu / yogurt', person: 'Kevin', note: 'daily calcium' }),
      staple({ id: '2', name: 'Susu / yogurt', person: 'Wife', note: 'daily calcium' }),
    ]
    expect(formatStaplesLine(staples)).toBe('Kevin & Wife Susu / yogurt')
  })
  it('joins 3+ people in a group with commas and a final "&"', () => {
    const staples = ['Son', 'Kevin', 'Wife'].map((p, i) =>
      staple({ id: String(i), name: 'Susu (milk)', person: p }))
    expect(formatStaplesLine(staples)).toBe('Son, Kevin & Wife Susu (milk)')
  })
  it('separates distinct items with " · "', () => {
    const staples = [
      staple({ id: '1', name: 'Susu (milk)', person: 'Son' }),
      staple({ id: '2', name: 'Susu / yogurt', person: 'Kevin', note: 'daily calcium' }),
      staple({ id: '3', name: 'Susu / yogurt', person: 'Wife', note: 'daily calcium' }),
    ]
    expect(formatStaplesLine(staples)).toBe('Son Susu (milk) · Kevin & Wife Susu / yogurt')
  })
  it('keeps identically-named items with different notes separate', () => {
    const staples = [
      staple({ id: '1', name: 'Vitamin', person: 'Son', note: 'morning' }),
      staple({ id: '2', name: 'Vitamin', person: 'Son', note: 'evening' }),
    ]
    expect(formatStaplesLine(staples)).toBe('Son Vitamin · Son Vitamin')
  })
})
