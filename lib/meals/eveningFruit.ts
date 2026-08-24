import type { Dish } from './types'

type Rng = () => number

export const EVENING_FRUIT_WEEK_CAP = 2   // max distinct fruit variations shown in the evening per week
export const EVENING_FRUIT_MIN_DAYS = 2   // opportunistic: only some days get an evening-fruit card
export const EVENING_FRUIT_MAX_DAYS = 3
const OCCASIONAL_WEIGHT_MULTIPLIER = 0.4  // occasional-cadence fruits (Semangka, berries) are a fallback, not the default

export type EveningFruitOptions = {
  monthlyEligible?: boolean  // false when a monthly evening_fruit appeared within its cooldown window
}

function eveningFruitWeight(d: Dish): number {
  const w = d.rating * d.rating
  if (d.cadence === 'occasional') return w * OCCASIONAL_WEIGHT_MULTIPLIER
  return w
}

// Weighted (no replacement) pick of up to `cap` distinct evening-fruit
// dishes for the week. Monthly-cadence fruits (Apple/Jeruk/Pear) are only
// candidates when `monthlyEligible` says none has appeared within its
// cooldown window; occasional-cadence fruits (Semangka, berries) are always
// eligible but weighted down so they read as a fallback flavor, not the
// week's default. `mustInclude` (dish_ids from any locked evening-fruit
// day-cells) are always kept first, mirroring pickDessertBatch.
export function pickEveningFruitBatch(
  pool: Dish[], mustInclude: string[], cap: number, rng: Rng, options: EveningFruitOptions = {},
): Dish[] {
  const monthlyEligible = options.monthlyEligible ?? true
  const eligible = pool.filter(d =>
    d.active && !d.is_garnish && (d.cadence !== 'monthly' || monthlyEligible))
  const byId = new Map(eligible.map(d => [d.id, d]))
  const batch: Dish[] = []
  for (const id of mustInclude) {
    const d = byId.get(id)
    if (d && !batch.includes(d)) batch.push(d)
  }
  const remainingPool = eligible.filter(d => !batch.includes(d))
  const weights = remainingPool.map(d => eveningFruitWeight(d))
  const picked = new Set<number>()
  while (batch.length < cap && picked.size < remainingPool.length) {
    const total = remainingPool.reduce((sum, d, i) => picked.has(i) ? sum : sum + weights[i], 0)
    if (total <= 0) break
    let r = rng() * total
    let chosenIdx = -1
    for (let i = 0; i < remainingPool.length; i++) {
      if (picked.has(i)) continue
      r -= weights[i]
      if (r < 0) { chosenIdx = i; break }
    }
    if (chosenIdx === -1) chosenIdx = remainingPool.findIndex((_, i) => !picked.has(i))
    picked.add(chosenIdx)
    batch.push(remainingPool[chosenIdx])
  }
  return batch
}
