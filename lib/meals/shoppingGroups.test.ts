import { describe, it, expect } from 'vitest'
import { classifyShoppingGroup, sectionOf, shoppingSubRank, SHOPPING_GROUP_RANK, SHOPPING_SECTION_ORDER } from './shoppingGroups'

describe('classifyShoppingGroup', () => {
  it('classifies by stored category first', () => {
    expect(classifyShoppingGroup('Ayam', 'protein')).toBe('protein')
    expect(classifyShoppingGroup('Bumbu Rendang', 'bumbu')).toBe('bumbu_packet')
  })

  it('reclassifies known aromatics out of "vegetable" into bumbu_aromatic', () => {
    expect(classifyShoppingGroup('Cabai Rawit', 'vegetable')).toBe('bumbu_aromatic')
    expect(classifyShoppingGroup('Bawang Putih', 'veg')).toBe('bumbu_aromatic')
  })

  it('keeps non-aromatic vegetables as veg_main', () => {
    expect(classifyShoppingGroup('Wortel', 'vegetable')).toBe('veg_main')
    expect(classifyShoppingGroup('Kangkung', 'veg')).toBe('veg_main')
  })

  it('splits "dish" (bought-as-is) items into fruit vs lainnya by name', () => {
    expect(classifyShoppingGroup('Banana', 'dish')).toBe('fruit')
    expect(classifyShoppingGroup('Pepaya 24 slices', 'dish')).toBe('fruit')
    expect(classifyShoppingGroup('Yogurt 1500ml', 'dish')).toBe('lainnya')
  })

  it('falls back to lainnya for anything unrecognized', () => {
    expect(classifyShoppingGroup('Mystery item', 'other')).toBe('lainnya')
  })
})

describe('sectionOf', () => {
  it('merges bumbu_packet and bumbu_aromatic into one "bumbu" section', () => {
    expect(sectionOf('bumbu_packet')).toBe('bumbu')
    expect(sectionOf('bumbu_aromatic')).toBe('bumbu')
  })
  it('passes other groups through unchanged', () => {
    expect(sectionOf('protein')).toBe('protein')
    expect(sectionOf('veg_main')).toBe('veg_main')
    expect(sectionOf('fruit')).toBe('fruit')
    expect(sectionOf('lainnya')).toBe('lainnya')
  })
})

describe('SHOPPING_GROUP_RANK / SHOPPING_SECTION_ORDER', () => {
  it('orders protein -> veg_main -> bumbu_packet -> bumbu_aromatic -> fruit -> lainnya', () => {
    const order: (keyof typeof SHOPPING_GROUP_RANK)[] = ['protein', 'veg_main', 'bumbu_packet', 'bumbu_aromatic', 'fruit', 'lainnya']
    for (let i = 1; i < order.length; i++) {
      expect(SHOPPING_GROUP_RANK[order[i]]).toBeGreaterThan(SHOPPING_GROUP_RANK[order[i - 1]])
    }
  })
  it('lists lainnya last, so it is easy for callers to slice it off', () => {
    expect(SHOPPING_SECTION_ORDER[SHOPPING_SECTION_ORDER.length - 1]).toBe('lainnya')
  })
})

describe('shoppingSubRank', () => {
  it('clusters chicken-family protein items together', () => {
    const ayam = shoppingSubRank('protein', 'Ayam')
    const ayamKampung = shoppingSubRank('protein', 'Ayam Kampung')
    const tulangAyam = shoppingSubRank('protein', 'Tulang Ayam')
    const cekerAyam = shoppingSubRank('protein', 'Ceker Ayam') // not a real ingredient yet — keyword match still works
    expect(new Set([ayam, ayamKampung, tulangAyam, cekerAyam]).size).toBe(1)
  })

  it('clusters seafood-family protein items together, separate from chicken', () => {
    const udang = shoppingSubRank('protein', 'Udang')
    const cumi = shoppingSubRank('protein', 'Cumi-Cumi')
    const ikan = shoppingSubRank('protein', 'Ikan')
    const ayam = shoppingSubRank('protein', 'Ayam')
    expect(new Set([udang, cumi, ikan]).size).toBe(1)
    expect(udang).not.toBe(ayam)
  })

  it('puts an unrelated protein item (e.g. Tahu) between chicken and seafood in a real sort', () => {
    const items = ['Udang', 'Tahu', 'Ayam', 'Cumi-Cumi', 'Tulang Ayam']
    const sorted = [...items].sort((a, b) =>
      shoppingSubRank('protein', a) - shoppingSubRank('protein', b) || a.localeCompare(b))
    // both chicken items land before both seafood items — no backtracking
    const chickenIdx = [sorted.indexOf('Ayam'), sorted.indexOf('Tulang Ayam')]
    const seafoodIdx = [sorted.indexOf('Udang'), sorted.indexOf('Cumi-Cumi')]
    expect(Math.max(...chickenIdx)).toBeLessThan(Math.min(...seafoodIdx))
  })

  it('is a no-op outside the protein section', () => {
    expect(shoppingSubRank('veg_main', 'Ayam')).toBe(0)
    expect(shoppingSubRank('bumbu', 'Udang')).toBe(0)
  })
})
