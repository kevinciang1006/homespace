import { describe, it, expect } from 'vitest'
import {
  stepInstruction, groupBatchPrepByDish, deriveFruitPrepItems, deriveBatchPrepTaskDrafts, formatStepLine,
  type BatchPrepIngredientRow, type FruitDishRow, type BatchPrepDishBlock, type FruitPrepItem,
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
