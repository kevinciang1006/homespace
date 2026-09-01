'use client'
import { useState } from 'react'
import { ShoppingCart, Trash2, Sparkles, SlidersHorizontal, X } from 'lucide-react'
import ViewToggle from './ViewToggle'
import Portal from '@/components/Portal'

// The week/day toggle + the week-level actions (Generate Week, Build
// shopping list, Randomize breakfast, Randomize desserts, Clear week) — a
// single trigger button opens them as a left-side overlay, matching
// DishEditorPanel's slide-over pattern (Portal, dark backdrop, closes on
// backdrop click) instead of a sticky column that permanently reserves
// page width. Same overlay on every breakpoint now, just anchored to the
// opposite edge and a bottom sheet on mobile like DishEditorPanel already is.
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
  const [open, setOpen] = useState(false)

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 border border-stone-200 text-stone-600 bg-white hover:bg-stone-50 text-sm font-medium px-3 py-2 rounded-xl">
        <SlidersHorizontal size={15} /> Actions
      </button>

      {open && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-end md:items-stretch md:justify-start">
            <div className="absolute inset-0 bg-black/25" onClick={() => setOpen(false)} />
            <div className="relative bg-white w-full md:w-72 md:h-full rounded-t-2xl md:rounded-none max-h-[85vh] md:max-h-full overflow-y-auto">
              <div className="sticky top-0 bg-white border-b border-stone-100 px-4 py-3 flex items-center justify-between">
                <span className="text-sm font-semibold text-stone-700">Actions</span>
                <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg text-stone-400 hover:bg-stone-100" aria-label="Close"><X size={18} /></button>
              </div>
              <div className="p-4 space-y-3">
                <ViewToggle weekHref="/meals" dayHref={dayHref} />

                <div className="border-t border-stone-100 pt-3 space-y-1.5">
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
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  )
}
