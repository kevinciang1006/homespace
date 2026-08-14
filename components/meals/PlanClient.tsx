'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Sparkles, Lock, Unlock, Shuffle, ShoppingCart } from 'lucide-react'
import { SLOT_LABELS, type MealPlan, type Tier } from '@/lib/meals/types'
import { weekDates, currentMonday, shiftWeek } from '@/lib/meals/dates'
import DishImage from './DishImage'
import PhotoUploadButton from './PhotoUploadButton'

function label(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const TIER_STYLE: Record<Tier, string> = {
  everyday: 'bg-stone-100 text-stone-600', nice: 'bg-amber-100 text-amber-700', special: 'bg-orange-100 text-orange-700',
}

export default function PlanClient({ initialWeekStart, initialWeek }:
  { initialWeekStart: string; initialWeek: MealPlan[] }) {
  const router = useRouter()
  const [weekStart, setWeekStart] = useState(initialWeekStart)
  const [week, setWeek] = useState<MealPlan[]>(initialWeek)
  const [generating, setGenerating] = useState(false)
  const [buildingList, setBuildingList] = useState(false)
  const days = useMemo(() => weekDates(weekStart), [weekStart])

  function dayRows(date: string) { return week.filter(p => p.plan_date === date) }

  async function loadWeek(ws: string) {
    setWeekStart(ws)
    const res = await fetch(`/api/meals/week?weekStart=${ws}`)
    const { week } = await res.json(); setWeek(week ?? [])
  }
  async function generate() {
    setGenerating(true)
    try {
      const res = await fetch('/api/meals/generate', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ weekStart }),
      })
      const { week } = await res.json(); setWeek(week ?? [])
    } finally { setGenerating(false) }
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

  return (
    <div>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => loadWeek(shiftWeek(weekStart, -7))} className="p-2 rounded-lg hover:bg-stone-100 text-stone-600" aria-label="Previous week"><ChevronLeft size={18} /></button>
          <span className="text-sm font-medium text-stone-700 min-w-[9rem] text-center">{label(days[0])} – {label(days[6])}</span>
          <button onClick={() => loadWeek(shiftWeek(weekStart, 7))} className="p-2 rounded-lg hover:bg-stone-100 text-stone-600" aria-label="Next week"><ChevronRight size={18} /></button>
          <button onClick={() => loadWeek(currentMonday())} className="ml-1 text-sm text-stone-500 hover:text-stone-800 px-2 py-1">This week</button>
        </div>
        <div className="flex items-center gap-2">
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {days.map((date, i) => (
          <DayPlate key={date} date={date} dayName={DAY_NAMES[i]} rows={dayRows(date)}
            onReplaceDay={replaceDay} onReplaceCell={replaceCell} />
        ))}
      </div>
    </div>
  )
}

function DayPlate({ date, dayName, rows, onReplaceDay, onReplaceCell }: {
  date: string; dayName: string; rows: MealPlan[]
  onReplaceDay: (date: string, rows: MealPlan[]) => void
  onReplaceCell: (row: MealPlan) => void
}) {
  const main = rows.find(r => r.role === 'main')
  const supports = rows.filter(r => r.role === 'support' && r.dish_id)
  const soupSkipped = rows.some(r => r.slot === 'kuah' && r.skipped)
  const desert = rows.find(r => r.role === 'optional')

  async function rerollMain(dishId?: string) {
    const res = await fetch('/api/meals/reroll', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan_date: date, slot: 'utama', ...(dishId ? { dish_id: dishId } : {}) }),
    })
    if (res.ok) { const { day } = await res.json(); onReplaceDay(date, day) }
  }

  return (
    <div className="bg-white border border-stone-200 rounded-2xl p-3 flex flex-col gap-3">
      <div className="text-xs font-semibold text-stone-500">{dayName} · <span className="text-stone-400">{label(date)}</span></div>
      {main
        ? <MainHero row={main} date={date} onReroll={rerollMain} onReplaceCell={onReplaceCell} />
        : <div className="aspect-video rounded-xl bg-gradient-to-br from-stone-100 to-orange-50 flex items-center justify-center text-3xl text-stone-300">🍽️</div>}

      {(supports.length > 0 || soupSkipped) && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {supports.map(s => <SupportChip key={s.id} row={s} date={date} onReplaceCell={onReplaceCell} />)}
          {soupSkipped && (
            <div className="shrink-0 w-32 text-[11px] text-stone-400 bg-stone-50 border border-stone-200 rounded-xl px-2.5 py-2 flex items-center leading-tight">
              🥣 broth from the main — no extra soup
            </div>
          )}
        </div>
      )}

      {desert && <DesertRow row={desert} date={date} onReplaceCell={onReplaceCell} />}
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
    const res = await fetch(`/api/meals/reroll?plan_date=${date}&slot=${row.slot}&alternatives=5`)
    const { alternatives } = await res.json(); setAlts(alternatives ?? [])
  }
  return { open, setOpen, alts, toggleLock, openAlts }
}

function MainHero({ row, date, onReroll, onReplaceCell }: {
  row: MealPlan; date: string
  onReroll: (dishId?: string) => void
  onReplaceCell: (r: MealPlan) => void
}) {
  const { open, setOpen, alts, openAlts, toggleLock } = useCellControls(date, row, onReplaceCell)
  const tier = row.dishes?.tier; const spicy = row.dishes?.spicy
  return (
    <div className={`relative rounded-xl overflow-hidden border ${tier === 'special' ? 'border-orange-300 ring-1 ring-orange-200' : 'border-stone-200'}`}>
      <Link href={row.dish_id ? `/meals/dish/${row.dish_id}` : '#'} aria-label={`View recipe for ${row.dish_name}`} className="block">
        <DishImage imageUrl={row.dishes?.recipe_image_url ?? null} protein={row.dishes?.protein ?? 'none'} name={row.dish_name ?? undefined}
          className="w-full aspect-video" rounded="rounded-none" iconSize={34} showName={!row.dishes?.recipe_image_url} />
        <div className="p-2.5">
          <div className="text-stone-900 font-medium leading-snug" style={{ fontFamily: 'DM Serif Display, serif' }}>{row.dish_name ?? '—'}</div>
          <div className="flex items-center gap-1.5 mt-1">
            {tier && <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${TIER_STYLE[tier]}`}>{tier}</span>}
            {spicy && <span title="Spicy">🌶️</span>}
          </div>
        </div>
      </Link>
      <div className="absolute top-1.5 right-1.5 flex gap-1 z-10">
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
            onUploaded={url => onReplaceCell({ ...row, dishes: { ...(row.dishes ?? { tier: 'everyday', spicy: false, richness: 'medium', provides_soup: false, protein: 'none' }), recipe_image_url: url } })} />
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

function SupportChip({ row, date, onReplaceCell }: { row: MealPlan; date: string; onReplaceCell: (r: MealPlan) => void }) {
  const { open, setOpen, alts, openAlts, toggleLock } = useCellControls(date, row, onReplaceCell)
  const spicy = row.dishes?.spicy
  async function swap(dishId?: string) {
    const res = await fetch('/api/meals/reroll', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan_date: date, slot: row.slot, ...(dishId ? { dish_id: dishId } : {}) }),
    })
    if (res.ok) { const { pick } = await res.json(); onReplaceCell(pick) }
    setOpen(false)
  }
  return (
    <div className="relative shrink-0 w-32 bg-stone-50 border border-stone-200 rounded-xl overflow-hidden">
      <Link href={row.dish_id ? `/meals/dish/${row.dish_id}` : '#'} aria-label={`View recipe for ${row.dish_name}`} className="block">
        <DishImage imageUrl={row.dishes?.recipe_image_url ?? null} protein={row.dishes?.protein ?? 'none'} name={row.dish_name ?? undefined}
          className="w-full h-14" rounded="rounded-none" iconSize={18} />
        <div className="px-2 pt-1 pb-1.5">
          <div className="text-[9px] uppercase tracking-wide text-stone-400">{SLOT_LABELS[row.slot]}</div>
          <div className="text-xs text-stone-700 leading-snug">{row.dish_name} {spicy && '🌶️'}</div>
        </div>
      </Link>
      <div className="absolute top-1 right-1 flex gap-0.5 z-10">
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

function DesertRow({ row, date, onReplaceCell }: { row: MealPlan; date: string; onReplaceCell: (r: MealPlan) => void }) {
  const { open, setOpen, alts, openAlts, toggleLock } = useCellControls(date, row, onReplaceCell)
  async function swap(dishId?: string) {
    const res = await fetch('/api/meals/reroll', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan_date: date, slot: 'desert', ...(dishId ? { dish_id: dishId } : {}) }),
    })
    if (res.ok) { const { pick } = await res.json(); onReplaceCell(pick) }
    setOpen(false)
  }
  return (
    <div className="relative flex items-center justify-between text-xs text-stone-400 border-t border-stone-100 pt-2">
      <Link href={row.dish_id ? `/meals/dish/${row.dish_id}` : '#'} className="truncate hover:text-stone-600">· desert: <span className="text-stone-500">{row.dish_name}</span></Link>
      <div className="flex gap-0.5 shrink-0">
        <button onClick={toggleLock} className={`p-0.5 ${row.locked ? 'text-orange-600' : 'text-stone-300 hover:text-stone-600'}`}>{row.locked ? <Lock size={11} /> : <Unlock size={11} />}</button>
        <button onClick={openAlts} className="p-0.5 text-stone-300 hover:text-stone-600"><Shuffle size={11} /></button>
      </div>
      {open && (
        <div className="absolute z-20 right-0 top-full mt-1 w-40 bg-white border border-stone-200 rounded-xl shadow-lg p-1">
          <button onClick={() => swap()} className="w-full text-left px-2 py-1 rounded-lg hover:bg-orange-50 text-orange-700 text-xs">🎲 Surprise me</button>
          {alts?.map(a => <button key={a.id} onClick={() => swap(a.id)} className="w-full text-left px-2 py-1 rounded-lg hover:bg-stone-50 text-stone-700 text-xs truncate">{a.name}</button>)}
          <button onClick={() => setOpen(false)} className="w-full text-left px-2 py-1 rounded-lg text-stone-400 text-xs">Cancel</button>
        </div>
      )}
    </div>
  )
}
