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
  relax: { spicy: boolean; fried: boolean; hardDay: boolean; hardSpacing: boolean; proteinClash: boolean; spicyMainSpacing: boolean; noRepeatFactor: number }
  role: Role
  spicyFloor: number
  plannedRemaining: number
}

// Default relax state: every relaxable rule enforced (false = ON, matching spicy/fried).
// The saltiness cap (<=1 non-normal per day) is a hard rule and is NOT relaxable.
export const ENFORCED: PickContext['relax'] =
  { spicy: false, fried: false, hardDay: false, hardSpacing: false, proteinClash: false, spicyMainSpacing: false, noRepeatFactor: 1 }

// Proteins that count as "the same" for the no-repeat-on-a-plate rule.
// egg, tofu_tempe, none and mixed are neutral staples and never clash.
export const MEAT_PROTEINS = new Set(['chicken', 'beef', 'pork', 'fish', 'shrimp', 'squid', 'crab', 'duck'])

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

// No two dishes on the same plate may share a "real" protein (main included).
// e.g. a chicken main blocks any chicken support; neutral proteins never clash.
export function proteinClashOk(dish: Dish, ctx: PickContext): boolean {
  if (ctx.relax.proteinClash) return true
  if (!MEAT_PROTEINS.has(dish.protein)) return true
  return !picksForDate(ctx, ctx.date).some(p => resolveDish(ctx, p.dish_id)?.protein === dish.protein)
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
  // Hard rule, never relaxed: at most one dish with saltiness !== 'normal' per day.
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

export function spicyMainSpacingOk(dish: Dish, ctx: PickContext): boolean {
  if (ctx.relax.spicyMainSpacing) return true
  if (ctx.slot !== 'utama' || !dish.spicy) return true
  for (const ad of [prevDay(ctx.date), nextDay(ctx.date)]) {
    const adjSpicyMain = [...ctx.runPicks, ...ctx.priorPlans].some(
      p => p.plan_date === ad && p.slot === 'utama' && resolveDish(ctx, p.dish_id)?.spicy)
    if (adjSpicyMain) return false
  }
  return true
}

export function passesHardRules(dish: Dish, ctx: PickContext): boolean {
  return (
    dish.active &&
    !dish.is_garnish &&
    dish.slot === ctx.slot &&
    noRepeatOk(dish, ctx) &&
    proteinOk(dish, ctx) &&
    proteinClashOk(dish, ctx) &&
    specialOk(dish, ctx) &&
    friedOk(dish, ctx) &&
    spicyOk(dish, ctx) &&
    saltinessOk(dish, ctx) &&
    difficultyOk(dish, ctx) &&
    spicyMainSpacingOk(dish, ctx)
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

// Soft nudge: discourage a spicy main when a neighbouring day already has one, spreading spicy out.
function spicySpreadFactor(dish: Dish, ctx: PickContext): number {
  if (ctx.role !== 'main' || !dish.spicy) return 1
  const neighborSpicy = [prevDay(ctx.date), nextDay(ctx.date)].some(ad =>
    [...ctx.runPicks, ...ctx.priorPlans].some(
      p => p.plan_date === ad && p.slot === 'utama' && resolveDish(ctx, p.dish_id)?.spicy))
  return neighborSpicy ? 0.5 : 1
}

export function weightFor(dish: Dish, ctx: PickContext): number {
  return dish.rating * dish.rating * freshnessFactor(dish, ctx) * saltMainFactor(dish, ctx) * spicySpreadFactor(dish, ctx)
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
  { relax: { ...ENFORCED, hardSpacing: true, hardDay: true, spicy: true }, note: 'relaxed: + spicy floor' },
  { relax: { ...ENFORCED, hardSpacing: true, hardDay: true, spicy: true, fried: true }, note: 'relaxed: + fried cap' },
  { relax: { ...ENFORCED, hardSpacing: true, hardDay: true, spicy: true, fried: true, proteinClash: true }, note: 'relaxed: + protein variety' },
  { relax: { ...ENFORCED, hardSpacing: true, hardDay: true, spicy: true, fried: true, proteinClash: true, spicyMainSpacing: true }, note: 'relaxed: + spicy-main spacing' },
  { relax: { spicy: true, fried: true, hardDay: true, hardSpacing: true, proteinClash: true, spicyMainSpacing: true, noRepeatFactor: 0.5 }, note: 'relaxed: + short no-repeat' },
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
  // last resort: any active dish of the slot, keep min no-repeat (factor 0.5).
  // Saltiness cap is still enforced here — never place a 2nd salty dish, even at last resort.
  const lastCtx: PickContext = { ...ctx, relax: { spicy: true, fried: true, hardDay: true, hardSpacing: true, proteinClash: true, spicyMainSpacing: true, noRepeatFactor: 0.5 } }
  const anyActive = slotDishes.filter(d => d.active && !d.is_garnish && d.slot === ctx.slot && noRepeatOk(d, lastCtx) && saltinessOk(d, lastCtx))
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

// A provides_soup main frees the kuah slot; fill it with an extra vegetable (stored in the
// kuah slot to satisfy the one-row-per-slot constraint) picked under the sayuran rules, or
// fall back to the broth note when no distinct second vegetable fits.
function secondVegForKuah(sayuranPool: Dish[], ctx: PickContext, date: string, rng: Rng): Pick {
  const veg = pickForSlot(sayuranPool, ctx, rng)
  if (veg.dish_id) return { ...veg, slot: 'kuah' }
  return { plan_date: date, slot: 'kuah', dish_id: null, dish_name: null, locked: false, role: 'support', skipped: true }
}

// Consistency check for stored plans: a provides_soup main must NOT share its day with a
// separate soup dish (a real kuah-slot dish) in the kuah slot. Returns the ids of such
// stale, non-locked soup rows so callers can blank them to the broth note. A second
// vegetable already occupying the kuah slot (dishes.slot === 'sayuran') and locked rows
// are left untouched (honor the lock).
export function staleSoupRowIds(rows: MealPlan[]): string[] {
  const byDate = new Map<string, MealPlan[]>()
  for (const r of rows) {
    if (!byDate.has(r.plan_date)) byDate.set(r.plan_date, [])
    byDate.get(r.plan_date)!.push(r)
  }
  const ids: string[] = []
  for (const day of byDate.values()) {
    const wetMain = day.some(r => r.slot === 'utama' && r.dishes?.provides_soup === true)
    if (!wetMain) continue
    for (const r of day) {
      if (r.slot === 'kuah' && r.dish_id && !r.skipped && !r.locked && r.dishes?.slot === 'kuah') ids.push(r.id)
    }
  }
  return ids
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
  const providesSoup = main?.provides_soup ?? false

  // 2. SAYURAN — always. One more savory pick (the kuah slot) always follows, so plannedRemaining=1.
  if (!isLocked('sayuran')) {
    push(pickForSlot(dishesBySlot.sayuran ?? [], mkCtx('sayuran', 'support', 1), rng))
  }

  // 3. KUAH slot — a soup for a dry main; a SECOND sayuran for a provides_soup main.
  //    A wet main already brings the broth, so a separate soup would be a second soup;
  //    convert the freed slot to an extra vegetable instead (keeping 3 savory components).
  if (!isLocked('kuah')) {
    if (providesSoup) {
      push(secondVegForKuah(dishesBySlot.sayuran ?? [], mkCtx('sayuran', 'support', 0), date, rng))
    } else {
      push(pickForSlot(dishesBySlot.kuah ?? [], mkCtx('kuah', 'support', 0), rng))
    }
  }

  // 4. DESERT — optional
  if (!isLocked('desert')) {
    push(pickForSlot(dishesBySlot.desert ?? [], mkCtx('desert', 'optional', 0), rng))
  }

  return created
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

// Dev-only sanity check: scan a generated week and report any rule violations.
export function validateWeek(
  rows: { plan_date: string; dish_id: string | null; skipped?: boolean }[],
  dishById: Map<string, Dish>,
): string[] {
  const viol: string[] = []
  const byDate = new Map<string, Dish[]>()
  for (const r of rows) {
    if (!r.dish_id || r.skipped) continue
    const d = dishById.get(r.dish_id)
    if (!d) continue
    if (!byDate.has(r.plan_date)) byDate.set(r.plan_date, [])
    byDate.get(r.plan_date)!.push(d)
  }
  const dates = [...byDate.keys()].sort()
  for (const date of dates) {
    const ds = byDate.get(date)!
    const salty = ds.filter(d => d.saltiness !== 'normal')
    if (salty.length > 1) viol.push(`⚠️ ${date}: ${salty.length} salty dishes (${salty.map(d => d.name).join(', ')})`)
    const fried = ds.filter(d => d.method === 'fried')
    if (fried.length > 2) viol.push(`⚠️ ${date}: ${fried.length} fried dishes (${fried.map(d => d.name).join(', ')})`)
    const garnish = ds.filter(d => d.is_garnish)
    if (garnish.length) viol.push(`⚠️ ${date}: garnish dish planned (${garnish.map(d => d.name).join(', ')})`)
    const peleng = ds.filter(d => d.slot === 'pelengkap')
    if (peleng.length) viol.push(`⚠️ ${date}: pelengkap slot generated (${peleng.map(d => d.name).join(', ')})`)
    const wetMain = ds.some(d => d.slot === 'utama' && d.provides_soup)
    const soups = ds.filter(d => d.slot === 'kuah')
    if (wetMain && soups.length) viol.push(`⚠️ ${date}: provides-soup main + a separate soup (${soups.map(d => d.name).join(', ')})`)
    const byProtein = new Map<string, Dish[]>()
    for (const d of ds.filter(d => MEAT_PROTEINS.has(d.protein))) {
      if (!byProtein.has(d.protein)) byProtein.set(d.protein, [])
      byProtein.get(d.protein)!.push(d)
    }
    for (const [protein, dupes] of byProtein) {
      if (dupes.length > 1) viol.push(`⚠️ ${date}: ${dupes.length} ${protein} dishes (${dupes.map(d => d.name).join(', ')})`)
    }
  }
  const hardDates = dates.filter(date => byDate.get(date)!.some(d => d.difficulty === 'hard'))
  const specialDates = dates.filter(date => byDate.get(date)!.some(d => d.tier === 'special'))
  if (hardDates.length > 2) viol.push(`⚠️ week: ${hardDates.length} hard days (${hardDates.join(', ')})`)
  if (specialDates.length > 2) viol.push(`⚠️ week: ${specialDates.length} special days (${specialDates.join(', ')})`)
  const hasAdjacent = (arr: string[]) =>
    arr.some((a, i) => arr.some((b, j) => i < j && Math.abs(daysBetween(a, b)) === 1))
  if (hasAdjacent(hardDates)) viol.push(`⚠️ week: hard dishes on adjacent days (${hardDates.join(', ')})`)
  if (hasAdjacent(specialDates)) viol.push(`⚠️ week: special dishes on adjacent days (${specialDates.join(', ')})`)
  const spicyMainDates = dates.filter(date => byDate.get(date)!.some(d => d.slot === 'utama' && d.spicy))
  for (let i = 0; i < spicyMainDates.length; i++) {
    for (let j = i + 1; j < spicyMainDates.length; j++) {
      if (Math.abs(daysBetween(spicyMainDates[i], spicyMainDates[j])) === 1) {
        viol.push(`⚠️ ${spicyMainDates[i]}-${spicyMainDates[j]}: two spicy mains adjacent — pool constraint`)
      }
    }
  }
  return viol
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
