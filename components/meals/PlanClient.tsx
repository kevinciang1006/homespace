'use client'
import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Sparkles, Lock, Unlock, Shuffle } from 'lucide-react'
import { SLOTS, SLOT_LABELS, type MealPlan, type Slot, type Tier } from '@/lib/meals/types'
import { weekDates } from '@/lib/meals/dates'

function shiftWeek(weekStart: string, deltaDays: number): string {
  const [y, m, d] = weekStart.split('-').map(Number)
  const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() + deltaDays)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
function currentMonday(): string {
  const now = new Date(); const dow = (now.getDay() + 6) % 7
  now.setDate(now.getDate() - dow)
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
function label(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function upsertCell(week: MealPlan[], p: MealPlan): MealPlan[] {
  const idx = week.findIndex(w => w.plan_date === p.plan_date && w.slot === p.slot)
  if (idx === -1) return [...week, p]
  const copy = [...week]; copy[idx] = p; return copy
}

export default function PlanClient({ initialWeekStart, initialWeek }:
  { initialWeekStart: string; initialWeek: MealPlan[] }) {
  const [weekStart, setWeekStart] = useState(initialWeekStart)
  const [week, setWeek] = useState<MealPlan[]>(initialWeek)
  const [generating, setGenerating] = useState(false)
  const days = useMemo(() => weekDates(weekStart), [weekStart])

  function cell(date: string, slot: Slot): MealPlan | undefined {
    return week.find(p => p.plan_date === date && p.slot === slot)
  }

  async function loadWeek(ws: string) {
    setWeekStart(ws)
    const res = await fetch(`/api/meals/week?weekStart=${ws}`)
    const { week } = await res.json()
    setWeek(week ?? [])
  }
  async function generate() {
    setGenerating(true)
    try {
      const res = await fetch('/api/meals/generate', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ weekStart }),
      })
      const { week } = await res.json()
      setWeek(week ?? [])
    } finally { setGenerating(false) }
  }

  const onChange = (p: MealPlan) => setWeek(w => upsertCell(w, p))

  return (
    <div>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => loadWeek(shiftWeek(weekStart, -7))}
            className="p-2 rounded-lg hover:bg-stone-100 text-stone-600" aria-label="Previous week"><ChevronLeft size={18} /></button>
          <span className="text-sm font-medium text-stone-700 min-w-[9rem] text-center">
            {label(days[0])} – {label(days[6])}
          </span>
          <button onClick={() => loadWeek(shiftWeek(weekStart, 7))}
            className="p-2 rounded-lg hover:bg-stone-100 text-stone-600" aria-label="Next week"><ChevronRight size={18} /></button>
          <button onClick={() => loadWeek(currentMonday())}
            className="ml-1 text-sm text-stone-500 hover:text-stone-800 px-2 py-1">This week</button>
        </div>
        <button onClick={generate} disabled={generating}
          className="flex items-center gap-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors">
          <Sparkles size={16} /> {generating ? 'Generating…' : 'Generate Week'}
        </button>
      </div>

      {/* Desktop grid */}
      <div className="hidden sm:grid grid-cols-7 gap-2">
        {days.map((date, i) => (
          <div key={date} className="flex flex-col gap-2">
            <div className="text-center">
              <div className="text-xs font-semibold text-stone-700">{DAY_NAMES[i]}</div>
              <div className="text-xs text-stone-400">{label(date)}</div>
            </div>
            {SLOTS.map(slot => (
              <CellView key={slot} date={date} slot={slot} plan={cell(date, slot)} onChange={onChange} />
            ))}
          </div>
        ))}
      </div>

      {/* Mobile stacked day cards */}
      <div className="sm:hidden flex flex-col gap-4">
        {days.map((date, i) => (
          <div key={date} className="bg-white border border-stone-200 rounded-2xl p-4">
            <div className="font-medium text-stone-800 mb-3">{DAY_NAMES[i]} · <span className="text-stone-400">{label(date)}</span></div>
            <div className="flex flex-col gap-2">
              {SLOTS.map(slot => (
                <CellView key={slot} date={date} slot={slot} plan={cell(date, slot)} onChange={onChange} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const TIER_STYLE: Record<Tier, string> = {
  everyday: 'bg-stone-100 text-stone-500',
  nice: 'bg-amber-100 text-amber-700',
  special: 'bg-orange-100 text-orange-700',
}

function CellView({ date, slot, plan, onChange }:
  { date: string; slot: Slot; plan?: MealPlan; onChange: (p: MealPlan) => void }) {
  const [open, setOpen] = useState(false)
  const [alts, setAlts] = useState<{ id: string; name: string }[] | null>(null)
  const [busy, setBusy] = useState(false)
  const tier = plan?.dishes?.tier
  const spicy = plan?.dishes?.spicy
  const isSpecial = tier === 'special'

  async function toggleLock() {
    if (!plan) return
    const next = !plan.locked
    onChange({ ...plan, locked: next }) // optimistic
    const res = await fetch(`/api/meals/plan/${plan.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locked: next }),
    })
    if (!res.ok) onChange({ ...plan, locked: !next }) // rollback
  }

  async function openAlternatives() {
    setOpen(true)
    if (alts) return
    const res = await fetch(`/api/meals/reroll?plan_date=${date}&slot=${slot}&alternatives=5`)
    const { alternatives } = await res.json()
    setAlts(alternatives ?? [])
  }

  async function chooseReroll(body: object) {
    setBusy(true)
    try {
      const res = await fetch('/api/meals/reroll', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) { const { pick } = await res.json(); onChange(pick) }
    } finally { setBusy(false); setOpen(false); setAlts(null) }
  }

  return (
    <div className={`group/cell relative bg-white border rounded-xl px-2.5 py-2 text-xs min-h-[3.5rem] transition-colors ${
      isSpecial ? 'border-orange-300 ring-1 ring-orange-200' : 'border-stone-200'}`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-stone-400">{SLOT_LABELS[slot]}</span>
        {plan && (
          <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover/cell:opacity-100 focus-within:opacity-100 transition-opacity">
            <button onClick={toggleLock} title={plan.locked ? 'Unlock' : 'Lock'}
              className={`p-0.5 rounded ${plan.locked ? 'text-orange-600' : 'text-stone-300 hover:text-stone-600'}`}>
              {plan.locked ? <Lock size={13} /> : <Unlock size={13} />}
            </button>
            <button onClick={openAlternatives} title="Want something else?"
              className="p-0.5 rounded text-stone-300 hover:text-stone-600"><Shuffle size={13} /></button>
          </div>
        )}
      </div>
      <div className="text-stone-800 mt-0.5 leading-snug">{plan?.dish_name ?? '—'}</div>
      <div className="flex items-center gap-1 mt-1">
        {tier && <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${TIER_STYLE[tier]}`}>{tier}</span>}
        {spicy && <span title="Spicy">🌶️</span>}
      </div>

      {open && (
        <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-white border border-stone-200 rounded-xl shadow-lg p-1">
          <button disabled={busy} onClick={() => chooseReroll({ plan_date: date, slot })}
            className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-orange-50 text-orange-700 font-medium">
            🎲 Surprise me
          </button>
          {alts?.map(a => (
            <button key={a.id} disabled={busy}
              onClick={() => chooseReroll({ plan_date: date, slot, dish_id: a.id })}
              className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-stone-50 text-stone-700 truncate">
              {a.name}
            </button>
          ))}
          {alts && alts.length === 0 && <div className="px-2 py-1.5 text-stone-400">No alternatives</div>}
          <button onClick={() => { setOpen(false); setAlts(null) }}
            className="w-full text-left px-2 py-1.5 rounded-lg text-stone-400 hover:bg-stone-50">Cancel</button>
        </div>
      )}
    </div>
  )
}
