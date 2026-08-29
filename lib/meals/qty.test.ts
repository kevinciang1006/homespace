import { describe, it, expect } from 'vitest'
import {
  formatQty, formatQtyAmount, QTY_UNITS,
  unitKind, toBaseAmount, formatBaseAmount, addToUnitClasses, dominantUnitClass, formatUnitClass,
  type UnitClass,
} from './qty'

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

describe('unitKind', () => {
  it('classifies weight units', () => {
    expect(unitKind('g')).toBe('weight')
    expect(unitKind('kg')).toBe('weight')
    expect(unitKind('gram')).toBe('weight')
  })
  it('classifies volume units', () => {
    expect(unitKind('ml')).toBe('volume')
    expect(unitKind('L')).toBe('volume')
    expect(unitKind('liter')).toBe('volume')
  })
  it('treats anything else as a count unit', () => {
    expect(unitKind('pcs')).toBe('count')
    expect(unitKind('butir')).toBe('count')
    expect(unitKind('to taste')).toBe('count')
  })
})

describe('toBaseAmount', () => {
  it('converts kg to g and L to ml', () => {
    expect(toBaseAmount(1.5, 'kg')).toBe(1500)
    expect(toBaseAmount(2, 'L')).toBe(2000)
  })
  it('leaves g/ml/count units unchanged', () => {
    expect(toBaseAmount(300, 'g')).toBe(300)
    expect(toBaseAmount(300, 'ml')).toBe(300)
    expect(toBaseAmount(3, 'pcs')).toBe(3)
  })
})

describe('formatBaseAmount', () => {
  it('shows grams below 1000', () => {
    expect(formatBaseAmount(300, 'weight')).toBe('300g')
  })
  it('shows kg at/above 1000, rounded to 1 decimal, trimmed', () => {
    expect(formatBaseAmount(1450, 'weight')).toBe('1.5kg')
    expect(formatBaseAmount(2000, 'weight')).toBe('2kg')
    expect(formatBaseAmount(2450, 'weight')).toBe('2.5kg')
  })
  it('does the same for volume with ml/L', () => {
    expect(formatBaseAmount(300, 'volume')).toBe('300ml')
    expect(formatBaseAmount(1500, 'volume')).toBe('1.5L')
  })
})

describe('addToUnitClasses / dominantUnitClass / formatUnitClass', () => {
  it('sums weight contributions across g and kg into one class', () => {
    const classes = new Map<string, UnitClass>()
    addToUnitClasses(classes, 1, 'kg')
    addToUnitClasses(classes, 600, 'g')
    addToUnitClasses(classes, 300, 'gram')
    const dom = dominantUnitClass(classes)!
    expect(dom.kind).toBe('weight')
    expect(dom.total).toBe(1900)
    expect(formatUnitClass(dom)).toBe('1.9kg')
  })

  it('keeps distinct count units separate (pcs vs butir)', () => {
    const classes = new Map<string, UnitClass>()
    addToUnitClasses(classes, 2, 'pcs')
    addToUnitClasses(classes, 3, 'butir')
    expect(classes.size).toBe(2)
  })

  it('prefers weight over a count unit when both are present (mismatch case)', () => {
    const classes = new Map<string, UnitClass>()
    addToUnitClasses(classes, 2, 'pcs')
    addToUnitClasses(classes, 550, 'g')
    const dom = dominantUnitClass(classes)!
    expect(dom.kind).toBe('weight')
    expect(formatUnitClass(dom)).toBe('550g')
    expect(classes.size).toBe(2) // both classes still visible to the caller, for warning purposes
  })

  it('among tied-kind count classes, the one with more contributing lines wins', () => {
    const classes = new Map<string, UnitClass>()
    addToUnitClasses(classes, 1, 'pcs')
    addToUnitClasses(classes, 1, 'pcs')
    addToUnitClasses(classes, 5, 'butir')
    const dom = dominantUnitClass(classes)!
    expect(dom.label).toBe('pcs')
    expect(dom.total).toBe(2)
  })

  it('returns null for an empty map', () => {
    expect(dominantUnitClass(new Map())).toBeNull()
  })
})
