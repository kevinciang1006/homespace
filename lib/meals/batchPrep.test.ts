import { describe, it, expect } from 'vitest'
import {
  stepInstruction, groupBatchPrepByDish, deriveFruitPrepItems, deriveBatchPrepTaskDrafts, formatStepLine,
  sectionForSlot, buildMainLines, buildSoupLines, buildVegLines,
  type BatchPrepIngredientRow, type FruitDishRow, type BatchPrepDishBlock, type FruitPrepItem, type PackingDish,
} from './batchPrep'

describe('formatStepLine', () => {
  it('leads with the ingredient name, then amount, then instruction', () => {
    expect(formatStepLine({ ingredient_name: 'Wortel', amount_display: '2 pcs', instruction: 'potong dadu/sesuai' }))
      .toBe('Wortel (2 pcs) — potong dadu/sesuai')
  })
  it('omits the amount parens when there is no amount', () => {
    expect(formatStepLine({ ingredient_name: 'Sawi Hijau', amount_display: null, instruction: 'potong + cuci' }))
      .toBe('Sawi Hijau — potong + cuci')
  })
  it('disambiguates two ingredients that share the same instruction', () => {
    const kentang = formatStepLine({ ingredient_name: 'Kentang', amount_display: '2 pcs', instruction: 'potong dadu/sesuai' })
    const wortel = formatStepLine({ ingredient_name: 'Wortel', amount_display: '2 pcs', instruction: 'potong dadu/sesuai' })
    expect(kentang).not.toBe(wortel)
  })
})

describe('stepInstruction', () => {
  it('prefers prep_note when present', () => {
    expect(stepInstruction({ ingredient_name: 'Cumi-Cumi', prep_note: 'potong ring', prep_action: 'cut' })).toBe('potong ring')
  })
  it('falls back to a verb + ingredient template when there is no note', () => {
    expect(stepInstruction({ ingredient_name: 'Wortel', prep_note: null, prep_action: 'chop' })).toBe('potong Wortel')
    expect(stepInstruction({ ingredient_name: 'Ayam', prep_note: null, prep_action: 'marinate' })).toBe('marinate Ayam')
  })
  it('trims whitespace-only notes to the fallback', () => {
    expect(stepInstruction({ ingredient_name: 'Bayam', prep_note: '   ', prep_action: 'cut' })).toBe('potong Bayam')
  })
})

describe('groupBatchPrepByDish', () => {
  const rows: BatchPrepIngredientRow[] = [
    { dish_id: 'd1', dish_name: 'Ayam bakar', cook_date: '2026-08-24', ingredient_name: 'Ayam', amount: 600, unit: 'g', prep_action: 'marinate', prep_note: 'marinate bumbu bakar' },
    { dish_id: 'd2', dish_name: 'Cumi cabe setan', cook_date: '2026-08-25', ingredient_name: 'Cumi-Cumi', amount: 500, unit: 'g', prep_action: 'cut', prep_note: 'potong ring' },
    { dish_id: 'd3', dish_name: 'Kuah lobak wortel', cook_date: '2026-08-26', ingredient_name: 'Wortel', amount: 3, unit: 'pcs', prep_action: 'chop', prep_note: 'potong dadu/sesuai' },
    { dish_id: 'd3', dish_name: 'Kuah lobak wortel', cook_date: '2026-08-26', ingredient_name: 'Lobak', amount: 1, unit: 'pcs', prep_action: 'chop', prep_note: 'potong dadu/sesuai' },
  ]

  it('groups multiple ingredients of the same dish into one block', () => {
    const blocks = groupBatchPrepByDish(rows)
    const kuah = blocks.find(b => b.dish_id === 'd3')!
    expect(kuah.steps).toHaveLength(2)
    expect(kuah.steps.map(s => s.ingredient_name)).toEqual(['Wortel', 'Lobak'])
  })

  it('formats each step amount and carries the instruction through', () => {
    const blocks = groupBatchPrepByDish(rows)
    const ayam = blocks.find(b => b.dish_id === 'd1')!
    expect(ayam.steps[0]).toEqual({
      ingredient_name: 'Ayam', amount_display: '600g', prep_action: 'marinate', instruction: 'marinate bumbu bakar',
    })
  })

  it('sorts blocks by cook date then dish name', () => {
    const blocks = groupBatchPrepByDish(rows)
    expect(blocks.map(b => b.dish_id)).toEqual(['d1', 'd2', 'd3'])
  })

  it('collapses a dish repeated across days to its earliest cook date', () => {
    const repeated: BatchPrepIngredientRow[] = [
      { dish_id: 'd1', dish_name: 'Rendang ayam', cook_date: '2026-08-28', ingredient_name: 'Ayam', amount: 600, unit: 'g', prep_action: 'marinate', prep_note: null },
      { dish_id: 'd1', dish_name: 'Rendang ayam', cook_date: '2026-08-24', ingredient_name: 'Ayam', amount: 600, unit: 'g', prep_action: 'marinate', prep_note: null },
    ]
    const blocks = groupBatchPrepByDish(repeated)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].cook_date).toBe('2026-08-24')
    expect(blocks[0].steps).toHaveLength(2) // one prep step per occurrence, not deduped within a dish
  })
})

describe('deriveFruitPrepItems', () => {
  const rows: FruitDishRow[] = [
    { dish_id: 'f1', dish_name: 'Pepaya', cook_date: '2026-08-24', slot: 'fruit', qty_amount: 6, qty_unit: 'slices' },
    { dish_id: 'f1', dish_name: 'Pepaya', cook_date: '2026-08-25', slot: 'fruit', qty_amount: 6, qty_unit: 'slices' },
    { dish_id: 'f2', dish_name: 'Yogurt', cook_date: '2026-08-26', slot: 'desert', qty_amount: 500, qty_unit: 'ml' },
    { dish_id: 'f3', dish_name: 'Kacang ijo', cook_date: '2026-08-27', slot: 'desert', qty_amount: 1, qty_unit: 'pcs' },
    { dish_id: 'f4', dish_name: 'Brownie', cook_date: '2026-08-28', slot: 'desert', qty_amount: 1, qty_unit: 'pcs' },
  ]

  it('includes fruit-slot dishes and Yogurt specifically', () => {
    const items = deriveFruitPrepItems(rows)
    expect(items.map(i => i.dish_name)).toEqual(['Pepaya', 'Yogurt'])
  })

  it('excludes other desert-slot items (bought cake, cooked dessert batch)', () => {
    const items = deriveFruitPrepItems(rows)
    expect(items.some(i => i.dish_name === 'Kacang ijo')).toBe(false)
    expect(items.some(i => i.dish_name === 'Brownie')).toBe(false)
  })

  it('dedupes a fruit repeated across days to its earliest date', () => {
    const items = deriveFruitPrepItems(rows)
    const pepaya = items.find(i => i.dish_name === 'Pepaya')!
    expect(pepaya.cook_date).toBe('2026-08-24')
  })

  it('phrases fruit as "potong <name>, bagi porsi" and Yogurt as its own instruction', () => {
    const items = deriveFruitPrepItems(rows)
    expect(items.find(i => i.dish_name === 'Pepaya')!.instruction).toBe('potong pepaya, bagi porsi')
    expect(items.find(i => i.dish_name === 'Yogurt')!.instruction).toBe('siapkan yogurt porsi kecil')
  })

  it('uses "siapkan" not "potong" for a liquid fruit item (nothing to cut)', () => {
    const items = deriveFruitPrepItems([
      { dish_id: 'f5', dish_name: 'Jus guava', cook_date: '2026-08-24', slot: 'fruit', qty_amount: 500, qty_unit: 'ml' },
    ])
    expect(items[0].instruction).toBe('siapkan jus guava, bagi porsi')
  })

  it('formats the amount from qty_amount/qty_unit', () => {
    const items = deriveFruitPrepItems(rows)
    expect(items.find(i => i.dish_name === 'Yogurt')!.amount_display).toBe('500ml')
  })
})

describe('deriveBatchPrepTaskDrafts', () => {
  const dishBlocks: BatchPrepDishBlock[] = [
    { dish_id: 'd1', dish_name: 'Ayam bakar', cook_date: '2026-08-24', steps: [
      { ingredient_name: 'Ayam', amount_display: '600g', prep_action: 'marinate', instruction: 'marinate bumbu bakar' },
    ] },
  ]
  const fruitItems: FruitPrepItem[] = [
    { dish_id: 'f2', dish_name: 'Yogurt', cook_date: '2026-08-26', amount_display: '500ml', instruction: 'siapkan yogurt porsi kecil' },
  ]

  it('assigns dish-block steps to Wife and fruit items to Kevin', () => {
    const drafts = deriveBatchPrepTaskDrafts('2026-08-24', '2026-08-22', dishBlocks, fruitItems)
    expect(drafts.find(d => d.dish_id === 'd1')!.assigned_to).toBe('Wife')
    expect(drafts.find(d => d.dish_id === 'f2')!.assigned_to).toBe('Kevin')
  })

  it('leads dish-block instructions with the ingredient name (so two ingredients sharing one instruction stay distinguishable)', () => {
    const drafts = deriveBatchPrepTaskDrafts('2026-08-24', '2026-08-22', dishBlocks, fruitItems)
    expect(drafts.find(d => d.dish_id === 'd1')!.instruction).toBe('Ayam (600g) — marinate bumbu bakar')
  })

  it('bakes the amount into a fruit item instruction as before (no ingredient-name ambiguity there)', () => {
    const drafts = deriveBatchPrepTaskDrafts('2026-08-24', '2026-08-22', dishBlocks, fruitItems)
    expect(drafts.find(d => d.dish_id === 'f2')!.instruction).toBe('siapkan yogurt porsi kecil (500ml)')
  })

  it('stamps week_start and prep_date on every draft', () => {
    const drafts = deriveBatchPrepTaskDrafts('2026-08-24', '2026-08-22', dishBlocks, fruitItems)
    for (const d of drafts) {
      expect(d.week_start).toBe('2026-08-24')
      expect(d.prep_date).toBe('2026-08-22')
    }
  })
})

describe('sectionForSlot', () => {
  it('buckets utama and pelengkap into Main', () => {
    expect(sectionForSlot('utama')).toBe('main')
    expect(sectionForSlot('pelengkap')).toBe('main')
  })
  it('buckets kuah into Soup and sayuran into Veg', () => {
    expect(sectionForSlot('kuah')).toBe('soup')
    expect(sectionForSlot('sayuran')).toBe('veg')
  })
  it('returns null for anything outside the packing list (breakfast, fruit, desert)', () => {
    expect(sectionForSlot('breakfast')).toBeNull()
    expect(sectionForSlot('fruit')).toBeNull()
    expect(sectionForSlot('desert')).toBeNull()
  })
})

function dish(overrides: Partial<PackingDish> & { dish_id: string }): PackingDish {
  return { dish_name: 'Dish', cook_date: '2026-08-31', slot: 'utama', bumbu_packet: null, ingredients: [], ...overrides }
}

describe('buildMainLines', () => {
  it('builds a marinate line as "{protein} + {bumbu} — 1 pack ({amount})"', () => {
    const lines = buildMainLines([dish({
      dish_id: 'd1', dish_name: 'Ayam bumbu bakar',
      ingredients: [{ ingredient_name: 'Ayam', category: 'protein', amount: 1, unit: 'kg', prep_action: 'marinate', prep_note: null }],
    })])
    expect(lines).toEqual(['Ayam + bumbu bakar — 1 pack (1kg)'])
  })

  it('derives the bumbu label from bumbu_packet when set, over guessing from the dish name', () => {
    const lines = buildMainLines([dish({
      dish_id: 'd1', dish_name: 'Ayam goreng kalasan', bumbu_packet: 'Bumbu Kalasan',
      ingredients: [{ ingredient_name: 'Ayam', category: 'protein', amount: 600, unit: 'g', prep_action: 'marinate', prep_note: null }],
    })])
    expect(lines).toEqual(['Ayam + bumbu kalasan — 1 pack (600g)'])
  })

  it('builds a cut line as "{protein} potong {style} — 1 pack ({amount})"', () => {
    const lines = buildMainLines([dish({
      dish_id: 'd1', dish_name: 'Cumi goreng',
      ingredients: [{ ingredient_name: 'Cumi-Cumi', category: 'protein', amount: 500, unit: 'g', prep_action: 'cut', prep_note: 'potong ring' }],
    })])
    expect(lines).toEqual(['Cumi-Cumi potong ring — 1 pack (500g)'])
  })

  it('merges two different dishes reducing to the identical headline into one "N pack" line', () => {
    const lines = buildMainLines([
      dish({ dish_id: 'd1', dish_name: 'Cumi goreng',
        ingredients: [{ ingredient_name: 'Cumi-Cumi', category: 'protein', amount: 500, unit: 'g', prep_action: 'cut', prep_note: 'potong ring' }] }),
      dish({ dish_id: 'd2', dish_name: 'Cumi cabe setan',
        ingredients: [{ ingredient_name: 'Cumi-Cumi', category: 'protein', amount: 500, unit: 'g', prep_action: 'cut', prep_note: 'potong ring' }] }),
    ])
    expect(lines).toEqual(['Cumi-Cumi potong ring — 2 pack (500g each)'])
  })

  it('ignores a minor protein (tahu/telur) when a major protein candidate exists', () => {
    const lines = buildMainLines([dish({
      dish_id: 'd1', dish_name: 'Babi kecap telur tahu',
      ingredients: [
        { ingredient_name: 'Daging Babi', category: 'protein', amount: 600, unit: 'g', prep_action: 'marinate', prep_note: null },
        { ingredient_name: 'Tahu', category: 'protein', amount: 2, unit: 'pcs', prep_action: 'marinate', prep_note: null },
      ],
    })])
    expect(lines).toEqual(['Daging Babi + bumbu kecap — 1 pack (600g)'])
  })

  it('skips a dish with no marinate/cut protein at all (nothing to pack ahead)', () => {
    const lines = buildMainLines([dish({
      dish_id: 'd1', dish_name: 'Sambal kentang udang tumis',
      ingredients: [
        { ingredient_name: 'Udang', category: 'protein', amount: 500, unit: 'g', prep_action: 'none', prep_note: null },
        { ingredient_name: 'Kentang', category: 'veg', amount: 2, unit: 'pcs', prep_action: 'chop', prep_note: 'potong dadu/sesuai' },
      ],
    })])
    expect(lines).toEqual([])
  })

  it('only pulls from Main-section slots (utama/pelengkap), not soup or veg', () => {
    const lines = buildMainLines([dish({
      dish_id: 'd1', slot: 'kuah',
      ingredients: [{ ingredient_name: 'Ayam', category: 'protein', amount: 500, unit: 'g', prep_action: 'marinate', prep_note: null }],
    })])
    expect(lines).toEqual([])
  })
})

describe('buildSoupLines', () => {
  it('joins star + wortel + bone base, sentence-cased, no amounts or verbs', () => {
    const lines = buildSoupLines([dish({
      dish_id: 'd1', dish_name: 'Kacang merah', slot: 'kuah',
      ingredients: [
        { ingredient_name: 'Garam', category: 'pantry', amount: null, unit: 'to taste', prep_action: 'none', prep_note: null },
        { ingredient_name: 'Ceker ayam', category: 'protein', amount: 250, unit: 'g', prep_action: 'boil_prep', prep_note: null },
        { ingredient_name: 'Daun Bawang', category: 'veg', amount: 1, unit: 'batang', prep_action: 'none', prep_note: null },
        { ingredient_name: 'Kacang Merah', category: 'veg', amount: 200, unit: 'g', prep_action: 'boil_prep', prep_note: null },
        { ingredient_name: 'Seledri', category: 'veg', amount: 1, unit: 'pcs', prep_action: 'none', prep_note: null },
        { ingredient_name: 'Wortel', category: 'veg', amount: 2, unit: 'pcs', prep_action: 'chop', prep_note: null },
      ],
    })])
    expect(lines).toEqual(['Kacang merah + wortel + ceker'])
  })

  it('uses whatever bone base the dish actually has (tulang ayam), not a fixed "ceker"', () => {
    const lines = buildSoupLines([dish({
      dish_id: 'd1', dish_name: 'Kacang tanah', slot: 'kuah',
      ingredients: [
        { ingredient_name: 'Tulang Ayam', category: 'protein', amount: 5, unit: 'pcs', prep_action: 'boil_prep', prep_note: null },
        { ingredient_name: 'Kacang Tanah', category: 'veg', amount: 200, unit: 'g', prep_action: 'boil_prep', prep_note: null },
        { ingredient_name: 'Wortel', category: 'veg', amount: 2, unit: 'pcs', prep_action: 'chop', prep_note: null },
      ],
    })])
    expect(lines).toEqual(['Kacang tanah + wortel + tulang ayam'])
  })

  it('still produces a line for a soup with no base at all — just the star(s)', () => {
    const lines = buildSoupLines([dish({
      dish_id: 'd1', dish_name: 'Bakso ikan tahu', slot: 'kuah',
      ingredients: [
        { ingredient_name: 'Garam', category: 'pantry', amount: null, unit: 'to taste', prep_action: 'none', prep_note: null },
        { ingredient_name: 'Bakso Ikan', category: 'protein', amount: 8, unit: 'pcs', prep_action: 'none', prep_note: null },
        { ingredient_name: 'Tahu', category: 'protein', amount: 4, unit: 'pcs', prep_action: 'none', prep_note: null },
      ],
    })])
    expect(lines).toEqual(['Bakso ikan + tahu'])
  })

  it('excludes pantry, bumbu packets, and aromatics from the line', () => {
    const lines = buildSoupLines([dish({
      dish_id: 'd1', dish_name: 'Kentang wortel', slot: 'kuah',
      ingredients: [
        { ingredient_name: 'Masako Daging Ayam', category: 'bumbu', amount: 1, unit: 'pack', prep_action: 'none', prep_note: null },
        { ingredient_name: 'Seledri', category: 'veg', amount: 1, unit: 'pcs', prep_action: 'none', prep_note: null },
        { ingredient_name: 'Kentang', category: 'veg', amount: 2, unit: 'pcs', prep_action: 'chop', prep_note: null },
        { ingredient_name: 'Wortel', category: 'veg', amount: 2, unit: 'pcs', prep_action: 'chop', prep_note: null },
      ],
    })])
    expect(lines).toEqual(['Kentang + wortel'])
  })

  it('only pulls from Soup-section slots (kuah)', () => {
    const lines = buildSoupLines([dish({
      dish_id: 'd1', slot: 'sayuran',
      ingredients: [{ ingredient_name: 'Kangkung', category: 'veg', amount: 1, unit: 'ikat', prep_action: 'cut', prep_note: 'potong + cuci' }],
    })])
    expect(lines).toEqual([])
  })
})

describe('buildVegLines', () => {
  it('builds "{veg} — {instruction}"', () => {
    const lines = buildVegLines([dish({
      dish_id: 'd1', dish_name: 'Kangkung pedas', slot: 'sayuran',
      ingredients: [
        { ingredient_name: 'Cabai Rawit', category: 'veg', amount: 10, unit: 'g', prep_action: 'none', prep_note: null },
        { ingredient_name: 'Kangkung', category: 'veg', amount: 1.5, unit: 'ikat', prep_action: 'cut', prep_note: 'potong + cuci' },
      ],
    })])
    expect(lines).toEqual(['Kangkung — potong + cuci'])
  })

  it('skips a veg dish with nothing tagged for prep', () => {
    const lines = buildVegLines([dish({
      dish_id: 'd1', dish_name: 'Cha buncis', slot: 'sayuran',
      ingredients: [{ ingredient_name: 'Buncis', category: 'veg', amount: 1.5, unit: 'ikat', prep_action: 'none', prep_note: null }],
    })])
    expect(lines).toEqual([])
  })

  it('only pulls from Veg-section slots (sayuran)', () => {
    const lines = buildVegLines([dish({
      dish_id: 'd1', slot: 'kuah',
      ingredients: [{ ingredient_name: 'Lobak', category: 'veg', amount: 1, unit: 'pcs', prep_action: 'chop', prep_note: 'potong dadu/sesuai' }],
    })])
    expect(lines).toEqual([])
  })
})
