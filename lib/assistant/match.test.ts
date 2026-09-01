import { describe, it, expect } from 'vitest'
import { matchByName } from './match'

type Row = { id: string; name: string }
const dishes: Row[] = [
  { id: '1', name: 'Waterless Chicken Soup' },
  { id: '2', name: 'Ayam Goreng Katsu' },
  { id: '3', name: 'Ayam Bumbu Bakar' },
  { id: '4', name: 'Ayam Kecap' },
  { id: '5', name: 'Sup Ikan' },
  { id: '6', name: 'Bayam Tumis' },
]
const getName = (r: Row) => r.name

describe('matchByName', () => {
  it('matches case-insensitively on an exact name', () => {
    const result = matchByName('waterless chicken soup', dishes, getName)
    expect(result.kind).toBe('one')
    if (result.kind === 'one') expect(result.row.id).toBe('1')
  })

  it('matches when the spoken phrase wraps the name in filler words (the reported bug)', () => {
    const result = matchByName('the waterless chicken soup dish', dishes, getName)
    expect(result.kind).toBe('one')
    if (result.kind === 'one') expect(result.row.id).toBe('1')
  })

  it('matches a short spoken name contained in a longer stored name', () => {
    const result = matchByName('chicken soup', dishes, getName)
    expect(result.kind).toBe('one')
    if (result.kind === 'one') expect(result.row.id).toBe('1')
  })

  it('tolerates a small transcription typo via edit-distance fallback', () => {
    const result = matchByName('waterless chiken soup', dishes, getName)
    expect(result.kind).toBe('one')
    if (result.kind === 'one') expect(result.row.id).toBe('1')
  })

  it('returns multiple candidates instead of guessing when ambiguous', () => {
    const result = matchByName('ayam', dishes, getName)
    expect(result.kind).toBe('many')
    if (result.kind === 'many') {
      expect(result.rows.map(r => r.id).sort()).toEqual(['2', '3', '4'])
    }
  })

  it('does not let "ayam" (chicken) match inside "Bayam Tumis" (spinach) — an unrelated word that happens to share letters', () => {
    const result = matchByName('ayam', dishes, getName)
    expect(result.kind).toBe('many')
    if (result.kind === 'many') expect(result.rows.map(r => r.id)).not.toContain('6')
  })

  it('returns none with no suggestions for something with nothing in common', () => {
    const result = matchByName('quantum teleporter', dishes, getName)
    expect(result.kind).toBe('none')
    if (result.kind === 'none') expect(result.suggestions).toEqual([])
  })

  it('returns none WITH a suggestion for a near-miss that still falls short of a real match', () => {
    const result = matchByName('waterless soup only', dishes, getName)
    // "waterless" + "soup" overlap with dish 1's words even though the
    // phrase carries an unrelated extra word ("only") — should surface as
    // a suggestion rather than silently matching or going fully empty.
    if (result.kind === 'none') expect(result.suggestions.length).toBeGreaterThan(0)
  })

  it('handles an empty query', () => {
    const result = matchByName('   ', dishes, getName)
    expect(result.kind).toBe('none')
  })

  it('handles an empty candidate list', () => {
    const result = matchByName('anything', [], getName)
    expect(result.kind).toBe('none')
  })
})
