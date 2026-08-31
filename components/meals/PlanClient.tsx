'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Lock, Unlock, Shuffle, Check, Trash2, Search } from 'lucide-react'
import { SLOT_LABELS, type DailyStaple, type Dish, type MealPlan, type Role, type Slot } from '@/lib/meals/types'
import { weekDates, currentMonday, shiftWeek, isoDate, mondayOf } from '@/lib/meals/dates'
import DishImage from './DishImage'
import PhotoUploadButton from './PhotoUploadButton'
import RecipeLinkButton from './RecipeLinkButton'
import DishEditorPanel from './DishEditorPanel'
import CookLogSheet from './CookLogSheet'
import WeekOverview from './WeekOverview'
import PlanSidebar from './PlanSidebar'
import PlanSearchBar from './PlanSearchBar'
import UndoSnackbar from '@/components/UndoSnackbar'
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

function isDishCooked(entries: CookRow[], row: MealPlan): boolean {
  return entries.some(e => e.slot === row.slot && e.role === row.role && e.cooked)
}
// Per-dish "mark cooked" — a lighter-weight sibling of the whole-day
// Mark-cooked button and CookLogSheet's per-day editor. Upserts (via the
// existing cook_log POST's `entries` array, onConflict cook_date/slot/role)
// just this one row's entry and toggles its `cooked` flag, leaving every
// other slot's entry for the day untouched.
async function toggleDishCooked(
  date: string, row: MealPlan, entries: CookRow[], onCooked: (date: string, entries: CookRow[]) => void,
) {
  if (!row.dish_id) return
  const prev = entries.find(e => e.slot === row.slot && e.role === row.role)
  const entry = {
    slot: row.slot, role: row.role,
    planned_dish_id: row.dish_id, planned_dish_name: row.dish_name,
    actual_dish_id: prev?.actual_dish_id ?? row.dish_id,
    actual_dish_name: prev?.actual_dish_name ?? row.dish_name,
    cooked: !(prev?.cooked ?? false),
  }
  const res = await fetch('/api/meals/cook-log', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cook_date: date, entries: [entry] }),
  })
  if (res.ok) {
    const { entries: saved } = await res.json()
    const merged = [...entries.filter(e => !(e.slot === row.slot && e.role === row.role)), ...(saved as CookRow[])]
    onCooked(date, merged)
  }
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
  const [undo, setUndo] = useState<{ message: string; row: MealPlan } | null>(null)
  const [highlightDate, setHighlightDate] = useState<string | null>(null)
  const days = useMemo(() => weekDates(weekStart), [weekStart])
  const overview = useMemo(() => computeWeekOverview(week), [week])
  // Fruit is bought once for the whole week (a banana or papaya covers all
  // 7 days), so it doesn't earn a picture card on every day — just a single
  // deduped, clickable list for the week. Breakfast and evening fruit rows
  // both count; a repeated fruit across days collapses to one chip.
  const weekFruit = useMemo(() => {
    const byId = new Map<string, string>()
    for (const r of week) if (r.slot === 'fruit' && r.dish_id && r.dish_name) byId.set(r.dish_id, r.dish_name)
    return [...byId.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [week])

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

  // Once the week containing a search-jumped date is actually loaded, scroll
  // to its day card and flash-highlight it for a couple seconds.
  useEffect(() => {
    if (!highlightDate || !days.includes(highlightDate)) return
    document.getElementById(`day-${highlightDate}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const t = setTimeout(() => setHighlightDate(null), 2500)
    return () => clearTimeout(t)
  }, [days, highlightDate])

  // Search-bar jump target: load the week containing the picked date (if it
  // isn't already the one on screen) and queue the highlight above.
  function jumpToDate(date: string) {
    setHighlightDate(date)
    const targetMonday = mondayOf(date)
    if (targetMonday !== weekStart) loadWeek(targetMonday)
  }
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
  // Undo for a cleared meal cell (MainHero/SupportChip/DessertRow's delete):
  // re-PATCHes the row's own previous dish_id/dish_name/locked back, rather
  // than delaying the original delete — simpler to wire through 3 card
  // components, and functionally the same "put it back" from the user's view.
  async function restoreCell(row: MealPlan) {
    replaceCell(row)
    await fetch(`/api/meals/plan/${row.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dish_id: row.dish_id, dish_name: row.dish_name, locked: row.locked }),
    })
  }
  function undoCellClear() {
    if (!undo) return
    restoreCell(undo.row)
    setUndo(null)
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
    <div className="flex flex-col sm:flex-row gap-4 items-start">
      <PlanSidebar
        dayHref={`/meals/day/${isoDate(new Date())}`}
        generating={generating} onGenerate={generate}
        hasWeek={week.length > 0} clearing={clearing} onClearWeek={clearWeek}
        randomizingBreakfast={randomizingBreakfast} onRandomizeBreakfasts={randomizeBreakfasts}
        randomizingDesserts={randomizingDesserts} onRandomizeDesserts={randomizeDesserts}
        buildingList={buildingList} onBuildList={buildList}
      />

      <div className="flex-1 min-w-0 w-full">
        <PlanSearchBar onJump={jumpToDate} />

        <div className="flex items-center gap-2 mb-5">
          <button onClick={() => loadWeek(shiftWeek(weekStart, -7))} className="p-2 rounded-lg hover:bg-stone-100 text-stone-600" aria-label="Previous week"><ChevronLeft size={18} /></button>
          <span className="text-sm font-medium text-stone-700 min-w-[9rem] text-center">{label(days[0])} – {label(days[6])}</span>
          <button onClick={() => loadWeek(shiftWeek(weekStart, 7))} className="p-2 rounded-lg hover:bg-stone-100 text-stone-600" aria-label="Next week"><ChevronRight size={18} /></button>
          <button onClick={() => loadWeek(currentMonday())} className="ml-1 text-sm text-stone-500 hover:text-stone-800 px-2 py-1">This week</button>
        </div>

        {weekFruit.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mb-4">
            <span className="text-xs font-medium text-stone-400 mr-0.5">🍎 This week&apos;s fruit:</span>
            {weekFruit.map(f => (
              <button key={f.id} onClick={() => openDish(f.id)}
                className="text-xs px-2.5 py-1 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-600 transition-colors">
                {f.name}
              </button>
            ))}
          </div>
        )}

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
              highlighted={date === highlightDate}
              entries={cookLog[date] ?? []} onCooked={onCooked}
              onReplaceDay={replaceDay} onReplaceCell={replaceCell} onOpenDish={openDish}
              onUndoable={row => setUndo({ message: `Removed ${row.dish_name ?? 'dish'}`, row })} />
          ))}
        </div>

        <WeekOverview overview={overview} />
      </div>

      {editingDish && (
        <DishEditorPanel dish={editingDish} onClose={() => setEditingDish(null)}
          onPatch={patchDishEverywhere} onSynced={syncDishEverywhere} />
      )}

      {undo && (
        <UndoSnackbar message={undo.message} onUndo={undoCellClear} onExpire={() => setUndo(null)} />
      )}
    </div>
  )
}

function DayPlate({ date, dayName, rows, highlighted, entries, onCooked, onReplaceDay, onReplaceCell, onOpenDish, onUndoable }: {
  date: string; dayName: string; rows: MealPlan[]; highlighted: boolean
  entries: CookRow[]; onCooked: (date: string, entries: CookRow[]) => void
  onReplaceDay: (date: string, rows: MealPlan[]) => void
  onReplaceCell: (row: MealPlan) => void
  onOpenDish: (dishId: string) => void
  onUndoable: (prevRow: MealPlan) => void
}) {
  const main = rows.find(r => r.role === 'main')
  // Cleared-but-not-skipped support rows (dish_id null, skipped false) are a
  // user delete waiting for a re-randomize — keep them so SupportChip can
  // render its empty-placeholder state. The system's own "skipped" rows
  // (e.g. kuah covered by the main's broth) stay excluded — that's a
  // designed state, not a deletable slot, and no longer gets its own caption.
  const supports = rows.filter(r => r.role === 'support' && !r.skipped)
  const dessert = rows.find(r => r.slot === 'desert')

  const [rerollingDay, setRerollingDay] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const dayLocked = rows.length > 0 && rows.every(r => r.locked)
  const cooked = entries.some(e => e.cooked)
  const hasPlan = rows.some(r => r.dish_id && !r.skipped)

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

  // Single-cell pick — must NOT touch the day's other slots (kuah/sayuran/
  // pelengkap stay exactly as they are). Whole-day reshuffle is rerollDay below.
  async function rerollMain(dishId?: string) {
    const res = await fetch('/api/meals/reroll', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan_date: date, slot: 'utama', ...(dishId ? { dish_id: dishId } : {}) }),
    })
    if (res.ok) { const { pick } = await res.json(); onReplaceCell(pick) }
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
    <div id={`day-${date}`}
      className={`min-w-0 bg-white border rounded-2xl p-3 flex flex-col gap-3 transition-shadow ${highlighted ? 'ring-4 ring-orange-400 ring-offset-2' : ''} ${dayLocked ? 'border-orange-300 ring-2 ring-orange-300 bg-orange-50/40' : 'border-stone-200'}`}>
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
      {main
        ? <MainHero row={main} date={date} entries={entries} onCooked={onCooked} onReroll={rerollMain} onReplaceCell={onReplaceCell} onOpenDish={onOpenDish} onUndoable={onUndoable} />
        : <div className="aspect-video rounded-xl bg-gradient-to-br from-stone-100 to-orange-50 flex items-center justify-center text-3xl text-stone-300">🍽️</div>}

      {supports.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {supports.map(s => <SupportChip key={s.id} row={s} date={date} entries={entries} onCooked={onCooked} onReplaceCell={onReplaceCell} onOpenDish={onOpenDish} onUndoable={onUndoable} />)}
        </div>
      )}

      {dessert && <DessertRow row={dessert} date={date} entries={entries} onCooked={onCooked} onReplaceCell={onReplaceCell} onOpenDish={onOpenDish} onUndoable={onUndoable} />}

      {hasPlan && (
        <div className="flex items-center gap-2 border-t border-stone-100 pt-2 mt-0.5">
          <button onClick={markCooked}
            className={`flex-1 flex items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-medium ${cooked ? 'bg-green-50 text-green-700' : 'bg-stone-100 text-stone-600 hover:bg-green-50 hover:text-green-700'}`}>
            <Check size={13} /> {cooked ? 'Cooked' : 'Mark cooked'}
          </button>
          <button onClick={() => setShowLog(true)} title="Log what you actually cooked — swap a dish or mark one as 'ate out' for the day"
            className="px-3 py-1.5 rounded-lg text-xs text-stone-500 hover:bg-stone-100">Log details</button>
        </div>
      )}
      {showLog && (
        <CookLogSheet date={date} rows={rows} entries={entries}
          onClose={() => setShowLog(false)} onSaved={(d, saved) => onCooked(d, saved as CookRow[])} />
      )}
    </div>
  )
}

function useCellControls(
  date: string, row: MealPlan, onReplaceCell: (r: MealPlan) => void, onUndoable?: (prevRow: MealPlan) => void,
) {
  const [open, setOpen] = useState(false)
  const [alts, setAlts] = useState<{ id: string; name: string }[] | null>(null)
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{ id: string; name: string; slot: string }[]>([])
  const [searching, setSearching] = useState(false)
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
  // Free-pick search: finds ANY active dish by name (scoped to `slots`),
  // independent of the algorithm-suggested `alts` above — this is what lets
  // the picker bypass composition rules ("manual override wins"). Reroll's
  // own POST handler already accepts an explicit dish_id and sets it
  // directly for every slot type, so no new write path is needed here.
  async function search(q: string, slots: string[]) {
    setQuery(q)
    if (!q.trim()) { setSearchResults([]); return }
    setSearching(true)
    try {
      const params = new URLSearchParams({ q: q.trim(), slots: slots.join(',') })
      const res = await fetch(`/api/meals/dishes/search?${params}`)
      const { dishes } = await res.json()
      setSearchResults(dishes ?? [])
    } finally { setSearching(false) }
  }
  function resetSearch() { setQuery(''); setSearchResults([]) }
  // "Delete" a planned dish without touching the rest of the day — clears
  // just this cell to an empty, re-rollable placeholder (dish_id/name null).
  // Distinct from the engine's own `skipped` rows (e.g. "broth from the
  // main"): this is a user choice, so it stays re-fillable via the same
  // reroll/"surprise me" flow the card already offers. Reports the
  // pre-clear row up to PlanClient so it can offer an Undo snackbar.
  async function clear() {
    const prev = row
    onReplaceCell({ ...row, dish_id: null, dish_name: null, dishes: null, locked: false })
    const res = await fetch(`/api/meals/plan/${row.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dish_id: null, dish_name: null, locked: false }),
    })
    if (!res.ok) onReplaceCell(prev)
    else onUndoable?.(prev)
  }
  return { open, setOpen, alts, toggleLock, openAlts, clear, query, searchResults, searching, search, resetSearch }
}

function MainHero({ row, date, entries, onCooked, onReroll, onReplaceCell, onOpenDish, onUndoable }: {
  row: MealPlan; date: string; entries: CookRow[]; onCooked: (date: string, entries: CookRow[]) => void
  onReroll: (dishId?: string) => void
  onReplaceCell: (r: MealPlan) => void
  onOpenDish: (dishId: string) => void
  onUndoable: (prevRow: MealPlan) => void
}) {
  const { open, setOpen, alts, openAlts, toggleLock, clear, query, searchResults, searching, search, resetSearch } =
    useCellControls(date, row, onReplaceCell, onUndoable)
  const tier = row.dishes?.tier; const spicy = row.dishes?.spicy
  const dishCooked = isDishCooked(entries, row)

  if (!row.dish_id) {
    return (
      <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50 aspect-video flex flex-col items-center justify-center gap-2">
        <span className="text-2xl text-stone-300">🍽️</span>
        <button onClick={() => onReroll()} className="flex items-center gap-1.5 text-sm font-medium text-orange-600 hover:text-orange-700">
          <Shuffle size={14} /> Add a main
        </button>
      </div>
    )
  }

  return (
    <div className={`relative rounded-xl overflow-hidden border ${tier === 'special' ? 'border-orange-300 ring-1 ring-orange-200' : 'border-stone-200'}`}>
      <button type="button" onClick={() => row.dish_id && onOpenDish(row.dish_id)}
        aria-label={`Edit ${row.dish_name}`} className="block w-full text-left">
        <DishImage imageUrl={row.dishes?.recipe_image_url ?? null} protein={row.dishes?.protein ?? 'none'} name={row.dish_name ?? undefined}
          className="w-full aspect-video" rounded="rounded-none" iconSize={34} showName={!row.dishes?.recipe_image_url} />
        <div className="p-2.5">
          <div className="text-stone-900 font-medium leading-snug" style={{ fontFamily: 'DM Serif Display, serif' }}>
            {row.dish_name ?? '—'} {spicy && <span title="Spicy">🌶️</span>}
          </div>
        </div>
      </button>
      {/* All action icons are reachable on mobile now (small icons), not just
          desktop — change/reroll/lock/mark-cooked stay usable on a phone. */}
      <div className="absolute top-1.5 right-1.5 flex gap-1 z-10">
        {row.dish_id && (
          <RecipeLinkButton dishId={row.dish_id} links={row.dishes?.recipe_links ?? []} iconSize={14}
            onSaved={next => onReplaceCell({ ...row, dishes: { ...(row.dishes as NonNullable<MealPlan['dishes']>), recipe_links: next } })} />
        )}
        <button onClick={() => toggleDishCooked(date, row, entries, onCooked)} title={dishCooked ? 'Cooked' : 'Mark this dish cooked'}
          className={`p-1 rounded-lg bg-white/85 backdrop-blur ${dishCooked ? 'text-green-600' : 'text-stone-500 hover:text-stone-800'}`}>
          <Check size={14} />
        </button>
        <button onClick={toggleLock} title={row.locked ? 'Unlock' : 'Lock'}
          className={`p-1 rounded-lg bg-white/85 backdrop-blur ${row.locked ? 'text-orange-600' : 'text-stone-500 hover:text-stone-800'}`}>
          {row.locked ? <Lock size={14} /> : <Unlock size={14} />}
        </button>
        {!row.locked && (
          <>
            <button onClick={openAlts} title="Want something else?" className="p-1 rounded-lg bg-white/85 backdrop-blur text-stone-500 hover:text-stone-800"><Shuffle size={14} /></button>
            <button onClick={clear} title="Remove" className="p-1 rounded-lg bg-white/85 backdrop-blur text-stone-500 hover:text-red-600"><Trash2 size={14} /></button>
          </>
        )}
      </div>
      {row.dish_id && (
        <div className="absolute top-1.5 left-1.5 z-10">
          <PhotoUploadButton dishId={row.dish_id} variant="icon"
            className="bg-white/85 backdrop-blur text-stone-500 hover:text-stone-800"
            label={row.dishes?.recipe_image_url ? 'Change photo' : 'Add photo'}
            onUploaded={url => onReplaceCell({ ...row, dishes: { ...(row.dishes ?? { tier: 'everyday', spicy: false, richness: 'medium', provides_soup: false, protein: 'none', saltiness: 'normal', difficulty: 'medium', method: null }), recipe_image_url: url } })} />
        </div>
      )}
      {open && (
        // Anchored to the TOP of the card (not below it) and height-bounded with its
        // own scroll — the alternatives list loads in async and can grow to 5+ rows,
        // and an unbounded panel growing downward would spill past the card and
        // overlap the support chips / dessert row / footer buttons underneath it.
        <div className="absolute z-20 left-2 right-2 top-2 max-h-[calc(100%-1rem)] overflow-y-auto bg-white border border-stone-200 rounded-xl shadow-lg p-1.5" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-1.5 px-1.5 py-1 mb-1 border border-stone-200 rounded-lg bg-white">
            <Search size={12} className="text-stone-400 shrink-0" />
            <input autoFocus value={query} onChange={e => search(e.target.value, ['utama'])}
              placeholder="Search any main dish…" className="flex-1 min-w-0 text-sm bg-transparent text-stone-900 placeholder:text-stone-400 focus:outline-none" />
          </div>
          {query.trim() ? (
            <>
              {searching && <div className="px-2 py-1.5 text-xs text-stone-400">Searching…</div>}
              {!searching && searchResults.length === 0 && <div className="px-2 py-1.5 text-xs text-stone-400">No matching dish</div>}
              {!searching && searchResults.map(d => (
                <button key={d.id} onClick={() => { setOpen(false); resetSearch(); onReroll(d.id) }}
                  className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-orange-50 text-stone-700 text-sm truncate">{d.name}</button>
              ))}
            </>
          ) : (
            <>
              <button onClick={() => { setOpen(false); onReroll() }} className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-orange-50 text-orange-700 font-medium text-sm">🎲 Surprise me (new plate)</button>
              {alts?.map(a => (
                <button key={a.id} onClick={() => { setOpen(false); onReroll(a.id) }} className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-stone-50 text-stone-700 text-sm truncate">{a.name}</button>
              ))}
            </>
          )}
          <button onClick={() => { setOpen(false); resetSearch() }} className="w-full text-left px-2 py-1.5 rounded-lg text-stone-400 hover:bg-stone-50 text-sm">Cancel</button>
        </div>
      )}
    </div>
  )
}

function SupportChip({ row, date, entries, onCooked, onReplaceCell, onOpenDish, onUndoable }: {
  row: MealPlan; date: string; entries: CookRow[]; onCooked: (date: string, entries: CookRow[]) => void
  onReplaceCell: (r: MealPlan) => void; onOpenDish: (dishId: string) => void
  onUndoable: (prevRow: MealPlan) => void
}) {
  const { open, setOpen, alts, openAlts, toggleLock, clear, query, searchResults, searching, search, resetSearch } =
    useCellControls(date, row, onReplaceCell, onUndoable)
  const spicy = row.dishes?.spicy
  const dishCooked = isDishCooked(entries, row)
  // Soup/veg/dish-helper slots are treated as one interchangeable pool by the
  // free-pick search below — she can drop any of them into any of the three.
  const SUPPORT_SLOTS = ['kuah', 'sayuran', 'pelengkap']
  async function swap(dishId?: string) {
    const res = await fetch('/api/meals/reroll', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan_date: date, slot: row.slot, ...(dishId ? { dish_id: dishId } : {}) }),
    })
    if (res.ok) { const { pick } = await res.json(); onReplaceCell(pick) }
    setOpen(false); resetSearch()
  }

  if (!row.dish_id) {
    return (
      <button onClick={() => swap()}
        className="basis-[calc(50%-0.25rem)] max-w-[calc(50%-0.25rem)] min-w-0 min-h-[88px] flex items-center justify-center gap-1 text-xs font-medium text-stone-400 hover:text-orange-600 border border-dashed border-stone-300 rounded-xl">
        <Shuffle size={12} /> Add
      </button>
    )
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
        <button onClick={() => toggleDishCooked(date, row, entries, onCooked)}
          className={`p-0.5 rounded bg-white/85 backdrop-blur ${dishCooked ? 'text-green-600' : 'text-stone-400 hover:text-stone-700'}`}><Check size={11} /></button>
        <button onClick={toggleLock} className={`p-0.5 rounded bg-white/85 backdrop-blur ${row.locked ? 'text-orange-600' : 'text-stone-400 hover:text-stone-700'}`}>{row.locked ? <Lock size={11} /> : <Unlock size={11} />}</button>
        {!row.locked && (
          <>
            <button onClick={openAlts} className="p-0.5 rounded bg-white/85 backdrop-blur text-stone-400 hover:text-stone-700"><Shuffle size={11} /></button>
            <button onClick={clear} className="p-0.5 rounded bg-white/85 backdrop-blur text-stone-400 hover:text-red-600"><Trash2 size={11} /></button>
          </>
        )}
      </div>
      {open && (
        <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-white border border-stone-200 rounded-xl shadow-lg p-1" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-1 px-1.5 py-1 mb-1 border border-stone-200 rounded-lg">
            <Search size={11} className="text-stone-400 shrink-0" />
            <input autoFocus value={query} onChange={e => search(e.target.value, SUPPORT_SLOTS)}
              placeholder="Search soup/veg/helper…" className="flex-1 min-w-0 text-xs bg-transparent text-stone-900 placeholder:text-stone-400 focus:outline-none" />
          </div>
          {query.trim() ? (
            <>
              {searching && <div className="px-2 py-1 text-xs text-stone-400">Searching…</div>}
              {!searching && searchResults.length === 0 && <div className="px-2 py-1 text-xs text-stone-400">No match</div>}
              {!searching && searchResults.map(d => (
                <button key={d.id} onClick={() => swap(d.id)} className="w-full text-left px-2 py-1 rounded-lg hover:bg-orange-50 text-stone-700 text-xs truncate">{d.name}</button>
              ))}
            </>
          ) : (
            <>
              <button onClick={() => swap()} className="w-full text-left px-2 py-1 rounded-lg hover:bg-orange-50 text-orange-700 text-xs">🎲 Surprise me</button>
              {alts?.map(a => <button key={a.id} onClick={() => swap(a.id)} className="w-full text-left px-2 py-1 rounded-lg hover:bg-stone-50 text-stone-700 text-xs truncate">{a.name}</button>)}
            </>
          )}
          <button onClick={() => { setOpen(false); resetSearch() }} className="w-full text-left px-2 py-1 rounded-lg text-stone-400 text-xs">Cancel</button>
        </div>
      )}
    </div>
  )
}

// Minimal text-only row for the day's dessert slot — no thumbnail, just a
// clickable name (opens the dish editor), a reroll die, and a delete. Kept
// deliberately lighter than the meal cards above: unlike the main/veg/helper
// trio, dessert doesn't need a picture to be useful at a glance.
function DessertRow({ row, date, entries, onCooked, onReplaceCell, onOpenDish, onUndoable }: {
  row: MealPlan; date: string; entries: CookRow[]; onCooked: (date: string, entries: CookRow[]) => void
  onReplaceCell: (r: MealPlan) => void; onOpenDish: (dishId: string) => void
  onUndoable: (prevRow: MealPlan) => void
}) {
  const { open, setOpen, alts, openAlts, clear } = useCellControls(date, row, onReplaceCell, onUndoable)
  const spicy = row.dishes?.spicy
  const dishCooked = isDishCooked(entries, row)
  async function swap(dishId?: string) {
    const res = await fetch('/api/meals/reroll', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan_date: date, slot: row.slot, role: row.role, ...(dishId ? { dish_id: dishId } : {}) }),
    })
    if (res.ok) { const { pick } = await res.json(); onReplaceCell(pick) }
    setOpen(false)
  }

  if (!row.dish_id) {
    return (
      <button onClick={() => swap()}
        className="w-full flex items-center justify-center gap-1.5 text-xs font-medium text-stone-400 hover:text-orange-600 border border-dashed border-stone-300 rounded-xl px-3 py-2">
        <Shuffle size={12} /> Add dessert
      </button>
    )
  }

  return (
    <div className="relative flex items-center gap-1 bg-stone-50 border border-stone-200 rounded-xl px-3 py-2">
      <button type="button" onClick={() => row.dish_id && onOpenDish(row.dish_id)}
        aria-label={`Edit ${row.dish_name}`} className="flex-1 min-w-0 text-left text-xs text-stone-700 truncate">
        🍡 {row.dish_name} {spicy && '🌶️'}
      </button>
      <button onClick={() => toggleDishCooked(date, row, entries, onCooked)} title={dishCooked ? 'Cooked' : 'Mark this dish cooked'}
        className={`p-1 rounded ${dishCooked ? 'text-green-600' : 'text-stone-400 hover:text-stone-700'}`}><Check size={12} /></button>
      <button onClick={openAlts} title="Want something else?" className="p-1 rounded text-stone-400 hover:text-stone-700"><Shuffle size={12} /></button>
      <button onClick={clear} title="Remove" className="p-1 rounded text-stone-400 hover:text-red-600"><Trash2 size={12} /></button>
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
