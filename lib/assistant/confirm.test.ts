import { describe, it, expect } from 'vitest'
import { classifyYesNo } from './confirm'

describe('classifyYesNo', () => {
  it('recognizes English affirmatives', () => {
    expect(classifyYesNo('yes')).toBe('yes')
    expect(classifyYesNo('Yeah do it')).toBe('yes')
    expect(classifyYesNo('sure, go ahead')).toBe('yes')
  })
  it('recognizes Indonesian affirmatives', () => {
    expect(classifyYesNo('iya')).toBe('yes')
    expect(classifyYesNo('ya betul')).toBe('yes')
    expect(classifyYesNo('oke lanjut')).toBe('yes')
  })
  it('recognizes English negatives', () => {
    expect(classifyYesNo('no')).toBe('no')
    expect(classifyYesNo('nope, cancel that')).toBe('no')
  })
  it('recognizes Indonesian negatives', () => {
    expect(classifyYesNo('tidak')).toBe('no')
    expect(classifyYesNo('gak usah, batal')).toBe('no')
  })
  it('falls back to unclear for anything else, including an unrelated follow-up', () => {
    expect(classifyYesNo('make it two')).toBe('unclear')
    expect(classifyYesNo('actually add milk instead')).toBe('unclear')
  })
})
