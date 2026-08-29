import { describe, it, expect } from 'vitest'
import {
  sumShopIngredients, composeWeeklyShoppingMessage, composeMealOverview,
  composeDailyReminderMessage, composePrepThawMessage,
  composeBatchPrepWifeMessage, composeBatchPrepKevinMessage,
} from './messages'

describe('sumShopIngredients', () => {
  it('sums duplicate items (case-insensitive) sharing a unit', () => {
    const result = sumShopIngredients([
      { item: 'Ayam', amount: 500, unit: 'g', category: 'protein' },
      { item: 'ayam', amount: 300, unit: 'g', category: 'protein' },
    ])
    expect(result).toEqual([{ ingredient: 'Ayam', quantity: '800g', category: 'protein' }])
  })
  it('converts g/kg to one base unit instead of keeping them apart', () => {
    const result = sumShopIngredients([
      { item: 'Ayam', amount: 1, unit: 'kg', category: 'protein' },
      { item: 'ayam', amount: 600, unit: 'g', category: 'protein' },
    ])
    expect(result).toEqual([{ ingredient: 'Ayam', quantity: '1.6kg', category: 'protein' }])
  })
  it('prefers weight over a count unit when both are present for the same item', () => {
    const result = sumShopIngredients([
      { item: 'Ikan', amount: 2, unit: 'ekor', category: 'protein' },
      { item: 'Ikan', amount: 400, unit: 'g', category: 'protein' },
    ])
    expect(result).toEqual([{ ingredient: 'Ikan', quantity: '400g', category: 'protein' }])
  })
})

describe('composeWeeklyShoppingMessage', () => {
  it('groups protein -> sayur -> bumbu -> buah, with headers, no "+"-joined amounts, and drops Lainnya entirely', () => {
    const msg = composeWeeklyShoppingMessage([
      { ingredient: 'Kangkung', quantity: '400g', category: 'vegetable' },
      { ingredient: 'Bumbu Rendang', quantity: null, category: 'bumbu' },
      { ingredient: 'Cabai Rawit', quantity: '100g', category: 'vegetable' }, // aromatic -> bumbu group, after packets
      { ingredient: 'Ayam', quantity: '1kg', category: 'protein' },
      { ingredient: 'Banana', quantity: null, category: 'dish' }, // fruit-slot dish w/ no ingredients
      { ingredient: 'Yogurt', quantity: null, category: 'dish' }, // not fruit -> lainnya -> dropped
      { ingredient: 'Tahu', quantity: null, category: 'other' }, // -> lainnya -> dropped
    ])
    expect(msg).toContain('🥩 Protein')
    expect(msg).toContain('🥦 Sayur')
    expect(msg).toContain('🧂 Bumbu')
    expect(msg).toContain('🍎 Buah')
    expect(msg).not.toContain('Lainnya')
    const lines = msg.split('\n').filter(l => l.startsWith('- '))
    expect(lines).toEqual(['- Ayam 1kg', '- Kangkung 400g', '- Bumbu Rendang', '- Cabai Rawit 100g', '- Banana'])
    expect(msg).not.toContain('Yogurt')
    expect(msg).not.toContain('Tahu')
    expect(msg).not.toContain('+')
    expect(msg).toContain('🛒 Belanja minggu ini:')
    expect(msg).toContain('Makasih ya 🧡')
    expect(msg).toContain('https://homespace-chi.vercel.app/meals/shopping')
  })

  it('falls back to the "nothing to buy" message when everything present is Lainnya', () => {
    const msg = composeWeeklyShoppingMessage([{ ingredient: 'Yogurt', quantity: null, category: 'dish' }])
    expect(msg).toContain('Belum ada yang perlu dibeli')
  })

  it('bumbu packets sort before aromatics within the same Bumbu group', () => {
    const msg = composeWeeklyShoppingMessage([
      { ingredient: 'Jahe', quantity: '100g', category: 'vegetable' },
      { ingredient: 'Bumbu Rendang', quantity: null, category: 'bumbu' },
    ])
    const lines = msg.split('\n').filter(l => l.startsWith('- '))
    expect(lines).toEqual(['- Bumbu Rendang', '- Jahe 100g'])
  })

  it('maps "veg" category the same as "vegetable"', () => {
    const msg = composeWeeklyShoppingMessage([
      { ingredient: 'Buncis', quantity: '250g', category: 'veg' },
    ])
    const lines = msg.split('\n').filter(l => l.startsWith('- '))
    expect(lines).toEqual(['- Buncis 250g'])
  })

  it('returns a graceful message when there is nothing to buy, still linking to the shopping page', () => {
    const msg = composeWeeklyShoppingMessage([])
    expect(msg).toContain('https://homespace-chi.vercel.app/meals/shopping')
    expect(msg).not.toContain('- ')
  })

  it('includes the week param so the link opens to the right week, not just today', () => {
    const withItems = composeWeeklyShoppingMessage([{ ingredient: 'Ayam', quantity: '1kg', category: 'protein' }], '2026-08-24')
    expect(withItems).toContain('https://homespace-chi.vercel.app/meals/shopping?week=2026-08-24')
    const empty = composeWeeklyShoppingMessage([], '2026-08-24')
    expect(empty).toContain('https://homespace-chi.vercel.app/meals/shopping?week=2026-08-24')
  })
})

describe('composeMealOverview', () => {
  const weekStart = '2026-08-24' // Monday

  it('orders each day as main -> soup/veg -> helper, skipping breakfast/fruit/desert', () => {
    const overview = composeMealOverview(weekStart, [
      { plan_date: '2026-08-24', slot: 'breakfast', dish_name: 'Bubur ayam', skipped: false },
      { plan_date: '2026-08-24', slot: 'utama', dish_name: 'Ayam bumbu bakar', skipped: false },
      { plan_date: '2026-08-24', slot: 'pelengkap', dish_name: 'Tahu goreng', skipped: false },
      { plan_date: '2026-08-24', slot: 'kuah', dish_name: 'Sop bayam jagung', skipped: false },
      { plan_date: '2026-08-24', slot: 'sayuran', dish_name: 'Cha buncis', skipped: false },
      { plan_date: '2026-08-24', slot: 'fruit', dish_name: 'Banana', skipped: false },
      { plan_date: '2026-08-24', slot: 'desert', dish_name: 'Yogurt', skipped: false },
    ])
    expect(overview).not.toBeNull()
    expect(overview).not.toContain('Bubur ayam')
    expect(overview).not.toContain('Banana')
    expect(overview).not.toContain('Yogurt')
    const dayLine = overview!.split('\n').find(l => l.startsWith('Sen'))!
    expect(dayLine).toBe('Sen 24/8: Ayam bumbu bakar, Sop bayam jagung, Cha buncis, Tahu goreng')
    expect(overview).toContain('https://homespace-chi.vercel.app/meals?week=2026-08-24')
  })

  it('skips skipped rows and days with nothing planned', () => {
    const overview = composeMealOverview(weekStart, [
      { plan_date: '2026-08-24', slot: 'utama', dish_name: 'Ayam', skipped: true },
      { plan_date: '2026-08-25', slot: 'utama', dish_name: null, skipped: false },
    ])
    expect(overview).toBeNull()
  })

  it('returns null for an empty week', () => {
    expect(composeMealOverview(weekStart, [])).toBeNull()
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
    expect(msg).toContain('https://homespace-chi.vercel.app/meals/day/2026-08-24')
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
    expect(msg).toContain('https://homespace-chi.vercel.app/meals/day/2026-08-24')
  })

  it('derives "thaw" alone when only needs_thaw is set', () => {
    const msg = composePrepThawMessage([
      { dish_name: 'Ikan', cook_date: '2026-08-24', needs_thaw: true, needs_marinate: false, prep_note: null },
    ])
    expect(msg).toContain('Ikan (Senin) — thaw')
  })

  it('links to the earliest cook date in the batch regardless of input order', () => {
    const msg = composePrepThawMessage([
      { dish_name: 'Babi', cook_date: '2026-08-27', needs_thaw: false, needs_marinate: true, prep_note: null },
      { dish_name: 'Ayam', cook_date: '2026-08-24', needs_thaw: true, needs_marinate: true, prep_note: null },
    ])
    expect(msg).toContain('https://homespace-chi.vercel.app/meals/day/2026-08-24')
  })
})

describe('composeBatchPrepWifeMessage', () => {
  it('returns null when there are no dish blocks', () => {
    expect(composeBatchPrepWifeMessage([], '2026-08-24')).toBeNull()
  })

  it('groups multi-step dishes onto one line, joined with "; "', () => {
    const msg = composeBatchPrepWifeMessage([
      { dish_name: 'Kuah lobak wortel', steps: [
        { instruction: 'potong wortel & lobak', amount_display: '3 pcs' },
        { instruction: 'siapkan bareng Bamboe SOP untuk direbus', amount_display: '1 pack' },
      ] },
    ], '2026-08-24')
    expect(msg).toContain('🥕 Kuah lobak wortel — potong wortel & lobak (3 pcs); siapkan bareng Bamboe SOP untuk direbus (1 pack)')
  })

  it('picks a dish emoji by protein keyword and ends with the wife-view prep link', () => {
    const msg = composeBatchPrepWifeMessage([
      { dish_name: 'Ayam bakar', steps: [{ instruction: 'marinate bumbu bakar', amount_display: '600g' }] },
      { dish_name: 'Cumi cabe setan', steps: [{ instruction: 'potong ring', amount_display: '500g' }] },
    ], '2026-08-24')
    expect(msg).toContain('🍗 Ayam bakar — marinate bumbu bakar (600g)')
    expect(msg).toContain('🦑 Cumi cabe setan — potong ring (500g)')
    expect(msg).toContain('https://homespace-chi.vercel.app/meals/prep?week=2026-08-24&who=wife')
  })

  it('omits the amount parens when a step has no amount', () => {
    const msg = composeBatchPrepWifeMessage([
      { dish_name: 'Bayam tumis', steps: [{ instruction: 'potong + cuci', amount_display: null }] },
    ], '2026-08-24')
    expect(msg).toContain('Bayam tumis — potong + cuci')
    expect(msg).not.toContain('potong + cuci (')
  })
})

describe('composeBatchPrepKevinMessage', () => {
  it('returns null when there are no fruit items', () => {
    expect(composeBatchPrepKevinMessage([], '2026-08-24')).toBeNull()
  })

  it('lists each item as a bullet with its amount and ends with the kevin-view prep link', () => {
    const msg = composeBatchPrepKevinMessage([
      { instruction: 'potong pepaya, bagi porsi', amount_display: '6 slices' },
      { instruction: 'siapkan yogurt porsi kecil', amount_display: '500ml' },
    ], '2026-08-24')
    expect(msg).toContain('🍌 Prep buah minggu ini:')
    expect(msg).toContain('• potong pepaya, bagi porsi (6 slices)')
    expect(msg).toContain('• siapkan yogurt porsi kecil (500ml)')
    expect(msg).toContain('https://homespace-chi.vercel.app/meals/prep?week=2026-08-24&who=kevin')
  })
})
