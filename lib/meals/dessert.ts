import type { Dish } from './types'

type Rng = () => number

export const DESSERT_WEEK_CAP = 2
const CAKE_WEIGHT_MULTIPLIER = 0.15 // cakes are a rare monthly treat, not a normal weekly pick
const REPEAT_WEEK_PENALTY = 0.3     // prefer a different item than last week's batch when possible

export type DessertBatchOptions = {
  cakeEligible?: boolean       // false when a dessert_cake appeared within the monthly cooldown window
  lastWeekBatchIds?: string[]  // dish_ids from the immediately preceding week's batch
}

function dessertCandidateWeight(d: Dish, options: DessertBatchOptions): number {
  let w = d.rating * d.rating
  if (d.produce_role === 'dessert_cake') w *= CAKE_WEIGHT_MULTIPLIER
  if (options.lastWeekBatchIds?.includes(d.id)) w *= REPEAT_WEEK_PENALTY
  return w
}

// Weighted (no replacement) pick of up to `cap` dessert dishes for the
// week's batch, mixing normal weekly staples (produce_role='dessert_batch',
// or untagged) with occasional monthly cakes (produce_role='dessert_cake')
// at a much lower weight — a cake can still win a slot, just rarely, and
// only when `cakeEligible` says none has appeared within its cooldown
// window. `mustInclude` (dish_ids from any locked desert-slot day-cells)
// are always kept first, so regenerating the batch never orphans a dish an
// existing lock depends on.
export function pickDessertBatch(
  pool: Dish[], mustInclude: string[], cap: number, rng: Rng, options: DessertBatchOptions = {},
): Dish[] {
  const cakeEligible = options.cakeEligible ?? true
  const eligible = pool.filter(d =>
    d.active && !d.is_garnish && (d.produce_role !== 'dessert_cake' || cakeEligible))
  const byId = new Map(eligible.map(d => [d.id, d]))
  const batch: Dish[] = []
  for (const id of mustInclude) {
    const d = byId.get(id)
    if (d && !batch.includes(d)) batch.push(d)
  }
  const remainingPool = eligible.filter(d => !batch.includes(d))
  const weights = remainingPool.map(d => dessertCandidateWeight(d, options))
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
