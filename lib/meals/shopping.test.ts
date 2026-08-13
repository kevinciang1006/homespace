import { describe, it, expect } from 'vitest'
import { buildShoppingList, normalizeCategory, type DishIngredient } from './shopping'

type D = { name: string; ingredients: DishIngredient[] | null }
function map(dishes: (D & { id: string })[]): Map<string, D> {
  return new Map(dishes.map(d => [d.id, { name: d.name, ingredients: d.ingredients }]))
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
})
