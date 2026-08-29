import { describe, it, expect } from 'vitest'
import {
  buildShoppingList, buildShoppingListFromDishIngredients, normalizeCategory, mergeShoppingItems,
  type DishIngredient, type BuiltList, type ExistingShoppingItem, type ShopCategory,
  type IngredientRef, type DishIngredientLink,
} from './shopping'

type D = { name: string; ingredients: DishIngredient[] | null; qty_amount?: number | null; qty_unit?: string | null; qty_note?: string | null }
function map(dishes: (D & { id: string })[]): Map<string, D> {
  return new Map(dishes.map(d => [d.id, {
    name: d.name, ingredients: d.ingredients, qty_amount: d.qty_amount, qty_unit: d.qty_unit, qty_note: d.qty_note,
  }]))
}

describe('normalizeCategory', () => {
  it('passes through known buckets, lowercased', () => {
    expect(normalizeCategory('Protein')).toBe('protein')
    expect(normalizeCategory('vegetable')).toBe('vegetable')
  })
  it('maps unknown/empty to other', () => {
    expect(normalizeCategory('spice')).toBe('other')
    expect(normalizeCategory(null)).toBe('other')
    expect(normalizeCategory(undefined)).toBe('other')
  })
})

describe('buildShoppingList', () => {
  it('collects dishes with no ingredients into dishesWithoutIngredients (deduped)', () => {
    const dishById = map([
      { id: 'a', name: 'Nasi Goreng', ingredients: null },
      { id: 'b', name: 'Sop Ayam', ingredients: [] },
    ])
    const plans = [
      { dish_id: 'a', dish_name: 'Nasi Goreng' },
      { dish_id: 'b', dish_name: 'Sop Ayam' },
      { dish_id: 'a', dish_name: 'Nasi Goreng' }, // repeat same dish
    ]
    const out = buildShoppingList(plans, dishById)
    expect(out.ingredients).toEqual([])
    expect(out.dishesWithoutIngredients).toEqual(['Nasi Goreng', 'Sop Ayam'])
  })

  it('aggregates same ingredient across dishes, joining distinct quantities and recording from_dishes', () => {
    const dishById = map([
      { id: 'a', name: 'Dish A', ingredients: [
        { name: 'Garlic', quantity: '3 cloves', category: 'vegetable' },
        { name: 'Chicken', quantity: '200g', category: 'protein' },
      ] },
      { id: 'b', name: 'Dish B', ingredients: [
        { name: 'garlic', quantity: '2 cloves', category: 'vegetable' }, // case-insensitive match
        { name: 'Chicken', quantity: '200g', category: 'protein' },       // duplicate quantity -> not repeated
      ] },
    ])
    const plans = [
      { dish_id: 'a', dish_name: 'Dish A' },
      { dish_id: 'b', dish_name: 'Dish B' },
    ]
    const out = buildShoppingList(plans, dishById)
    expect(out.dishesWithoutIngredients).toEqual([])

    const garlic = out.ingredients.find(i => i.ingredient.toLowerCase() === 'garlic')!
    expect(garlic.quantity).toBe('3 cloves + 2 cloves')
    expect(garlic.category).toBe('vegetable')
    expect(garlic.from_dishes).toEqual([
      { dish: 'Dish A', quantity: '3 cloves' },
      { dish: 'Dish B', quantity: '2 cloves' },
    ])

    const chicken = out.ingredients.find(i => i.ingredient === 'Chicken')!
    expect(chicken.quantity).toBe('200g') // duplicate quantity deduped
    expect(chicken.from_dishes.length).toBe(2)
  })

  it('sorts ingredients by category order then name; unknown category -> other', () => {
    const dishById = map([
      { id: 'a', name: 'D', ingredients: [
        { name: 'Sugar', quantity: null, category: 'pantry' },
        { name: 'Zucchini', quantity: null, category: 'vegetable' },
        { name: 'Beef', quantity: null, category: 'protein' },
        { name: 'Ginger', quantity: null, category: 'spice' }, // -> other
      ] },
    ])
    const out = buildShoppingList([{ dish_id: 'a', dish_name: 'D' }], dishById)
    expect(out.ingredients.map(i => [i.category, i.ingredient])).toEqual([
      ['protein', 'Beef'], ['vegetable', 'Zucchini'], ['pantry', 'Sugar'], ['other', 'Ginger'],
    ])
  })

  it('ignores cells with no dish_id', () => {
    const out = buildShoppingList([{ dish_id: null, dish_name: null }], map([]))
    expect(out.ingredients).toEqual([])
    expect(out.dishesWithoutIngredients).toEqual([])
  })

  it('appends the buy amount for a no-ingredients dish that has a qty set', () => {
    const dishById = map([
      { id: 'a', name: 'Kangkung', ingredients: null, qty_amount: 400, qty_unit: 'g' },
    ])
    const out = buildShoppingList([{ dish_id: 'a', dish_name: 'Kangkung' }], dishById)
    expect(out.dishesWithoutIngredients).toEqual(['Kangkung 400g'])
  })

  it('sums the qty across repeat occurrences of the same dish in the week', () => {
    const dishById = map([
      { id: 'a', name: 'Banana', ingredients: [], qty_amount: 3, qty_unit: 'pcs' },
    ])
    const plans = [
      { dish_id: 'a', dish_name: 'Banana' },
      { dish_id: 'a', dish_name: 'Banana' },
    ]
    const out = buildShoppingList(plans, dishById)
    expect(out.dishesWithoutIngredients).toEqual(['Banana 6 pcs'])
  })

  it('falls back to the bare dish name when no qty is set', () => {
    const dishById = map([{ id: 'a', name: 'Nasi Goreng', ingredients: null }])
    const out = buildShoppingList([{ dish_id: 'a', dish_name: 'Nasi Goreng' }], dishById)
    expect(out.dishesWithoutIngredients).toEqual(['Nasi Goreng'])
  })
})

describe('buildShoppingListFromDishIngredients', () => {
  const ingredientById = new Map<string, IngredientRef>([
    ['ayam', { id: 'ayam', name: 'Ayam', category: 'protein', default_unit: 'g' }],
    ['wortel', { id: 'wortel', name: 'Wortel', category: 'veg', default_unit: 'pcs' }],
  ])
  const dishMetaById = new Map([
    ['a', { name: 'Dish A' }],
    ['b', { name: 'Dish B' }],
    ['c', { name: 'Banana', qty_amount: 3, qty_unit: 'pcs' }],
  ])

  it('sums the same ingredient across dishes when units match', () => {
    const links = new Map<string, DishIngredientLink[]>([
      ['a', [{ ingredient_id: 'ayam', amount: 300, unit: 'g' }]],
      ['b', [{ ingredient_id: 'ayam', amount: 200, unit: 'g' }]],
    ])
    const out = buildShoppingListFromDishIngredients(
      [{ dish_id: 'a', dish_name: 'Dish A' }, { dish_id: 'b', dish_name: 'Dish B' }],
      links, ingredientById, dishMetaById,
    )
    const ayam = out.ingredients.find(i => i.ingredient === 'Ayam')!
    expect(ayam.quantity).toBe('500g')
    expect(ayam.category).toBe('protein')
    expect(ayam.from_dishes).toEqual([{ dish: 'Dish A', quantity: '300g' }, { dish: 'Dish B', quantity: '200g' }])
  })

  it('keeps different units of the same ingredient as separate segments', () => {
    const links = new Map<string, DishIngredientLink[]>([
      ['a', [{ ingredient_id: 'wortel', amount: 2, unit: 'pcs' }]],
      ['b', [{ ingredient_id: 'wortel', amount: 100, unit: 'g' }]],
    ])
    const out = buildShoppingListFromDishIngredients(
      [{ dish_id: 'a', dish_name: 'Dish A' }, { dish_id: 'b', dish_name: 'Dish B' }],
      links, ingredientById, dishMetaById,
    )
    const wortel = out.ingredients.find(i => i.ingredient === 'Wortel')!
    expect(wortel.quantity).toBe('2 pcs + 100g')
  })

  it('maps ingredient category veg -> vegetable and sorts protein before veg', () => {
    const links = new Map<string, DishIngredientLink[]>([
      ['a', [{ ingredient_id: 'wortel', amount: 1, unit: 'pcs' }, { ingredient_id: 'ayam', amount: 500, unit: 'g' }]],
    ])
    const out = buildShoppingListFromDishIngredients(
      [{ dish_id: 'a', dish_name: 'Dish A' }], links, ingredientById, dishMetaById,
    )
    expect(out.ingredients.map(i => [i.category, i.ingredient])).toEqual([['protein', 'Ayam'], ['vegetable', 'Wortel']])
  })

  it('tallies a dish with no dish_ingredients rows into dishesWithoutIngredients, summing its qty across repeats', () => {
    const out = buildShoppingListFromDishIngredients(
      [{ dish_id: 'c', dish_name: 'Banana' }, { dish_id: 'c', dish_name: 'Banana' }],
      new Map(), ingredientById, dishMetaById,
    )
    expect(out.dishesWithoutIngredients).toEqual(['Banana 6 pcs'])
  })

  it('excludes shelf_stable ingredients from the buy list, without treating the dish as having no ingredients', () => {
    const withPantry = new Map<string, IngredientRef>([
      ...ingredientById,
      ['garam', { id: 'garam', name: 'Garam', category: 'pantry', default_unit: null, shelf_stable: true }],
    ])
    const links = new Map<string, DishIngredientLink[]>([
      ['a', [{ ingredient_id: 'ayam', amount: 500, unit: 'g' }, { ingredient_id: 'garam', amount: null, unit: 'to taste' }]],
    ])
    const out = buildShoppingListFromDishIngredients(
      [{ dish_id: 'a', dish_name: 'Dish A' }], links, withPantry, dishMetaById,
    )
    expect(out.ingredients.map(i => i.ingredient)).toEqual(['Ayam'])
    expect(out.dishesWithoutIngredients).toEqual([]) // has real (shelf-stable) links, so not "no ingredients"
  })
})

// Build a BuiltList fixture concisely.
function built(
  ingredients: { ingredient: string; category?: ShopCategory; quantity?: string | null; from?: string[] }[],
  noIng: string[] = [],
): BuiltList {
  return {
    ingredients: ingredients.map(i => ({
      ingredient: i.ingredient,
      quantity: i.quantity ?? null,
      category: i.category ?? 'other',
      from_dishes: (i.from ?? ['Dish']).map(d => ({ dish: d })),
    })),
    dishesWithoutIngredients: noIng,
  }
}
// Existing persisted item: auto (plan-derived) unless manual=true.
function ex(id: string, ingredient: string, manual = false): ExistingShoppingItem {
  return { id, ingredient, from_dishes: manual ? null : [{ dish: 'X' }] }
}

describe('mergeShoppingItems', () => {
  it('refreshes a matching auto item instead of recreating it (keeps its id, so checked/already_have survive)', () => {
    const m = mergeShoppingItems([ex('g1', 'Garlic')],
      built([{ ingredient: 'Garlic', category: 'vegetable', quantity: '2 cloves', from: ['Dish A'] }]))
    expect(m.toInsert).toEqual([])
    expect(m.toDelete).toEqual([])
    expect(m.toUpdate).toEqual([{ id: 'g1', quantity: '2 cloves', category: 'vegetable', from_dishes: [{ dish: 'Dish A' }] }])
  })

  it('leaves manual items (from_dishes null) untouched', () => {
    const m = mergeShoppingItems([ex('m1', 'Salt', true)], built([{ ingredient: 'Garlic', category: 'vegetable' }]))
    expect(m.toDelete).toEqual([])
    expect(m.toUpdate).toEqual([])
    expect(m.toInsert.map(r => r.ingredient)).toEqual(['Garlic'])
  })

  it('drops an auto item whose dish left the plan', () => {
    const m = mergeShoppingItems([ex('b1', 'Beef'), ex('g1', 'Garlic')],
      built([{ ingredient: 'Garlic', category: 'vegetable' }]))
    expect(m.toDelete).toEqual(['b1'])
    expect(m.toUpdate.map(u => u.id)).toEqual(['g1'])
    expect(m.toInsert).toEqual([])
  })

  it('inserts brand-new built ingredients', () => {
    const m = mergeShoppingItems([], built([{ ingredient: 'Onion', category: 'vegetable' }]))
    expect(m.toInsert.map(r => r.ingredient)).toEqual(['Onion'])
    expect(m.toUpdate).toEqual([])
    expect(m.toDelete).toEqual([])
  })

  it('matches case-insensitively and removes duplicate auto rows', () => {
    const m = mergeShoppingItems([ex('g1', 'Garlic'), ex('g2', 'garlic')],
      built([{ ingredient: 'GARLIC', category: 'vegetable', from: ['D'] }]))
    expect(m.toUpdate.map(u => u.id)).toEqual(['g1'])
    expect(m.toDelete).toEqual(['g2'])
    expect(m.toInsert).toEqual([])
  })

  it("removes a stale 'dish' placeholder once that dish has ingredients", () => {
    const m = mergeShoppingItems([ex('d1', 'Sop Ayam')],
      built([{ ingredient: 'Chicken', category: 'protein', from: ['Sop Ayam'] }]))
    expect(m.toDelete).toEqual(['d1'])
    expect(m.toInsert.map(r => r.ingredient)).toEqual(['Chicken'])
    expect(m.toUpdate).toEqual([])
  })
})
