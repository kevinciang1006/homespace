import type { Dish, MealPlan, Pick, Slot, Role } from './types'
import { SLOTS, DEFAULT_NO_REPEAT } from './types'
import { daysBetween } from './dates'

export type PickContext = {
  date: string
  slot: Slot
  priorPlans: MealPlan[]
  runPicks: Pick[]
  dishById: Map<string, Dish>
  specialDays: Set<string>
  hardDays: Set<string>
  relax: { spicy: boolean; fried: boolean; saltyCap: boolean; hardDay: boolean; hardSpacing: boolean; noRepeatFactor: number }
  role: Role
  spicyFloor: number
  plannedRemaining: number
}

// Default relax state: every rule enforced (false = ON, matching spicy/fried).
export const ENFORCED: PickContext['relax'] =
  { spicy: false, fried: false, saltyCap: false, hardDay: false, hardSpacing: false, noRepeatFactor: 1 }

export function resolveDish(ctx: PickContext, dishId: string | null): Dish | undefined {
  return dishId ? ctx.dishById.get(dishId) : undefined
}

export function picksForDate(ctx: PickContext, date: string): Pick[] {
  return ctx.runPicks.filter(p => p.plan_date === date)
}

function windowFor(dish: Dish, ctx: PickContext): number {
  const base = dish.no_repeat_days ?? DEFAULT_NO_REPEAT[dish.slot]
  return Math.max(2, Math.round(base * ctx.relax.noRepeatFactor))
}

export function noRepeatOk(dish: Dish, ctx: PickContext): boolean {
  const win = windowFor(dish, ctx)
  const uses = [
    ...ctx.priorPlans.filter(p => p.dish_id === dish.id),
    ...ctx.runPicks.filter(p => p.dish_id === dish.id),
  ]
  for (const u of uses) {
    const gap = Math.abs(daysBetween(u.plan_date, ctx.date))
    if (gap < win) return false
  }
  return true
}

export function proteinOk(dish: Dish, ctx: PickContext): boolean {
  if (ctx.slot !== 'utama') return true
  // previous calendar day's utama protein (from run picks, else prior plans)
  const prevDate = prevDay(ctx.date)
  const prevPick = ctx.runPicks.find(p => p.plan_date === prevDate && p.slot === 'utama')
  let prevProtein: string | undefined
  if (prevPick) prevProtein = resolveDish(ctx, prevPick.dish_id)?.protein
  else {
    const prevPlan = ctx.priorPlans.find(p => p.plan_date === prevDate && p.slot === 'utama')
    prevProtein = prevPlan ? resolveDish(ctx, prevPlan.dish_id)?.protein : undefined
  }
  if (!prevProtein) return true
  return dish.protein !== prevProtein
}

export function specialOk(dish: Dish, ctx: PickContext): boolean {
  // day cap: at most one special dish across all slots
  const dayHasSpecial = picksForDate(ctx, ctx.date).some(
    p => resolveDish(ctx, p.dish_id)?.tier === 'special'
  )
  // Pre-assigned special day: the utama MUST be special (drives the 2/week quota).
  if (ctx.slot === 'utama' && ctx.specialDays.has(ctx.date)) {
    return dish.tier === 'special' && !dayHasSpecial
  }
  if (dish.tier === 'special') {
    if (dayHasSpecial) return false
    if (ctx.slot === 'utama' && !ctx.specialDays.has(ctx.date)) return false
  }
  return true
}

export function friedOk(dish: Dish, ctx: PickContext): boolean {
  if (ctx.relax.fried) return true
  if (dish.method !== 'fried') return true
  const friedCount = picksForDate(ctx, ctx.date).filter(
    p => resolveDish(ctx, p.dish_id)?.method === 'fried'
  ).length
  return friedCount < 2
}

export function spicyOk(dish: Dish, ctx: PickContext): boolean {
  if (ctx.relax.spicy) return true
  if (!dish.spicy) return true
  if (ctx.role === 'optional') return true // desert exempt from the floor
  const counted = picksForDate(ctx, ctx.date).filter(p => !p.skipped && p.role !== 'optional')
  const nonSpicySoFar = counted.filter(p => resolveDish(ctx, p.dish_id)?.spicy === false).length
  // if we pick spicy here, achievable non-spicy = nonSpicySoFar + plannedRemaining
  return nonSpicySoFar + ctx.plannedRemaining >= ctx.spicyFloor
}

export function saltinessOk(dish: Dish, ctx: PickContext): boolean {
  if (ctx.relax.saltyCap) return true
  if (dish.saltiness === 'normal') return true
  const dayHasNonNormal = picksForDate(ctx, ctx.date).some(p => {
    const d = resolveDish(ctx, p.dish_id)
    return !!d && d.saltiness !== 'normal'
  })
  return !dayHasNonNormal
}

export function difficultyOk(dish: Dish, ctx: PickContext): boolean {
  if (dish.difficulty !== 'hard') return true
  if (!ctx.relax.hardDay) {
    if (!ctx.hardDays.has(ctx.date)) return false
    const dayHasHard = picksForDate(ctx, ctx.date).some(p => resolveDish(ctx, p.dish_id)?.difficulty === 'hard')
    if (dayHasHard) return false
  }
  if (!ctx.relax.hardSpacing) {
    for (const ad of [prevDay(ctx.date), nextDay(ctx.date)]) {
      const hardAdj = [...ctx.runPicks, ...ctx.priorPlans].some(
        p => p.plan_date === ad && resolveDish(ctx, p.dish_id)?.difficulty === 'hard')
      if (hardAdj) return false
    }
  }
  return true
}

export function passesHardRules(dish: Dish, ctx: PickContext): boolean {
  return (
    dish.active &&
    dish.slot === ctx.slot &&
    noRepeatOk(dish, ctx) &&
    proteinOk(dish, ctx) &&
    specialOk(dish, ctx) &&
    friedOk(dish, ctx) &&
    spicyOk(dish, ctx) &&
    saltinessOk(dish, ctx) &&
    difficultyOk(dish, ctx)
  )
}

export type Rng = () => number

export function freshnessFactor(dish: Dish, ctx: PickContext): number {
  const base = dish.no_repeat_days ?? DEFAULT_NO_REPEAT[dish.slot]
  const uses = [
    ...ctx.priorPlans.filter(p => p.dish_id === dish.id),
    ...ctx.runPicks.filter(p => p.dish_id === dish.id),
  ]
  if (uses.length === 0) return 2
  const mostRecent = uses.reduce((min, u) => {
    const gap = Math.abs(daysBetween(u.plan_date, ctx.date))
    return gap < min ? gap : min
  }, Infinity)
  return Math.min(2, Math.max(1, mostRecent / base))
}

function saltMainFactor(dish: Dish, ctx: PickContext): number {
  if (ctx.role !== 'main') return 1
  return dish.saltiness === 'normal' ? 1.4 : dish.saltiness === 'very_salty' ? 0.5 : 1
}

export function weightFor(dish: Dish, ctx: PickContext): number {
  return dish.rating * dish.rating * freshnessFactor(dish, ctx) * saltMainFactor(dish, ctx)
}

export function weightedPick(dishes: Dish[], ctx: PickContext, rng: Rng): Dish | undefined {
  if (dishes.length === 0) return undefined
  const weights = dishes.map(d => weightFor(d, ctx))
  const total = weights.reduce((a, b) => a + b, 0)
  if (total <= 0) return dishes[Math.floor(rng() * dishes.length)]
  let r = rng() * total
  for (let i = 0; i < dishes.length; i++) {
    r -= weights[i]
    if (r < 0) return dishes[i]
  }
  return dishes[dishes.length - 1]
}

export function candidates(slotDishes: Dish[], ctx: PickContext): Dish[] {
  return slotDishes.filter(d => passesHardRules(d, ctx))
}

const RELAX_LADDER: { relax: PickContext['relax']; note?: string }[] = [
  { relax: { ...ENFORCED } },
  { relax: { ...ENFORCED, hardSpacing: true }, note: 'relaxed: hard-day spacing' },
  { relax: { ...ENFORCED, hardSpacing: true, hardDay: true }, note: 'relaxed: hard-day restriction' },
  { relax: { ...ENFORCED, hardSpacing: true, hardDay: true, saltyCap: true }, note: 'relaxed: saltiness cap' },
  { relax: { ...ENFORCED, hardSpacing: true, hardDay: true, saltyCap: true, spicy: true }, note: 'relaxed: + spicy floor' },
  { relax: { ...ENFORCED, hardSpacing: true, hardDay: true, saltyCap: true, spicy: true, fried: true }, note: 'relaxed: + fried cap' },
  { relax: { spicy: true, fried: true, saltyCap: true, hardDay: true, hardSpacing: true, noRepeatFactor: 0.5 }, note: 'relaxed: + short no-repeat' },
]

export function pickForSlot(slotDishes: Dish[], ctx: PickContext, rng: Rng): Pick {
  for (const level of RELAX_LADDER) {
    const c: PickContext = { ...ctx, relax: level.relax }
    const pool = candidates(slotDishes, c)
    if (pool.length > 0) {
      const chosen = weightedPick(pool, c, rng)!
      return toPick(ctx, chosen, level.note)
    }
  }
  // last resort: any active dish of the slot, keep min no-repeat (factor 0.5)
  const lastCtx: PickContext = { ...ctx, relax: { spicy: true, fried: true, saltyCap: true, hardDay: true, hardSpacing: true, noRepeatFactor: 0.5 } }
  const anyActive = slotDishes.filter(d => d.active && d.slot === ctx.slot && noRepeatOk(d, lastCtx))
  if (anyActive.length > 0) {
    const chosen = weightedPick(anyActive, lastCtx, rng)!
    return toPick(ctx, chosen, 'relaxed: all soft rules dropped')
  }
  return { plan_date: ctx.date, slot: ctx.slot, dish_id: null, dish_name: null,
    locked: false, role: ctx.role, skipped: false, note: 'no candidate available' }
}

function toPick(ctx: PickContext, dish: Dish, note?: string): Pick {
  return { plan_date: ctx.date, slot: ctx.slot, dish_id: dish.id, dish_name: dish.name,
    locked: false, role: ctx.role, skipped: false, note }
}

export function preassignSpecialDays(
  days: string[], lockedCells: MealPlan[], dishById: Map<string, Dish>, rng: Rng,
): Set<string> {
  const result = new Set<string>()
  // days that already hold ANY locked special count toward the cap
  for (const lc of lockedCells) {
    if (dishById.get(lc.dish_id ?? '')?.tier === 'special') result.add(lc.plan_date)
  }
  const specialPool = [...dishById.values()].some(d => d.slot === 'utama' && d.tier === 'special' && d.active)
  if (!specialPool) return result

  const isAdjacent = (d: string) =>
    [...result].some(r => Math.abs(days.indexOf(r) - days.indexOf(d)) < 2)
  // days with no locked special (day cap = 1 special) and not already chosen
  const lockedSpecialDays = new Set(
    lockedCells.filter(lc => dishById.get(lc.dish_id ?? '')?.tier === 'special').map(lc => lc.plan_date))
  const shuffled = shuffle(days.filter(d => !lockedSpecialDays.has(d)), rng)
  for (const d of shuffled) {
    if (result.size >= 2) break
    if (!isAdjacent(d)) result.add(d)
  }
  return result
}

export function preassignHardDays(days: string[], specialDays: Set<string>, rng: Rng): Set<string> {
  const result = new Set<string>(specialDays)
  const isAdjacent = (d: string) => [...result].some(r => Math.abs(days.indexOf(r) - days.indexOf(d)) < 2)
  for (const d of shuffle(days.filter(x => !result.has(x)), rng)) {
    if (result.size >= 2) break
    if (!isAdjacent(d)) result.add(d)
  }
  return result
}

function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function composeDay(input: {
  date: string
  dishesBySlot: Record<Slot, Dish[]>
  dishById: Map<string, Dish>
  priorPlans: MealPlan[]
  runPicks: Pick[]                       // appended in place with the day's created picks
  lockedByCell: Map<string, MealPlan>    // keyed `${date}|${slot}`
  specialDays: Set<string>
  hardDays: Set<string>
  rng: Rng
}): Pick[] {
  const { date, dishesBySlot, dishById, priorPlans, runPicks, lockedByCell, specialDays, hardDays, rng } = input
  const created: Pick[] = []
  const mkCtx = (slot: Slot, role: Role, plannedRemaining: number): PickContext => ({
    date, slot, priorPlans, runPicks, dishById, specialDays, hardDays,
    relax: { ...ENFORCED },
    role, spicyFloor: 1, plannedRemaining,
  })
  const push = (p: Pick) => { runPicks.push(p); created.push(p) }
  const isLocked = (slot: Slot) => lockedByCell.has(`${date}|${slot}`)
  const lockedDish = (slot: Slot): Dish | undefined => {
    const lc = lockedByCell.get(`${date}|${slot}`)
    return lc?.dish_id ? dishById.get(lc.dish_id) : undefined
  }

  // 1. MAIN
  let main: Dish | undefined
  if (isLocked('utama')) {
    main = lockedDish('utama')
  } else {
    const p = pickForSlot(dishesBySlot.utama ?? [], mkCtx('utama', 'main', 1), rng)
    push(p)
    main = p.dish_id ? dishById.get(p.dish_id) : undefined
  }
  const richness = main?.richness ?? 'medium'
  const extra = richness === 'heavy' ? 0 : 1
  const providesSoup = main?.provides_soup ?? false

  // 3. SOUP skip (only when the main provides soup and kuah isn't locked)
  if (providesSoup && !isLocked('kuah')) {
    push({ plan_date: date, slot: 'kuah', dish_id: null, dish_name: null, locked: false, role: 'support', skipped: true })
  }

  // 4a. VEG — always, free
  if (!isLocked('sayuran')) {
    push(pickForSlot(dishesBySlot.sayuran ?? [], mkCtx('sayuran', 'support', extra), rng))
  }

  // 4b/c. one extra support: a side, or a soup fallback only if no side fits
  if (extra >= 1 && !isLocked('pelengkap')) {
    const preferNonFried = main?.method === 'fried'
    const side = pickPreferNonFried(dishesBySlot.pelengkap ?? [], mkCtx('pelengkap', 'support', 0), rng, preferNonFried)
    if (side.dish_id) push(side)
    else if (!providesSoup && !isLocked('kuah')) {
      const soup = pickForSlot(dishesBySlot.kuah ?? [], mkCtx('kuah', 'support', 0), rng)
      if (soup.dish_id) push(soup)
    }
  }

  // 5. DESERT — always, optional
  if (!isLocked('desert')) {
    push(pickForSlot(dishesBySlot.desert ?? [], mkCtx('desert', 'optional', 0), rng))
  }

  return created
}

function pickPreferNonFried(slotDishes: Dish[], ctx: PickContext, rng: Rng, prefer: boolean): Pick {
  if (prefer) {
    const nonFried = slotDishes.filter(d => d.method !== 'fried')
    const p = pickForSlot(nonFried, ctx, rng)
    if (p.dish_id) return p
  }
  return pickForSlot(slotDishes, ctx, rng)
}

export function generateWeek(input: {
  weekStart: string; days: string[]; dishesBySlot: Record<Slot, Dish[]>
  allDishes: Dish[]; priorPlans: MealPlan[]; lockedCells: MealPlan[]; rng: Rng
}): Pick[] {
  const { days, dishesBySlot, allDishes, priorPlans, lockedCells, rng } = input
  const dishById = new Map(allDishes.map(d => [d.id, d]))
  const specialDays = preassignSpecialDays(days, lockedCells, dishById, rng)
  const hardDays = preassignHardDays(days, specialDays, rng)
  const lockedByCell = new Map(lockedCells.map(l => [`${l.plan_date}|${l.slot}`, l]))
  const runPicks: Pick[] = lockedCells.map(l => ({
    plan_date: l.plan_date, slot: l.slot, dish_id: l.dish_id, dish_name: l.dish_name,
    locked: true, role: l.role ?? 'support', skipped: l.skipped ?? false,
  }))

  for (const date of days) {
    composeDay({ date, dishesBySlot, dishById, priorPlans, runPicks, lockedByCell, specialDays, hardDays, rng })
  }

  const slotOrder = (s: Slot) => SLOTS.indexOf(s)
  return runPicks.sort((a, b) =>
    a.plan_date === b.plan_date ? slotOrder(a.slot) - slotOrder(b.slot)
      : a.plan_date < b.plan_date ? -1 : 1)
}

function prevDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() - 1)
  const yy = dt.getFullYear()
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const dd = String(dt.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + 1)
  const yy = dt.getFullYear()
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const dd = String(dt.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}
