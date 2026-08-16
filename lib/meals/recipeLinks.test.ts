import { describe, it, expect } from 'vitest'
import { detectSource } from './recipeLinks'

describe('detectSource', () => {
  it('detects youtube', () => {
    expect(detectSource('https://www.youtube.com/watch?v=abc')).toBe('youtube')
    expect(detectSource('https://youtu.be/abc')).toBe('youtube')
  })
  it('detects instagram', () => {
    expect(detectSource('https://www.instagram.com/reel/xyz/')).toBe('instagram')
  })
  it('detects tiktok', () => {
    expect(detectSource('https://www.tiktok.com/@user/video/123')).toBe('tiktok')
  })
  it('falls back to web for anything else', () => {
    expect(detectSource('https://cookpad.com/id/resep/123')).toBe('web')
    expect(detectSource('not a url')).toBe('web')
  })
})
