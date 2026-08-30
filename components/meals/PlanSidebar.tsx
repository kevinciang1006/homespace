'use client'
import { useState } from 'react'
import { ChevronLeft, ChevronRight, ShoppingCart, Trash2 } from 'lucide-react'
import ViewToggle from './ViewToggle'

// The week/day toggle + the four week-level actions that used to crowd the
// top bar (Clear week, Randomize breakfast, Randomize desserts, Build
// shopping list) — pulled into an e-commerce-style filter sidebar so the
// main content only keeps the week nav + Generate Week. Collapsible: on
// mobile this stacks above the day grid (flex-col in PlanClient), on
// desktop it's a sticky left column.
export default function PlanSidebar({
  dayHref,
  hasWeek, clearing, onClearWeek,
  randomizingBreakfast, onRandomizeBreakfasts,
  randomizingDesserts, onRandomizeDesserts,
  buildingList, onBuildList,
}: {
  dayHref: string
  hasWeek: boolean
  clearing: boolean
  onClearWeek: () => void
  randomizingBreakfast: boolean
  onRandomizeBreakfasts: () => void
  randomizingDesserts: boolean
  onRandomizeDesserts: () => void
  buildingList: boolean
  onBuildList: () => void
}) {
  const [collapsed, setCollapsed] = useState(false)

  if (collapsed) {
    return (
      <div className="sm:w-10 shrink-0">
        <button onClick={() => setCollapsed(false)} title="Show actions" aria-label="Show actions"
          className="w-full flex items-center justify-center bg-white border border-stone-200 rounded-xl p-2 text-stone-400 hover:text-stone-700 hover:bg-stone-50 sm:sticky sm:top-20">
          <ChevronRight size={16} />
        </button>
      </div>
    )
  }

  return (
    <aside className="sm:w-52 shrink-0">
      <div className="bg-white border border-stone-200 rounded-2xl p-3 space-y-3 sm:sticky sm:top-20">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-stone-400 uppercase tracking-wide">Actions</span>
          <button onClick={() => setCollapsed(true)} title="Hide actions" aria-label="Hide actions"
            className="p-1 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100">
            <ChevronLeft size={15} />
          </button>
        </div>

        <ViewToggle weekHref="/meals" dayHref={dayHref} />

        <div className="border-t border-stone-100 pt-3 space-y-1.5">
          <button onClick={onBuildList} disabled={buildingList}
            className="w-full flex items-center gap-2 border border-orange-200 text-orange-700 hover:bg-orange-50 disabled:opacity-60 text-sm font-medium px-3 py-2 rounded-xl transition-colors">
            <ShoppingCart size={15} /> {buildingList ? 'Building…' : 'Build shopping list'}
          </button>
          <button onClick={onRandomizeBreakfasts} disabled={randomizingBreakfast}
            className="w-full flex items-center gap-2 border border-stone-200 text-stone-600 hover:bg-stone-50 disabled:opacity-60 text-sm font-medium px-3 py-2 rounded-xl transition-colors">
            🎲 {randomizingBreakfast ? 'Randomizing…' : 'Randomize breakfast'}
          </button>
          <button onClick={onRandomizeDesserts} disabled={randomizingDesserts}
            className="w-full flex items-center gap-2 border border-stone-200 text-stone-600 hover:bg-stone-50 disabled:opacity-60 text-sm font-medium px-3 py-2 rounded-xl transition-colors">
            🎲 {randomizingDesserts ? 'Randomizing…' : 'Randomize desserts'}
          </button>
          {hasWeek && (
            <button onClick={onClearWeek} disabled={clearing}
              title="Empty this week (removes it from next week's variety/spacing rules)"
              className="w-full flex items-center gap-2 text-stone-500 hover:text-stone-800 hover:bg-stone-100 disabled:opacity-60 text-sm font-medium px-3 py-2 rounded-xl transition-colors">
              <Trash2 size={15} /> {clearing ? 'Clearing…' : 'Clear week'}
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}
