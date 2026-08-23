import { describe, it, expect } from 'vitest'
import {
  sumShopIngredients, composeWeeklyShoppingMessage, composeDailyReminderMessage, composePrepThawMessage,
} from './messages'

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
  it('renders a flat list sorted protein -> veg -> bumbu -> other, no headers', () => {
    const msg = composeWeeklyShoppingMessage([
      { ingredient: 'Kangkung', quantity: '400g', category: 'vegetable' },
      { ingredient: 'Bumbu Rendang', quantity: null, category: 'bumbu' },
      { ingredient: 'Ayam', quantity: '1kg', category: 'protein' },
      { ingredient: 'Tahu', quantity: null, category: 'other' },
    ])
    expect(msg).not.toContain('*Protein*')
    expect(msg).not.toContain('*Sayur*')
    expect(msg).not.toContain('*Bumbu*')
    expect(msg).not.toContain('*Lainnya*')
    const lines = msg.split('\n').filter(l => l.startsWith('- '))
    expect(lines).toEqual(['- Ayam 1kg', '- Kangkung 400g', '- Bumbu Rendang', '- Tahu'])
    expect(msg).toContain('🛒 Belanja minggu ini:')
    expect(msg).toContain('Makasih ya 🧡')
    expect(msg).toContain('https://homespace-chi.vercel.app/meals/shopping')
  })

  it('maps "veg" and "pantry" categories into the same sort position as "vegetable" and "other"', () => {
    const msg = composeWeeklyShoppingMessage([
      { ingredient: 'Garam khusus', quantity: null, category: 'pantry' },
      { ingredient: 'Buncis', quantity: '250g', category: 'veg' },
    ])
    const lines = msg.split('\n').filter(l => l.startsWith('- '))
    expect(lines).toEqual(['- Buncis 250g', '- Garam khusus'])
  })

  it('returns a graceful message when there is nothing to buy, still linking to the shopping page', () => {
    const msg = composeWeeklyShoppingMessage([])
    expect(msg).toContain('https://homespace-chi.vercel.app/meals/shopping')
    expect(msg).not.toContain('- ')
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

describe('composePrepThawMessage', () => {
  it('returns null for an empty batch', () => {
    expect(composePrepThawMessage([])).toBeNull()
  })

  it('uses prep_note when present, else derives a phrase from the flags', () => {
    const msg = composePrepThawMessage([
      { dish_name: 'Ayam', cook_date: '2026-08-24', needs_thaw: true, needs_marinate: true, prep_note: null },
      {
        dish_name: 'Babi', cook_date: '2026-08-27', needs_thaw: false, needs_marinate: true,
        prep_note: 'bisa marinate sekarang, tahan seminggu',
      },
    ])
    expect(msg).toContain('🧊 Malam ini siapkan:')
    expect(msg).toContain('Ayam (Senin) — thaw + marinate') // 2026-08-24 is Monday
    expect(msg).toContain('Babi (Kamis) — bisa marinate sekarang, tahan seminggu') // 2026-08-27 is Thursday
    expect(msg).toContain('https://homespace-chi.vercel.app')
  })

  it('derives "thaw" alone when only needs_thaw is set', () => {
    const msg = composePrepThawMessage([
      { dish_name: 'Ikan', cook_date: '2026-08-24', needs_thaw: true, needs_marinate: false, prep_note: null },
    ])
    expect(msg).toContain('Ikan (Senin) — thaw')
  })
})
