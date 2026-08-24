import type { Dish } from './types'

type Rng = () => number

export const DESSERT_WEEK_CAP = 3

// Weighted (rating^2, no replacement) pick of up to `cap` dessert dishes for
// the week's batch. `mustInclude` (dish_ids from any locked desert-slot
// day-cells) are always kept first, so regenerating the batch never orphans
// a dish an existing lock depends on.
export function pickDessertBatch(pool: Dish[], mustInclude: string[], cap: number, rng: Rng): Dish[] {
  const eligible = pool.filter(d => d.active && !d.is_garnish)
  const byId = new Map(eligible.map(d => [d.id, d]))
  const batch: Dish[] = []
  for (const id of mustInclude) {
    const d = byId.get(id)
    if (d && !batch.includes(d)) batch.push(d)
  }
  const remainingPool = eligible.filter(d => !batch.includes(d))
  const weights = remainingPool.map(d => d.rating * d.rating)
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
