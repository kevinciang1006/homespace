'use client'
import { useEffect, useState } from 'react'
import { Search, X } from 'lucide-react'

type SearchHit = { dish_id: string; dish_name: string; dates: string[] }

function dayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

// "When will I eat X?" — searches every generated week (via /api/meals/search,
// not just the one on screen) and hands a picked date up to the parent, which
// loads that week and flash-highlights the day. Debounced, closes on pick/clear.
export default function PlanSearchBar({ onJump }: { onJump: (date: string) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchHit[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  // `loading` toggles from the onChange handler below (a user event, not the
  // effect) so this effect only ever calls setState from inside the async
  // callback — the pattern react-hooks/set-state-in-effect wants.
  useEffect(() => {
    const q = query.trim()
    if (!q) return
    const t = setTimeout(async () => {
      const res = await fetch(`/api/meals/search?q=${encodeURIComponent(q)}`)
      if (res.ok) { const { results } = await res.json(); setResults(results ?? []) }
      setLoading(false)
    }, 250)
    return () => clearTimeout(t)
  }, [query])

  function pick(date: string) {
    onJump(date)
    setOpen(false)
    setQuery('')
    setResults(null)
  }
  function clear() { setQuery(''); setResults(null); setOpen(false) }

  return (
    <div className="relative mb-4">
      <div className="flex items-center gap-2 bg-white border border-stone-200 rounded-xl px-3 py-2 focus-within:border-orange-300">
        <Search size={15} className="text-stone-400 shrink-0" />
        <input
          value={query}
          onChange={e => {
            const v = e.target.value
            setQuery(v); setOpen(true)
            if (!v.trim()) { setResults(null); setLoading(false) } else { setLoading(true) }
          }}
          onFocus={() => setOpen(true)}
          placeholder="When am I eating… (search a dish)"
          className="flex-1 min-w-0 bg-transparent text-sm text-stone-800 focus:outline-none"
        />
        {query && (
          <button onClick={clear} className="text-stone-300 hover:text-stone-600 shrink-0" aria-label="Clear search">
            <X size={14} />
          </button>
        )}
      </div>

      {open && query.trim() && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-stone-200 rounded-xl shadow-lg max-h-72 overflow-y-auto p-1">
          {loading && <div className="px-3 py-2 text-xs text-stone-400">Searching…</div>}
          {!loading && results?.length === 0 && (
            <div className="px-3 py-2 text-xs text-stone-400">No matches in the generated plan.</div>
          )}
          {!loading && results?.map(r => (
            <div key={r.dish_id} className="px-3 py-2">
              <div className="text-sm text-stone-800 font-medium">{r.dish_name}</div>
              <div className="flex flex-wrap gap-1 mt-1">
                {r.dates.map(d => (
                  <button key={d} onClick={() => pick(d)}
                    className="text-xs px-2 py-0.5 rounded-full bg-stone-100 hover:bg-orange-100 hover:text-orange-700 text-stone-600 transition-colors">
                    {dayLabel(d)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
