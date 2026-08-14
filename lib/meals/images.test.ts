import { describe, it, expect } from 'vitest'
import { proteinStyle } from './images'

describe('proteinStyle', () => {
  it('maps each known protein to a gradient + icon', () => {
    for (const p of ['fish','chicken','duck','pork','beef','shrimp','crab','squid','egg','tofu_tempe','none','mixed']) {
      const s = proteinStyle(p)
      expect(s.gradient).toMatch(/from-.+ to-.+/)
      expect(s.Icon).toBeTruthy()
      expect(typeof s.label).toBe('string')
    }
  })
  it('falls back to the green/none style for unknown or empty protein', () => {
    expect(proteinStyle('unicorn').gradient).toBe(proteinStyle('none').gradient)
    expect(proteinStyle('').gradient).toBe(proteinStyle('none').gradient)
  })
  it('gives distinct hues to fish vs beef', () => {
    expect(proteinStyle('fish').gradient).not.toBe(proteinStyle('beef').gradient)
  })
})
