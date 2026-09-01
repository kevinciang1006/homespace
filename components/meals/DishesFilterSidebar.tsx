'use client'
import { Plus } from 'lucide-react'
import { SLOT_LABELS, type Slot, type Tier } from '@/lib/meals/types'
import { PROTEINS, TIERS, VISIBLE_SLOTS } from '@/lib/meals/dishFields'
import SidebarShell from '@/components/SidebarShell'

export type DishFilters = {
  search: string
  slot: Slot | 'all'
  protein: string | 'all'
  tier: Tier | 'all'
  activeOnly: boolean
}

export const DEFAULT_FILTERS: DishFilters = { search: '', slot: 'all', protein: 'all', tier: 'all', activeOnly: false }

export default function DishesFilterSidebar({ filters, onChange, onAddDish }: {
  filters: DishFilters
  onChange: (next: DishFilters) => void
  onAddDish: (slot: Slot) => void
}) {
  const set = <K extends keyof DishFilters>(key: K, value: DishFilters[K]) => onChange({ ...filters, [key]: value })
  // Adds into whichever group is currently filtered — falls back to Utama
  // when "All" is selected. No second group picker for this (there was
  // one at first: a dropdown here alongside the Group pills below —
  // dropped since it read as two duplicate "group" controls doing the
  // same job).
  const addSlot: Slot = filters.slot === 'all' ? 'utama' : filters.slot

  return (
    <SidebarShell title="Filters" mobileLabel="Filters">
      <div className="space-y-4">
        {/* Add dish — an action, not a filter, but lives here so it's always
            reachable without scrolling back up to a per-section button now
            that there's only one table instead of one per slot. */}
        <button onClick={() => onAddDish(addSlot)}
          className="w-full flex items-center justify-center gap-1.5 bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium px-3 py-2 rounded-xl transition-colors">
          <Plus size={15} /> Add {SLOT_LABELS[addSlot]} dish
        </button>

        <div className="border-t border-stone-100 pt-3">
          <input value={filters.search} onChange={e => set('search', e.target.value)} placeholder="Search dishes…"
            className="w-full px-3 py-1.5 rounded-lg border border-stone-200 text-sm text-stone-800 focus:outline-none focus:border-orange-300" />
        </div>

        <div className="border-t border-stone-100 pt-3">
          <div className="text-xs font-medium text-stone-400 mb-1.5">Group</div>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => set('slot', 'all')}
              className={`px-2.5 py-1 rounded-lg text-xs ${filters.slot === 'all' ? 'bg-orange-100 text-orange-700' : 'text-stone-500 hover:bg-stone-100'}`}>All</button>
            {VISIBLE_SLOTS.map(s => (
              <button key={s} onClick={() => set('slot', s)}
                className={`px-2.5 py-1 rounded-lg text-xs ${filters.slot === s ? 'bg-orange-100 text-orange-700' : 'text-stone-500 hover:bg-stone-100'}`}>
                {SLOT_LABELS[s]}</button>
            ))}
          </div>
        </div>

        <div className="border-t border-stone-100 pt-3">
          <label className="block text-xs font-medium text-stone-400 mb-1.5">Protein</label>
          <select value={filters.protein} onChange={e => set('protein', e.target.value)}
            className="w-full px-2 py-1.5 rounded-lg border border-stone-200 text-sm text-stone-800 focus:outline-none focus:border-orange-300">
            <option value="all">All proteins</option>
            {PROTEINS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <div className="border-t border-stone-100 pt-3">
          <label className="block text-xs font-medium text-stone-400 mb-1.5">Tier</label>
          <select value={filters.tier} onChange={e => set('tier', e.target.value as Tier | 'all')}
            className="w-full px-2 py-1.5 rounded-lg border border-stone-200 text-sm text-stone-800 focus:outline-none focus:border-orange-300">
            <option value="all">All tiers</option>
            {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div className="border-t border-stone-100 pt-3">
          <button type="button" role="switch" aria-checked={filters.activeOnly}
            onClick={() => set('activeOnly', !filters.activeOnly)}
            className="w-full flex items-center justify-between gap-2">
            <span className="text-sm text-stone-700">Active only</span>
            <span className={`shrink-0 w-9 h-5 rounded-full transition-colors relative ${filters.activeOnly ? 'bg-orange-500' : 'bg-stone-200'}`}>
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${filters.activeOnly ? 'left-4' : 'left-0.5'}`} />
            </span>
          </button>
        </div>

        {(filters.search || filters.slot !== 'all' || filters.protein !== 'all' || filters.tier !== 'all' || filters.activeOnly) && (
          <button onClick={() => onChange(DEFAULT_FILTERS)} className="text-xs text-stone-400 hover:text-stone-700">Clear all filters</button>
        )}
      </div>
    </SidebarShell>
  )
}
