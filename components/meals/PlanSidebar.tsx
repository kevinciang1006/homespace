'use client'
import { ShoppingCart, Trash2, Sparkles } from 'lucide-react'
import ViewToggle from './ViewToggle'
import SidebarShell from '@/components/SidebarShell'

// The week/day toggle + the week-level actions (Generate Week, Build
// shopping list, Randomize breakfast, Randomize desserts, Clear week) —
// SidebarShell gives this a sticky, space-reserving column on desktop and
// a hamburger-triggered drawer on mobile, the same shell Dishes' filter
// sidebar uses, so the two pages behave identically.
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
  return (
    <SidebarShell title="Actions" mobileLabel="Actions">
      <div className="space-y-3">
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
    </SidebarShell>
  )
}
