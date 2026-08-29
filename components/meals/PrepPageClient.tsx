'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { currentMonday, shiftWeek } from '@/lib/meals/dates'
import type { PrepTask } from '@/lib/meals/types'

function label(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// Small per-dish icon so a card reads at a glance in a long list — not
// meant to be exhaustive, just the common families (see shoppingGroups.ts
// for the same "keyword on the name" pattern used for the shopping list).
function dishEmoji(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('ayam')) return '🍗'
  if (n.includes('babi') || n.includes('iga')) return '🥩'
  if (n.includes('cumi')) return '🦑'
  if (n.includes('udang')) return '🦐'
  if (n.includes('ikan')) return '🐟'
  if (n.includes('kacang')) return '🫘'
  if (n.includes('pepaya') || n.includes('pisang') || n.includes('jeruk') || n.includes('apple') || n.includes('pear')) return '🍌'
  if (n.includes('yogurt')) return '🥣'
  return '🍽️'
}

type Who = 'Wife' | 'Kevin'
type DishBlock = { key: string; dish_id: string | null; dish_name: string; cook_date: string; tasks: PrepTask[] }

export default function PrepPageClient({ initialWeekStart, initialTasks, initialWho }: {
  initialWeekStart: string
  initialTasks: PrepTask[]
  initialWho: Who | null
}) {
  const router = useRouter()
  const [weekStart, setWeekStart] = useState(initialWeekStart)
  const [tasks, setTasks] = useState<PrepTask[]>(initialTasks)
  const [who, setWho] = useState<Who | 'all'>(initialWho ?? 'all')
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)

  async function loadWeek(ws: string) {
    setWeekStart(ws)
    router.replace(`/meals/prep?week=${ws}`, { scroll: false })
    setLoading(true)
    try {
      const res = await fetch(`/api/meals/prep-tasks?week=${ws}`)
      if (res.ok) { const { tasks } = await res.json(); setTasks(tasks ?? []) }
    } finally { setLoading(false) }
  }

  async function generate() {
    setGenerating(true)
    try {
      const res = await fetch('/api/meals/prep/generate', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ weekStart }),
      })
      if (res.ok) await loadWeek(weekStart)
    } finally { setGenerating(false) }
  }

  function toggle(id: string, done: boolean) {
    setTasks(ts => ts.map(t => t.id === id ? { ...t, done } : t)) // optimistic
    fetch(`/api/meals/prep-tasks/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ done }),
    }).then(res => { if (!res.ok) setTasks(ts => ts.map(t => t.id === id ? { ...t, done: !done } : t)) })
  }

  const visible = useMemo(() => tasks.filter(t => who === 'all' || t.assigned_to === who), [tasks, who])
  const blocks = useMemo(() => {
    const byKey = new Map<string, DishBlock>()
    for (const t of visible) {
      const key = t.dish_id ?? t.dish_name ?? t.id
      let block = byKey.get(key)
      if (!block) {
        block = { key, dish_id: t.dish_id, dish_name: t.dish_name ?? 'Prep', cook_date: t.cook_date, tasks: [] }
        byKey.set(key, block)
      }
      block.tasks.push(t)
    }
    return [...byKey.values()].sort((a, b) => a.cook_date.localeCompare(b.cook_date) || a.dish_name.localeCompare(b.dish_name))
  }, [visible])

  const doneCount = visible.filter(t => t.done).length

  return (
    <div>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => loadWeek(shiftWeek(weekStart, -7))} className="p-2 rounded-lg hover:bg-stone-100 text-stone-600" aria-label="Previous week"><ChevronLeft size={18} /></button>
          <span className="text-sm font-medium text-stone-700 min-w-[9rem] text-center">{label(weekStart)} week</span>
          <button onClick={() => loadWeek(shiftWeek(weekStart, 7))} className="p-2 rounded-lg hover:bg-stone-100 text-stone-600" aria-label="Next week"><ChevronRight size={18} /></button>
          <button onClick={() => loadWeek(currentMonday())} className="ml-1 text-sm text-stone-500 hover:text-stone-800 px-2 py-1">This week</button>
        </div>
        <div className="flex items-center gap-3">
          {visible.length > 0 && <span className="text-sm text-stone-500">{doneCount} of {visible.length} done</span>}
          <button onClick={generate} disabled={generating}
            className="flex items-center gap-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors">
            <RefreshCw size={16} className={generating ? 'animate-spin' : ''} /> {generating ? 'Working…' : 'Generate prep list'}
          </button>
        </div>
      </div>

      <div className="flex gap-1.5 mb-5 bg-stone-100 p-1 rounded-xl w-fit">
        {(['all', 'Wife', 'Kevin'] as const).map(w => (
          <button key={w} onClick={() => setWho(w)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              who === w ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}>
            {w === 'all' ? 'Everyone' : w === 'Wife' ? "Wife's prep" : 'My prep'}
          </button>
        ))}
      </div>

      {!loading && blocks.length === 0 && (
        <div className="bg-white border border-stone-200 rounded-2xl p-8 text-center text-stone-500">
          No prep tasks for this week yet.<br />
          <span className="text-sm">Hit &ldquo;Generate prep list&rdquo; once the week is shopped for.</span>
        </div>
      )}

      <div className="space-y-4">
        {blocks.map(block => (
          <section key={block.key} className="bg-white border border-stone-200 rounded-2xl p-4">
            <h3 className="font-medium text-stone-900 mb-3 flex items-center gap-2" style={{ fontFamily: 'DM Serif Display, serif' }}>
              <span className="text-xl">{dishEmoji(block.dish_name)}</span> {block.dish_name}
            </h3>
            <div className="space-y-3">
              {block.tasks.map(t => (
                <label key={t.id} className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={t.done} onChange={e => toggle(t.id, e.target.checked)}
                    className="w-6 h-6 mt-0.5 shrink-0 accent-orange-600" />
                  <span className={`text-base leading-snug ${t.done ? 'line-through text-stone-400' : 'text-stone-800'}`}>
                    {t.instruction}
                  </span>
                </label>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
