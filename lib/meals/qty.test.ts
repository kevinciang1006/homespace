import { describe, it, expect } from 'vitest'
import { formatQty, formatQtyAmount, QTY_UNITS } from './qty'

describe('formatQtyAmount', () => {
  it('concatenates weight/volume units with no space', () => {
    expect(formatQtyAmount(400, 'g')).toBe('400g')
    expect(formatQtyAmount(1.5, 'kg')).toBe('1.5kg')
    expect(formatQtyAmount(250, 'ml')).toBe('250ml')
  })
  it('adds a space before count-like units', () => {
    expect(formatQtyAmount(2, 'ekor')).toBe('2 ekor')
    expect(formatQtyAmount(3, 'pcs')).toBe('3 pcs')
    expect(formatQtyAmount(6, 'slices')).toBe('6 slices')
    expect(formatQtyAmount(1, 'bunch')).toBe('1 bunch')
    expect(formatQtyAmount(1, 'pot')).toBe('1 pot')
  })
})

describe('formatQty', () => {
  it('returns null when no amount/unit and no note', () => {
    expect(formatQty(null, null, null)).toBeNull()
    expect(formatQty(null, 'g', undefined)).toBeNull()
  })
  it('formats amount + unit', () => {
    expect(formatQty(400, 'g', null)).toBe('400g')
    expect(formatQty(2, 'ekor', null)).toBe('2 ekor')
  })
  it('appends a note in parens when present', () => {
    expect(formatQty(2, 'ekor', '~600g total')).toBe('2 ekor (~600g total)')
  })
  it('falls back to just the note when amount/unit are unset', () => {
    expect(formatQty(null, null, 'as needed')).toBe('as needed')
  })
  it('trims whitespace-only notes to nothing', () => {
    expect(formatQty(400, 'g', '   ')).toBe('400g')
    expect(formatQty(null, null, '   ')).toBeNull()
  })
})

describe('QTY_UNITS', () => {
  it('lists the 8 supported units', () => {
    expect(QTY_UNITS).toEqual(['g', 'kg', 'pcs', 'slices', 'ekor', 'bunch', 'ml', 'pot'])
  })
})
