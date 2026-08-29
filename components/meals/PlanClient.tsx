'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Sparkles, Lock, Unlock, Shuffle, ShoppingCart, Check, Trash2 } from 'lucide-react'
import { SLOT_LABELS, type DailyStaple, type Dish, type MealPlan, type Role, type Slot, type Tier } from '@/lib/meals/types'
import { weekDates, currentMonday, shiftWeek, isoDate } from '@/lib/meals/dates'
import { formatQty, qtyDisplay } from '@/lib/meals/qty'
import DishImage from './DishImage'
import PhotoUploadButton from './PhotoUploadButton'
import RecipeLinkButton from './RecipeLinkButton'
import DishEditorPanel from './DishEditorPanel'
import CookLogSheet from './CookLogSheet'
import WeekOverview from './WeekOverview'
import StaplesBanner from './StaplesBanner'
import ViewToggle from './ViewToggle'
import { computeWeekOverview } from '@/lib/meals/overview'

export type CookRow = {
  cook_date: string; slot: Slot; role: Role
  planned_dish_id: string | null; planned_dish_name: string | null
  actual_dish_id: string | null; actual_dish_name: string | null
  cooked: boolean; note?: string | null; logged_by?: string | null
}

function label(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const TIER_STYLE: Record<Tier, string> = {
  everyday: 'bg-stone-100 text-stone-600', nice: 'bg-amber-100 text-amber-700', special: 'bg-orange-100 text-orange-700',
}


export default function PlanClient({ initialWeekStart, initialWeek, initialStaples }:
  { initialWeekStart: string; initialWeek: MealPlan[]; initialStaples: DailyStaple[] }) {
  const router = useRouter()
  const [weekStart, setWeekStart] = useState(initialWeekStart)
  const [week, setWeek] = useState<MealPlan[]>(initialWeek)
  const [generating, setGenerating] = useState(false)
  const [buildingList, setBuildingList] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [randomizingBreakfast, setRandomizingBreakfast] = useState(false)
  const [randomizingDesserts, setRandomizingDesserts] = useState(false)
  const [cookLog, setCookLog] = useState<Record<string, CookRow[]>>({})
  const [genReport, setGenReport] = useState<string[] | null>(null)
  const [editingDish, setEditingDish] = useState<Dish | null>(null)
  const days = useMemo(() => weekDates(weekStart), [weekStart])
  const overview = useMemo(() => computeWeekOverview(week), [week])

  function dayRows(date: string) { return week.filter(p => p.plan_date === date) }

  async function loadCookLog(ws: string) {
    const res = await fetch(`/api/meals/cook-log?weekStart=${ws}`)
    if (res.ok) {
      const { entries } = await res.json()
      const map: Record<string, CookRow[]> = {}
      for (const e of entries as CookRow[]) (map[e.cook_date] ||= []).push(e)
      setCookLog(map)
    }
  }
  function onCooked(date: string, entries: CookRow[]) {
    setCookLog(prev => ({ ...prev, [date]: entries }))
  }

  async function loadWeek(ws: string) {
    setWeekStart(ws)
    try { sessionStorage.setItem('meals-weekStart', ws) } catch {}
    const res = await fetch(`/api/meals/week?weekStart=${ws}`)
    const { week } = await res.json(); setWeek(week ?? [])
    loadCookLog(ws)
  }

  // Restore the last-viewed week when returning to /meals (e.g. after opening a
  // dish recipe), so pagination isn't reset to the current week on every remount.
  useEffect(() => {
    let saved: string | null = null
    try { saved = sessionStorage.getItem('meals-weekStart') } catch {}
    if (saved && /^\d{4}-\d{2}-\d{2}$/.test(saved) && saved !== initialWeekStart) loadWeek(saved)
    else loadCookLog(initialWeekStart)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  async function generate() {
    setGenerating(true)
    setGenReport(null)
    try {
      const res = await fetch('/api/meals/generate', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ weekStart }),
      })
      const { week, report } = await res.json(); setWeek(week ?? [])
      setGenReport(report ?? [])
      loadCookLog(weekStart)
    } finally { setGenerating(false) }
  }
  async function randomizeBreakfasts() {
    setRandomizingBreakfast(true)
    try {
      const res = await fetch('/api/meals/reroll', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope: 'week-breakfasts', weekStart }),
      })
      if (res.ok) { const { week } = await res.json(); setWeek(week ?? []) }
    } finally { setRandomizingBreakfast(false) }
  }
  async function randomizeDesserts() {
    setRandomizingDesserts(true)
    try {
      const res = await fetch('/api/meals/reroll', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope: 'week-desserts', weekStart }),
      })
      if (res.ok) { const { week } = await res.json(); setWeek(week ?? []) }
    } finally { setRandomizingDesserts(false) }
  }
  async function buildList() {
    setBuildingList(true)
    try {
      await fetch('/api/meals/shopping/generate', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ weekStart }),
      })
      router.push('/meals/shopping')
    } finally { setBuildingList(false) }
  }
  async function clearWeek() {
    if (!confirm(`Empty the whole week of ${label(days[0])} – ${label(days[6])}?\n\nThis deletes every meal (and cook log) for these 7 days so the week no longer counts toward next week's variety/spacing rules. It can't be undone.`)) return
    setClearing(true)
    try {
      const res = await fetch('/api/meals/clear-week', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ weekStart }),
      })
      if (res.ok) {
        setWeek([])
        setCookLog(c => { const next = { ...c }; for (const d of days) delete next[d]; return next })
      }
    } finally { setClearing(false) }
  }

  // replace all rows for a day (main re-compose)
  function replaceDay(date: string, rows: MealPlan[]) {
    setWeek(w => [...w.filter(p => p.plan_date !== date), ...rows])
  }
  // replace a single cell (support swap / lock toggle)
  function replaceCell(row: MealPlan) {
    setWeek(w => {
      const i = w.findIndex(p => p.id === row.id || (p.plan_date === row.plan_date && p.slot === row.slot))
      if (i === -1) return [...w, row]
      const copy = [...w]; copy[i] = row; return copy
    })
  }

  // Clicking a card opens the same edit drawer the Dishes tab uses, instead of
  // navigating to the recipe page — fetch the full Dish record to populate it.
  async function openDish(dishId: string) {
    const res = await fetch(`/api/meals/dishes/${dishId}`)
    if (res.ok) setEditingDish(await res.json())
  }
  // A dish can appear on several cells across the visible week (e.g. a repeated
  // staple, or the dessert batch) — sync every matching row's `dishes` snapshot,
  // local-state only (no PATCH; used for fields something else already persisted).
  function syncDishEverywhere(id: string, fields: Partial<Dish>) {
    setWeek(w => w.map(row => row.dish_id === id
      ? { ...row, dish_name: fields.name ?? row.dish_name, dishes: { ...(row.dishes as NonNullable<MealPlan['dishes']>), ...fields } }
      : row))
  }
  // Same, but also persists — for edits DishEditorPanel doesn't already save itself
  // (ingredients, steps, links, the manual image-URL field, provides_soup).
  async function patchDishEverywhere(id: string, fields: Partial<Dish>) {
    syncDishEverywhere(id, fields)
    await fetch(`/api/meals/dishes/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fields),
    })
  }

  return (
    <div>
      <div className="mb-4">
        <ViewToggle weekHref="/meals" dayHref={`/meals/day/${isoDate(new Date())}`} />
      </div>

      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => loadWeek(shiftWeek(weekStart, -7))} className="p-2 rounded-lg hover:bg-stone-100 text-stone-600" aria-label="Previous week"><ChevronLeft size={18} /></button>
          <span className="text-sm font-medium text-stone-700 min-w-[9rem] text-center">{label(days[0])} – {label(days[6])}</span>
          <button onClick={() => loadWeek(shiftWeek(weekStart, 7))} className="p-2 rounded-lg hover:bg-stone-100 text-stone-600" aria-label="Next week"><ChevronRight size={18} /></button>
          <button onClick={() => loadWeek(currentMonday())} className="ml-1 text-sm text-stone-500 hover:text-stone-800 px-2 py-1">This week</button>
        </div>
        <div className="flex items-center gap-2">
          {week.length > 0 && (
            <button onClick={clearWeek} disabled={clearing}
              className="flex items-center gap-1.5 text-stone-500 hover:text-stone-800 hover:bg-stone-100 disabled:opacity-60 text-sm font-medium px-3 py-2 rounded-xl transition-colors"
              title="Empty this week (removes it from next week's variety/spacing rules)">
              <Trash2 size={15} /> {clearing ? 'Clearing…' : 'Clear week'}
            </button>
          )}
          <button onClick={randomizeBreakfasts} disabled={randomizingBreakfast}
            className="flex items-center gap-1.5 border border-stone-200 text-stone-600 hover:bg-stone-50 disabled:opacity-60 text-sm font-medium px-3 py-2 rounded-xl transition-colors">
            🎲 {randomizingBreakfast ? 'Randomizing…' : 'Randomize breakfast'}
          </button>
          <button onClick={randomizeDesserts} disabled={randomizingDesserts}
            className="flex items-center gap-1.5 border border-stone-200 text-stone-600 hover:bg-stone-50 disabled:opacity-60 text-sm font-medium px-3 py-2 rounded-xl transition-colors">
            🎲 {randomizingDesserts ? 'Randomizing…' : 'Randomize desserts'}
          </button>
          <button onClick={buildList} disabled={buildingList}
            className="flex items-center gap-2 border border-orange-200 text-orange-700 hover:bg-orange-50 disabled:opacity-60 text-sm font-medium px-4 py-2 rounded-xl transition-colors">
            <ShoppingCart size={16} /> {buildingList ? 'Building…' : 'Build shopping list'}
          </button>
          <button onClick={generate} disabled={generating}
            className="flex items-center gap-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors">
            <Sparkles size={16} /> {generating ? 'Generating…' : 'Generate Week'}
          </button>
        </div>
      </div>

      <StaplesBanner initialStaples={initialStaples} />

      {genReport && (
        <div className={`mb-4 px-4 py-2.5 rounded-xl text-sm ${genReport.length === 0 ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-amber-50 text-amber-800 border border-amber-200'}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{genReport.length === 0 ? '✓ Week validated' : `${genReport.length} thing${genReport.length > 1 ? 's' : ''} to note`}</span>
            <button onClick={() => setGenReport(null)} className="text-xs opacity-60 hover:opacity-100">Dismiss</button>
          </div>
          {genReport.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs">
              {genReport.map((line, i) => <li key={i}>{line}</li>)}
            </ul>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {days.map((date, i) => (
          <DayPlate key={date} date={date} dayName={DAY_NAMES[i]} rows={dayRows(date)}
            entries={cookLog[date] ?? []} onCooked={onCooked}
            onReplaceDay={replaceDay} onReplaceCell={replaceCell} onOpenDish={openDish} />
        ))}
      </div>

      <WeekOverview overview={overview} />

      {editingDish && (
        <DishEditorPanel dish={editingDish} onClose={() => setEditingDish(null)}
          onPatch={patchDishEverywhere} onSynced={syncDishEverywhere} />
      )}
    </div>
  )
}

function DayPlate({ date, dayName, rows, entries, onCooked, onReplaceDay, onReplaceCell, onOpenDish }: {
  date: string; dayName: string; rows: MealPlan[]
  entries: CookRow[]; onCooked: (date: string, entries: CookRow[]) => void
  onReplaceDay: (date: string, rows: MealPlan[]) => void
  onReplaceCell: (row: MealPlan) => void
  onOpenDish: (dishId: string) => void
}) {
  const breakfast = rows.find(r => r.slot === 'breakfast')
  const main = rows.find(r => r.role === 'main')
  const supports = rows.filter(r => r.role === 'support' && r.dish_id)
  const soupSkipped = rows.some(r => r.slot === 'kuah' && r.skipped)
  const breakfastFruit = rows.find(r => r.slot === 'fruit' && r.role === 'breakfast')
  const dessert = rows.find(r => r.slot === 'desert')
  const dessertFruit = rows.find(r => r.slot === 'fruit' && r.role === 'optional')

  const [rerollingDay, setRerollingDay] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const dayLocked = rows.length > 0 && rows.every(r => r.locked)
  const cooked = entries.some(e => e.cooked)
  const hasPlan = rows.some(r => r.dish_id && !r.skipped)

  // Lightweight produce glance for the day — just a sum of what's on the
  // cards shown, no targets/tracking. See qtyDisplay for the per-dish version.
  const dayVeg = rows.reduce((n, r) => n + (r.dish_id && !r.skipped ? r.dishes?.veg_portions ?? 0 : 0), 0)
  const dayFruit = rows.reduce((n, r) => n + (r.dish_id && !r.skipped ? r.dishes?.fruit_portions ?? 0 : 0), 0)

  async function markCooked() {
    const res = await fetch('/api/meals/cook-log', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cook_date: date }),
    })
    if (res.ok) { const { entries } = await res.json(); onCooked(date, entries) }
  }

  async function toggleDayLock() {
    const next = !dayLocked
    onReplaceDay(date, rows.map(r => ({ ...r, locked: next })))  // optimistic
    const res = await fetch('/api/meals/day-lock', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan_date: date, locked: next }),
    })
    if (!res.ok) onReplaceDay(date, rows)  // revert
  }

  async function rerollMain(dishId?: string) {
    const res = await fetch('/api/meals/reroll', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan_date: date, slot: 'utama', ...(dishId ? { dish_id: dishId } : {}) }),
    })
    if (res.ok) { const { day } = await res.json(); onReplaceDay(date, day) }
  }
  async function rerollDay() {
    setRerollingDay(true)
    try {
      const res = await fetch('/api/meals/reroll', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan_date: date, scope: 'day' }),
      })
      if (res.ok) { const { day } = await res.json(); onReplaceDay(date, day) }
    } finally { setRerollingDay(false) }
  }

  return (
    <div className={`min-w-0 bg-white border rounded-2xl p-3 flex flex-col gap-3 ${dayLocked ? 'border-orange-300 ring-2 ring-orange-300 bg-orange-50/40' : 'border-stone-200'}`}>
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-stone-500 flex items-center gap-1.5">
          <span>{dayName} · <span className="text-stone-400">{label(date)}</span></span>
          {cooked && <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-green-700 bg-green-100 rounded px-1 py-0.5"><Check size={10} /> Cooked</span>}
          {dayLocked && <span className="text-[10px] font-medium text-orange-700 bg-orange-100 rounded px-1 py-0.5">🔒 Locked</span>}
        </div>
        <div className="flex items-center gap-0.5">
          {!dayLocked && (
            <button onClick={rerollDay} disabled={rerollingDay} title="Reshuffle this day"
              className="p-1 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 disabled:opacity-40">
              <Shuffle size={13} className={rerollingDay ? 'animate-spin' : ''} />
            </button>
          )}
          <button onClick={toggleDayLock} title={dayLocked ? 'Unlock this day' : 'Lock this day'}
            className={`p-1 rounded-lg hover:bg-stone-100 ${dayLocked ? 'text-orange-600' : 'text-stone-400 hover:text-stone-700'}`}>
            {dayLocked ? <Lock size={13} /> : <Unlock size={13} />}
          </button>
        </div>
      </div>
      {(breakfast || breakfastFruit) && (
        <div className="flex flex-wrap gap-2">
          {breakfast && <SmallDishCard row={breakfast} date={date} emoji="🌅" onReplaceCell={onReplaceCell} onOpenDish={onOpenDish} />}
          {breakfastFruit && <SmallDishCard row={breakfastFruit} date={date} onReplaceCell={onReplaceCell} onOpenDish={onOpenDish} />}
        </div>
      )}

      {main
        ? <MainHero row={main} date={date} onReroll={rerollMain} onReplaceCell={onReplaceCell} onOpenDish={onOpenDish} />
        : <div className="aspect-video rounded-xl bg-gradient-to-br from-stone-100 to-orange-50 flex items-center justify-center text-3xl text-stone-300">🍽️</div>}

      {(supports.length > 0 || soupSkipped) && (
        <div className="flex flex-wrap gap-2">
          {supports.map(s => <SupportChip key={s.id} row={s} date={date} onReplaceCell={onReplaceCell} onOpenDish={onOpenDish} />)}
          {soupSkipped && (
            <div className="basis-[calc(50%-0.25rem)] max-w-[calc(50%-0.25rem)] min-w-0 text-[11px] text-stone-400 bg-stone-50 border border-stone-200 rounded-xl px-2.5 py-2 flex items-center leading-tight">
              🥣 broth from the main — no extra soup
            </div>
          )}
        </div>
      )}

      {(dessert || dessertFruit) && (
        <div className="flex flex-wrap gap-2">
          {dessert && <SmallDishCard row={dessert} date={date} onReplaceCell={onReplaceCell} onOpenDish={onOpenDish} />}
          {dessertFruit && <SmallDishCard row={dessertFruit} date={date} onReplaceCell={onReplaceCell} onOpenDish={onOpenDish} />}
        </div>
      )}

      {(dayVeg > 0 || dayFruit > 0) && (
        <div className="text-[10px] text-stone-400 text-center -mt-1">
          Day total: {[dayVeg > 0 && `🥗 ${dayVeg} veg`, dayFruit > 0 && `🍎 ${dayFruit} fruit`].filter(Boolean).join(' · ')}
        </div>
      )}

      {hasPlan && (
        <div className="flex items-center gap-2 border-t border-stone-100 pt-2 mt-0.5">
          <button onClick={markCooked}
            className={`flex-1 flex items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-medium ${cooked ? 'bg-green-50 text-green-700' : 'bg-stone-100 text-stone-600 hover:bg-green-50 hover:text-green-700'}`}>
            <Check size={13} /> {cooked ? 'Cooked' : 'Mark cooked'}
          </button>
          <button onClick={() => setShowLog(true)} className="px-3 py-1.5 rounded-lg text-xs text-stone-500 hover:bg-stone-100">Edit</button>
        </div>
      )}
      {showLog && (
        <CookLogSheet date={date} rows={rows} entries={entries}
          onClose={() => setShowLog(false)} onSaved={(d, saved) => onCooked(d, saved as CookRow[])} />
      )}
    </div>
  )
}

function useCellControls(date: string, row: MealPlan, onReplaceCell: (r: MealPlan) => void) {
  const [open, setOpen] = useState(false)
  const [alts, setAlts] = useState<{ id: string; name: string }[] | null>(null)
  async function toggleLock() {
    const next = !row.locked
    onReplaceCell({ ...row, locked: next })
    const res = await fetch(`/api/meals/plan/${row.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ locked: next }),
    })
    if (!res.ok) onReplaceCell({ ...row, locked: !next })
  }
  async function openAlts() {
    setOpen(true)
    if (alts) return
    const res = await fetch(`/api/meals/reroll?plan_date=${date}&slot=${row.slot}&role=${row.role}&alternatives=5`)
    const { alternatives } = await res.json(); setAlts(alternatives ?? [])
  }
  return { open, setOpen, alts, toggleLock, openAlts }
}

function MainHero({ row, date, onReroll, onReplaceCell, onOpenDish }: {
  row: MealPlan; date: string
  onReroll: (dishId?: string) => void
  onReplaceCell: (r: MealPlan) => void
  onOpenDish: (dishId: string) => void
}) {
  const { open, setOpen, alts, openAlts, toggleLock } = useCellControls(date, row, onReplaceCell)
  const tier = row.dishes?.tier; const spicy = row.dishes?.spicy
  const qty = qtyDisplay(row.dishes)
  return (
    <div className={`relative rounded-xl overflow-hidden border ${tier === 'special' ? 'border-orange-300 ring-1 ring-orange-200' : 'border-stone-200'}`}>
      <button type="button" onClick={() => row.dish_id && onOpenDish(row.dish_id)}
        aria-label={`Edit ${row.dish_name}`} className="block w-full text-left">
        <DishImage imageUrl={row.dishes?.recipe_image_url ?? null} protein={row.dishes?.protein ?? 'none'} name={row.dish_name ?? undefined}
          className="w-full aspect-video" rounded="rounded-none" iconSize={34} showName={!row.dishes?.recipe_image_url} />
        <div className="p-2.5">
          <div className="text-stone-900 font-medium leading-snug" style={{ fontFamily: 'DM Serif Display, serif' }}>{row.dish_name ?? '—'}</div>
          {qty && <div className="text-xs text-stone-500 mt-0.5">{qty}</div>}
          <div className="flex items-center gap-1.5 mt-1">
            {tier && <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${TIER_STYLE[tier]}`}>{tier}</span>}
            {spicy && <span title="Spicy">🌶️</span>}
          </div>
        </div>
      </button>
      <div className="absolute top-1.5 right-1.5 flex gap-1 z-10">
        {row.dish_id && (
          <RecipeLinkButton dishId={row.dish_id} links={row.dishes?.recipe_links ?? []} iconSize={14}
            onSaved={next => onReplaceCell({ ...row, dishes: { ...(row.dishes as NonNullable<MealPlan['dishes']>), recipe_links: next } })} />
        )}
        <button onClick={toggleLock} title={row.locked ? 'Unlock' : 'Lock'}
          className={`p-1 rounded-lg bg-white/85 backdrop-blur ${row.locked ? 'text-orange-600' : 'text-stone-500 hover:text-stone-800'}`}>
          {row.locked ? <Lock size={14} /> : <Unlock size={14} />}
        </button>
        <button onClick={openAlts} title="Want something else?" className="p-1 rounded-lg bg-white/85 backdrop-blur text-stone-500 hover:text-stone-800"><Shuffle size={14} /></button>
      </div>
      {row.dish_id && (
        <div className="absolute top-1.5 left-1.5 z-10">
          <PhotoUploadButton dishId={row.dish_id} variant="overlay"
            label={row.dishes?.recipe_image_url ? 'Change photo' : '📷 add photo'}
            onUploaded={url => onReplaceCell({ ...row, dishes: { ...(row.dishes ?? { tier: 'everyday', spicy: false, richness: 'medium', provides_soup: false, protein: 'none', saltiness: 'normal', difficulty: 'medium', method: null }), recipe_image_url: url } })} />
        </div>
      )}
      {open && (
        <div className="absolute z-20 left-2 right-2 bottom-2 bg-white border border-stone-200 rounded-xl shadow-lg p-1">
          <button onClick={() => { setOpen(false); onReroll() }} className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-orange-50 text-orange-700 font-medium text-sm">🎲 Surprise me (new plate)</button>
          {alts?.map(a => (
            <button key={a.id} onClick={() => { setOpen(false); onReroll(a.id) }} className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-stone-50 text-stone-700 text-sm truncate">{a.name}</button>
          ))}
          <button onClick={() => setOpen(false)} className="w-full text-left px-2 py-1.5 rounded-lg text-stone-400 hover:bg-stone-50 text-sm">Cancel</button>
        </div>
      )}
    </div>
  )
}

function SupportChip({ row, date, onReplaceCell, onOpenDish }: {
  row: MealPlan; date: string; onReplaceCell: (r: MealPlan) => void; onOpenDish: (dishId: string) => void
}) {
  const { open, setOpen, alts, openAlts, toggleLock } = useCellControls(date, row, onReplaceCell)
  const spicy = row.dishes?.spicy
  const qty = qtyDisplay(row.dishes)
  async function swap(dishId?: string) {
    const res = await fetch('/api/meals/reroll', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan_date: date, slot: row.slot, ...(dishId ? { dish_id: dishId } : {}) }),
    })
    if (res.ok) { const { pick } = await res.json(); onReplaceCell(pick) }
    setOpen(false)
  }
  return (
    <div className="relative basis-[calc(50%-0.25rem)] max-w-[calc(50%-0.25rem)] min-w-0 bg-stone-50 border border-stone-200 rounded-xl">
      <button type="button" onClick={() => row.dish_id && onOpenDish(row.dish_id)}
        aria-label={`Edit ${row.dish_name}`} className="block w-full text-left">
        <DishImage imageUrl={row.dishes?.recipe_image_url ?? null} protein={row.dishes?.protein ?? 'none'} name={row.dish_name ?? undefined}
          className="w-full aspect-video" rounded="rounded-t-xl" iconSize={26} />
        <div className="px-2 pt-1 pb-1.5">
          <div className="text-[9px] uppercase tracking-wide text-stone-400">{SLOT_LABELS[row.dishes?.slot ?? row.slot]}</div>
          <div className="text-xs text-stone-700 leading-snug">{row.dish_name} {spicy && '🌶️'}</div>
          {qty && <div className="text-[10px] text-stone-400 mt-0.5">{qty}</div>}
        </div>
      </button>
      <div className="absolute top-1 right-1 flex gap-0.5 z-10">
        {row.dish_id && (
          <PhotoUploadButton dishId={row.dish_id} variant="icon"
            label={row.dishes?.recipe_image_url ? 'Change photo' : 'Add photo'}
            className="bg-white/85 backdrop-blur text-stone-400 hover:text-stone-700"
            onUploaded={url => onReplaceCell({ ...row, dishes: { ...(row.dishes ?? { tier: 'everyday', spicy: false, richness: 'medium', provides_soup: false, protein: 'none', saltiness: 'normal', difficulty: 'medium', method: null }), recipe_image_url: url } })} />
        )}
        {row.dish_id && (
          <RecipeLinkButton dishId={row.dish_id} links={row.dishes?.recipe_links ?? []}
            onSaved={next => onReplaceCell({ ...row, dishes: { ...(row.dishes as NonNullable<MealPlan['dishes']>), recipe_links: next } })} />
        )}
        <button onClick={toggleLock} className={`p-0.5 rounded bg-white/85 backdrop-blur ${row.locked ? 'text-orange-600' : 'text-stone-400 hover:text-stone-700'}`}>{row.locked ? <Lock size={11} /> : <Unlock size={11} />}</button>
        <button onClick={openAlts} className="p-0.5 rounded bg-white/85 backdrop-blur text-stone-400 hover:text-stone-700"><Shuffle size={11} /></button>
      </div>
      {open && (
        <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-white border border-stone-200 rounded-xl shadow-lg p-1">
          <button onClick={() => swap()} className="w-full text-left px-2 py-1 rounded-lg hover:bg-orange-50 text-orange-700 text-xs">🎲 Surprise me</button>
          {alts?.map(a => <button key={a.id} onClick={() => swap(a.id)} className="w-full text-left px-2 py-1 rounded-lg hover:bg-stone-50 text-stone-700 text-xs truncate">{a.name}</button>)}
          <button onClick={() => setOpen(false)} className="w-full text-left px-2 py-1 rounded-lg text-stone-400 text-xs">Cancel</button>
        </div>
      )}
    </div>
  )
}

// Vertical card — image on top, label below — matching SupportChip's shape.
// The breakfast pair and dessert pair both use this, sized for a phone row
// rather than the dinner hero's video-aspect thumbnail.
function SmallDishCard({ row, date, emoji, onReplaceCell, onOpenDish }: {
  row: MealPlan; date: string; emoji?: string; onReplaceCell: (r: MealPlan) => void; onOpenDish: (dishId: string) => void
}) {
  const { open, setOpen, alts, openAlts, toggleLock } = useCellControls(date, row, onReplaceCell)
  const qty = qtyDisplay(row.dishes)
  const isTreat = row.dishes?.tier === 'special'
  async function swap(dishId?: string) {
    const res = await fetch('/api/meals/reroll', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan_date: date, slot: row.slot, role: row.role, ...(dishId ? { dish_id: dishId } : {}) }),
    })
    if (res.ok) { const { pick } = await res.json(); onReplaceCell(pick) }
    setOpen(false)
  }
  return (
    <div className="relative basis-[calc(50%-0.25rem)] max-w-[calc(50%-0.25rem)] min-w-0 bg-stone-50 border border-stone-200 rounded-xl">
      <button type="button" onClick={() => row.dish_id && onOpenDish(row.dish_id)}
        aria-label={`Edit ${row.dish_name}`} className="block w-full text-left">
        <DishImage imageUrl={row.dishes?.recipe_image_url ?? null} protein={row.dishes?.protein ?? 'none'} name={row.dish_name ?? undefined}
          className="w-full aspect-video" rounded="rounded-t-xl" iconSize={26} />
        <div className="px-2 pt-1 pb-1.5">
          <div className="text-[9px] uppercase tracking-wide text-stone-400">{SLOT_LABELS[row.dishes?.slot ?? row.slot]}</div>
          <div className="text-xs text-stone-700 leading-snug truncate">{emoji && <span className="mr-1">{emoji}</span>}{row.dish_name ?? '—'}</div>
          <div className="flex items-center gap-1 mt-0.5">
            {isTreat && <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-orange-100 text-orange-700">eat-out</span>}
            {qty && <span className="text-[10px] text-stone-400 truncate">{qty}</span>}
          </div>
        </div>
      </button>
      <div className="absolute top-1 right-1 flex gap-0.5 z-10">
        {row.dish_id && (
          <PhotoUploadButton dishId={row.dish_id} variant="icon"
            label={row.dishes?.recipe_image_url ? 'Change photo' : 'Add photo'}
            className="bg-white/85 backdrop-blur text-stone-400 hover:text-stone-700"
            onUploaded={url => onReplaceCell({ ...row, dishes: { ...(row.dishes ?? { tier: 'everyday', spicy: false, richness: 'medium', provides_soup: false, protein: 'none', saltiness: 'normal', difficulty: 'medium', method: null }), recipe_image_url: url } })} />
        )}
        {row.dish_id && (
          <RecipeLinkButton dishId={row.dish_id} links={row.dishes?.recipe_links ?? []}
            onSaved={next => onReplaceCell({ ...row, dishes: { ...(row.dishes as NonNullable<MealPlan['dishes']>), recipe_links: next } })} />
        )}
        <button onClick={toggleLock} className={`p-0.5 rounded bg-white/85 backdrop-blur ${row.locked ? 'text-orange-600' : 'text-stone-400 hover:text-stone-700'}`}>{row.locked ? <Lock size={11} /> : <Unlock size={11} />}</button>
        <button onClick={openAlts} className="p-0.5 rounded bg-white/85 backdrop-blur text-stone-400 hover:text-stone-700"><Shuffle size={11} /></button>
      </div>
      {open && (
        <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-white border border-stone-200 rounded-xl shadow-lg p-1">
          <button onClick={() => swap()} className="w-full text-left px-2 py-1 rounded-lg hover:bg-orange-50 text-orange-700 text-xs">🎲 Surprise me</button>
          {alts?.map(a => <button key={a.id} onClick={() => swap(a.id)} className="w-full text-left px-2 py-1 rounded-lg hover:bg-stone-50 text-stone-700 text-xs truncate">{a.name}</button>)}
          <button onClick={() => setOpen(false)} className="w-full text-left px-2 py-1 rounded-lg text-stone-400 text-xs">Cancel</button>
        </div>
      )}
    </div>
  )
}
