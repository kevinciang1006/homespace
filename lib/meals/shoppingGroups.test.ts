import { describe, it, expect } from 'vitest'
import { classifyShoppingGroup, sectionOf, SHOPPING_GROUP_RANK, SHOPPING_SECTION_ORDER } from './shoppingGroups'

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
