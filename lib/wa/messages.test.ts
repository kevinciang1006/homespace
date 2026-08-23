import { describe, it, expect } from 'vitest'
import { sumShopIngredients, composeWeeklyShoppingMessage, composeDailyReminderMessage } from './messages'

describe('sumShopIngredients', () => {
  it('sums duplicate items (case-insensitive) sharing a unit', () => {
    const result = sumShopIngredients([
      { item: 'Ayam', amount: 500, unit: 'g', category: 'protein' },
      { item: 'ayam', amount: 300, unit: 'g', category: 'protein' },
    ])
    expect(result).toEqual([{ ingredient: 'Ayam', quantity: '800g', category: 'protein' }])
  })
  it('keeps different units of the same item separate', () => {
    const result = sumShopIngredients([
      { item: 'Ikan', amount: 2, unit: 'ekor', category: 'protein' },
      { item: 'Ikan', amount: 400, unit: 'g', category: 'protein' },
    ])
    expect(result).toHaveLength(2)
  })
})

describe('composeWeeklyShoppingMessage', () => {
  it('groups items into Protein / Sayur / Bumbu / Lainnya', () => {
    const msg = composeWeeklyShoppingMessage([
      { ingredient: 'Ayam', quantity: '1kg', category: 'protein' },
      { ingredient: 'Kangkung', quantity: '400g', category: 'vegetable' },
      { ingredient: 'Bumbu Rendang', quantity: null, category: 'bumbu' },
      { ingredient: 'Tahu', quantity: null, category: 'other' },
    ])
    expect(msg).toContain('*Protein*\n- Ayam 1kg')
    expect(msg).toContain('*Sayur*\n- Kangkung 400g')
    expect(msg).toContain('*Bumbu*\n- Bumbu Rendang')
    expect(msg).toContain('*Lainnya*\n- Tahu')
    expect(msg).toContain('https://homespace-chi.vercel.app')
  })
  it('omits a group heading entirely when it has no items', () => {
    const msg = composeWeeklyShoppingMessage([{ ingredient: 'Ayam', quantity: '1kg', category: 'protein' }])
    expect(msg).not.toContain('Sayur')
    expect(msg).not.toContain('Bumbu')
    expect(msg).not.toContain('Lainnya')
  })
  it('returns a graceful message when there is nothing to buy', () => {
    const msg = composeWeeklyShoppingMessage([])
    expect(msg).toContain('https://homespace-chi.vercel.app')
    expect(msg).not.toContain('*Protein*')
  })
  it('maps "veg" and "pantry" categories the same as "vegetable" and "other"', () => {
    const msg = composeWeeklyShoppingMessage([
      { ingredient: 'Buncis', quantity: '250g', category: 'veg' },
      { ingredient: 'Garam khusus', quantity: null, category: 'pantry' },
    ])
    expect(msg).toContain('*Sayur*\n- Buncis 250g')
    expect(msg).toContain('*Lainnya*\n- Garam khusus')
  })
})

describe('composeDailyReminderMessage', () => {
  const base = { dish_id: 'd1', skipped: false }

  it('returns null when nothing is planned for that date', () => {
    expect(composeDailyReminderMessage('2026-08-24', [])).toBeNull()
  })

  it('composes breakfast, dinner main+support, and fruit', () => {
    const msg = composeDailyReminderMessage('2026-08-24', [
      { ...base, slot: 'breakfast', role: 'breakfast', dish_name: 'Bubur ayam' },
      { ...base, slot: 'utama', role: 'main', dish_name: 'Ayam bakar' },
      { ...base, slot: 'sayuran', role: 'support', dish_name: 'Tumis kangkung' },
      { ...base, slot: 'fruit', role: 'optional', dish_name: 'Pisang' },
    ])
    expect(msg).toContain('Senin') // 2026-08-24 is a Monday
    expect(msg).toContain('🌅 Sarapan: Bubur ayam')
    expect(msg).toContain('🍽️ Makan malam: Ayam bakar + Tumis kangkung')
    expect(msg).toContain('🍎 Buah: Pisang')
    expect(msg).toContain('https://homespace-chi.vercel.app')
  })

  it('skips missing sections and ignores skipped/optional rows', () => {
    const msg = composeDailyReminderMessage('2026-08-24', [
      { ...base, slot: 'utama', role: 'main', dish_name: 'Ayam bakar' },
      { ...base, slot: 'desert', role: 'optional', dish_name: 'Puding', skipped: false },
      { ...base, slot: 'kuah', role: 'support', dish_name: 'Sup', skipped: true },
    ])
    expect(msg).not.toContain('Sarapan')
    expect(msg).not.toContain('Buah')
    expect(msg).not.toContain('Puding')
    expect(msg).not.toContain('Sup')
    expect(msg).toContain('🍽️ Makan malam: Ayam bakar')
  })
})
