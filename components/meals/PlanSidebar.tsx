'use client'
import { useState } from 'react'
import { ChevronLeft, ChevronRight, ShoppingCart, Trash2, Sparkles, SlidersHorizontal, X } from 'lucide-react'
import ViewToggle from './ViewToggle'
import Portal from '@/components/Portal'

// The week/day toggle + the week-level actions that used to crowd the top
// bar (Generate Week, Build shopping list, Randomize breakfast, Randomize
// desserts, Clear week) — pulled into an e-commerce-style filter sidebar so
// the main content only keeps the week nav arrows.
//
// Desktop (sm:+): a sticky left column, itself collapsible to a thin strip.
// Mobile: no inline card at all (that read as an ugly block above the day
// grid) — instead a small "Actions" trigger opens the same controls as a
// bottom-sheet drawer, matching DishEditorPanel's slide-up pattern.
export default function PlanSidebar({
  dayHref,
  generating, onGenerate,
  hasWeek, clearing, onClearWeek,
  randomizingBreakfast, onRandomizeBreakfasts,
  randomizingDesserts, onRandomizeDesserts,
  buildingList, onBuildList,
}: {
  dayHref: string
  generating: boolean
  onGenerate: () => void
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
  const [mobileOpen, setMobileOpen] = useState(false)

  const actions = (
    <div className="space-y-1.5">
      <button onClick={onGenerate} disabled={generating}
        className="w-full flex items-center gap-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-60 text-white text-sm font-medium px-3 py-2 rounded-xl transition-colors">
        <Sparkles size={15} /> {generating ? 'Generating…' : 'Generate Week'}
      </button>
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
  )

  return (
    <>
      {/* Mobile trigger — the desktop sidebar below is hidden entirely on
          mobile, so this is the only way in on a small screen. */}
      <button onClick={() => setMobileOpen(true)}
        className="sm:hidden flex items-center gap-1.5 border border-stone-200 text-stone-600 bg-white text-sm font-medium px-3 py-2 rounded-xl">
        <SlidersHorizontal size={15} /> Actions
      </button>

      {mobileOpen && (
        <Portal>
          <div className="fixed inset-0 z-50 sm:hidden flex items-end">
            <div className="absolute inset-0 bg-black/25" onClick={() => setMobileOpen(false)} />
            <div className="relative bg-white w-full rounded-t-2xl max-h-[85vh] overflow-y-auto">
              <div className="sticky top-0 bg-white border-b border-stone-100 px-4 py-3 flex items-center justify-between">
                <span className="text-sm font-semibold text-stone-700">Actions</span>
                <button onClick={() => setMobileOpen(false)} className="p-1.5 rounded-lg text-stone-400 hover:bg-stone-100" aria-label="Close"><X size={18} /></button>
              </div>
              <div className="p-4 space-y-3">
                <ViewToggle weekHref="/meals" dayHref={dayHref} />
                {actions}
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* Desktop sticky sidebar */}
      <div className="hidden sm:block shrink-0">
        {collapsed ? (
          <button onClick={() => setCollapsed(false)} title="Show actions" aria-label="Show actions"
            className="w-10 flex items-center justify-center bg-white border border-stone-200 rounded-xl p-2 text-stone-400 hover:text-stone-700 hover:bg-stone-50 sticky top-20">
            <ChevronRight size={16} />
          </button>
        ) : (
          <aside className="w-52">
            <div className="bg-white border border-stone-200 rounded-2xl p-3 space-y-3 sticky top-20">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-stone-400 uppercase tracking-wide">Actions</span>
                <button onClick={() => setCollapsed(true)} title="Hide actions" aria-label="Hide actions"
                  className="p-1 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100">
                  <ChevronLeft size={15} />
                </button>
              </div>

              <ViewToggle weekHref="/meals" dayHref={dayHref} />

              <div className="border-t border-stone-100 pt-3">
                {actions}
              </div>
            </div>
          </aside>
        )}
      </div>
    </>
  )
}
