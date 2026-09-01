'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Star, BookOpen, Trash2 } from 'lucide-react'
import { SLOT_LABELS, type Dish, type Slot } from '@/lib/meals/types'
import { PROTEINS, TIERS, VISIBLE_SLOTS } from '@/lib/meals/dishFields'
import DishImage from './DishImage'
import DishEditorPanel from './DishEditorPanel'
import PhotoUploadButton from './PhotoUploadButton'
import RecipeLinkButton from './RecipeLinkButton'
import DishesFilterSidebar, { DEFAULT_FILTERS, type DishFilters } from './DishesFilterSidebar'

// One flat table across every (non-breakfast) group instead of one table per
// slot — VISIBLE_SLOTS' order is what rows sort by so a mixed "All" view
// still reads group-by-group instead of a random jumble.
const SLOT_ORDER: Record<Slot, number> = Object.fromEntries(VISIBLE_SLOTS.map((s, i) => [s, i])) as Record<Slot, number>

// Shared column widths for the split header/body tables below — table-fixed
// + an identical <colgroup> on both is what keeps their columns pixel-aligned
// even though they're two separate <table> elements (see the render's own
// comment for why they're split at all). Total also drives the min-width
// both tables share, so they scroll horizontally in lockstep.
const COLS = [
  { label: 'Name', width: 220 },
  { label: 'Group', width: 110 },
  { label: 'Protein', width: 110 },
  { label: 'Tier', width: 100 },
  { label: 'Active', width: 80 },
  { label: 'Rating', width: 110 },
  { label: 'Actions', width: 160 },
]
const TABLE_MIN_WIDTH = COLS.reduce((sum, c) => sum + c.width, 0)

export default function DishesClient({ initialDishes, initialEditId = null }:
  { initialDishes: Dish[]; initialEditId?: string | null }) {
  const [dishes, setDishes] = useState<Dish[]>(initialDishes)
  const [filters, setFilters] = useState<DishFilters>(DEFAULT_FILTERS)
  const [editingId, setEditingId] = useState<string | null>(initialEditId)
  const [focusId, setFocusId] = useState<string | null>(null)
  const editing = dishes.find(d => d.id === editingId) ?? null
  const headerScrollRef = useRef<HTMLDivElement>(null)
  const bodyScrollRef = useRef<HTMLDivElement>(null)
  // The header lives in its own div, genuinely sticky to the PAGE (it's a
  // sibling of, not nested inside, the body's horizontally-scrolling div —
  // see the render's comment for why that split is necessary). Keeping the
  // two visually aligned as she scrolls the body sideways just means
  // copying scrollLeft across on every scroll event.
  function syncHeaderScroll() {
    if (headerScrollRef.current && bodyScrollRef.current) headerScrollRef.current.scrollLeft = bodyScrollRef.current.scrollLeft
  }

  // Arriving from a recipe page ("Edit in Dishes") opens the editor for that
  // dish and scrolls its row into view.
  useEffect(() => {
    if (!initialEditId) return
    const el = document.getElementById(`dish-${initialEditId}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function patch(id: string, fields: Partial<Dish>) {
    const prev = dishes.find(d => d.id === id)
    setDishes(ds => ds.map(d => d.id === id ? { ...d, ...fields } : d)) // optimistic
    const res = await fetch(`/api/meals/dishes/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fields),
    })
    if (!res.ok && prev) setDishes(ds => ds.map(d => d.id === id ? prev : d)) // rollback
  }

  // For buttons that persist themselves (PhotoUploadButton, RecipeLinkButton) —
  // local state only, no second PATCH.
  function syncDish(id: string, fields: Partial<Dish>) {
    setDishes(ds => ds.map(d => d.id === id ? { ...d, ...fields } : d))
  }

  async function addDish(slot: Slot) {
    // Insert a real, deletable row immediately (server defaults the name to
    // "Untitled"), then focus its name field for inline editing.
    const res = await fetch('/api/meals/dishes', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slot }),
    })
    if (res.ok) {
      const d = await res.json() as Dish
      setDishes(ds => [...ds, d])
      setFilters(f => ({ ...f, slot: 'all' })) // ensure the new row is visible even if a different group was filtered
      setFocusId(d.id)
    }
  }

  async function deleteDish(id: string, name: string) {
    if (!window.confirm(`Delete ${name || 'this dish'}? This can't be undone.`)) return
    const prev = dishes
    setDishes(ds => ds.filter(d => d.id !== id)) // optimistic
    if (editingId === id) setEditingId(null)
    const res = await fetch(`/api/meals/dishes/${id}`, { method: 'DELETE' })
    if (!res.ok) setDishes(prev) // rollback
  }

  const filtered = useMemo(() => dishes
    .filter(d =>
      VISIBLE_SLOTS.includes(d.slot) && // breakfast hidden — see VISIBLE_SLOTS' comment in lib/meals/dishFields.ts
      (filters.slot === 'all' || d.slot === filters.slot) &&
      (filters.protein === 'all' || d.protein === filters.protein) &&
      (filters.tier === 'all' || d.tier === filters.tier) &&
      (!filters.activeOnly || d.active) &&
      d.name.toLowerCase().includes(filters.search.toLowerCase()))
    .sort((a, b) => SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot] || a.name.localeCompare(b.name)),
  [dishes, filters])

  return (
    // items-start is deliberately NOT here — with it, the sidebar's own
    // containing block (this row's aside child) is only as tall as the
    // sidebar itself, so position:sticky has no room to move within before
    // hitting its own bottom edge and un-sticking immediately. Default
    // (stretch) alignment lets the aside stretch to match this row's
    // taller sibling (the table), which is what actually makes it stick.
    <div className="flex flex-col sm:flex-row gap-4">
      <DishesFilterSidebar filters={filters} onChange={setFilters} onAddDish={addDish} />

      <div className="flex-1 min-w-0 w-full">
        {/* Split into two <table>s (header, body) instead of one — a
            single table can't have BOTH "sticky header while the PAGE
            scrolls vertically" AND "horizontal scroll contained to the
            table" at once. Per the CSS overflow spec, any non-visible
            overflow-x forces overflow-y to compute to auto too, which
            makes a horizontally-scrolling wrapper a sticky-positioning
            container in its own right — but since it's never
            height-bounded (that's the point: the page scrolls, not an
            inner pane), it never actually scrolls itself, so a sticky
            <th> inside it would just sit static. Splitting the header out
            into its OWN div — a sibling of, not nested inside, the
            scrolling body — sidesteps that entirely: this div has no
            overflow-x of its own, so it's free to genuinely stick to the
            page. Its horizontal position is kept in sync with the body's
            scroll via scrollLeft on every scroll event. table-fixed + an
            identical <colgroup> on both tables is what keeps every column
            pixel-aligned between them despite being separate elements. */}
        <div ref={headerScrollRef} className="sticky top-20 z-20 bg-white border border-stone-200 rounded-t-2xl overflow-x-hidden">
          <table className="w-full text-sm table-fixed" style={{ minWidth: TABLE_MIN_WIDTH }}>
            <colgroup>{COLS.map(c => <col key={c.label} style={{ width: c.width }} />)}</colgroup>
            <thead>
              <tr className="text-left text-xs text-stone-400 border-b border-stone-100">
                <th className="px-3 py-2 font-medium bg-white md:sticky md:left-0 md:z-10 md:border-r md:border-stone-100">Name</th>
                {COLS.slice(1).map(c => <th key={c.label} className="px-3 py-2 font-medium">{c.label}</th>)}
              </tr>
            </thead>
          </table>
        </div>
        <div ref={bodyScrollRef} onScroll={syncHeaderScroll}
          className="bg-white border border-t-0 border-stone-200 rounded-b-2xl overflow-x-auto">
          <table className="w-full text-sm table-fixed" style={{ minWidth: TABLE_MIN_WIDTH }}>
            <colgroup>{COLS.map(c => <col key={c.label} style={{ width: c.width }} />)}</colgroup>
            <tbody>
              {filtered.map(d => <DishRow key={d.id} dish={d} onPatch={patch} onSync={syncDish} onEdit={() => setEditingId(d.id)}
                onDelete={deleteDish} autoFocus={d.id === focusId} highlight={d.id === initialEditId} />)}
              {filtered.length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-stone-400">No dishes</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <DishEditorPanel key={editing.id} dish={editing} onClose={() => setEditingId(null)} onPatch={patch} onSynced={syncDish} />
      )}
    </div>
  )
}

// Kept inline: the fields worth a glance while scanning the whole list
// (name/photo, which group, protein, tier, whether it's active, rating) plus
// the row actions. Everything else that used to be its own column (fruit
// context, cadence, produce role, prep type, helper, veg style, base key,
// method, saltiness, difficulty, spicy, garnish, soup, self-sufficient,
// quantity) moved into DishEditorPanel's Details section — same data, same
// edits, just reached via "Edit" instead of a 22-column table.
function DishRow({ dish, onPatch, onSync, onEdit, onDelete, autoFocus, highlight }: {
  dish: Dish
  onPatch: (id: string, f: Partial<Dish>) => void
  onSync: (id: string, f: Partial<Dish>) => void
  onEdit: () => void
  onDelete: (id: string, name: string) => void
  autoFocus?: boolean
  highlight?: boolean
}) {
  const [name, setName] = useState(dish.name)
  const nameRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (autoFocus && nameRef.current) { nameRef.current.focus(); nameRef.current.select() }
    // run once on mount for a freshly added row
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <tr id={`dish-${dish.id}`} className={`border-b border-stone-50 last:border-0 ${highlight ? 'bg-orange-50/60' : ''}`}>
      <td className={`px-3 py-1.5 md:sticky md:left-0 md:z-10 md:border-r md:border-stone-100 ${highlight ? 'bg-orange-50' : 'bg-white'}`}>
        <div className="flex items-center gap-2">
          <div className="relative shrink-0">
            <DishImage imageUrl={dish.recipe_image_url} protein={dish.protein} name={dish.name}
              className="w-10 h-10" rounded="rounded-lg" iconSize={18} />
            <div className="absolute -bottom-1 -right-1">
              <PhotoUploadButton dishId={dish.id} variant="icon"
                label={dish.recipe_image_url ? 'Change photo' : 'Add photo'}
                className="bg-white shadow border border-stone-200 text-stone-500 hover:text-stone-700"
                onUploaded={url => onSync(dish.id, { recipe_image_url: url })} />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <input ref={nameRef} value={name} onChange={e => setName(e.target.value)}
              placeholder="Dish name…" title={name}
              onBlur={() => name.trim() && name !== dish.name && onPatch(dish.id, { name: name.trim() })}
              className="w-full truncate bg-transparent text-stone-800 focus:outline-none focus:bg-stone-50 rounded px-1 py-0.5" />
            {dish.is_garnish && <div className="text-[10px] text-stone-400 px-1">garnish — not auto-planned</div>}
          </div>
        </div>
      </td>
      <td className="px-3 py-1.5">
        <select value={dish.slot} onChange={e => onPatch(dish.id, { slot: e.target.value as Slot })}
          className="w-full bg-transparent text-stone-800 focus:outline-none">
          {VISIBLE_SLOTS.map(s => <option key={s} value={s}>{SLOT_LABELS[s]}</option>)}
        </select>
      </td>
      <td className="px-3 py-1.5">
        <select value={dish.protein} onChange={e => onPatch(dish.id, { protein: e.target.value })}
          className="w-full bg-transparent text-stone-800 focus:outline-none">
          {PROTEINS.map(p => <option key={p} value={p}>{p}</option>)}
          {!PROTEINS.includes(dish.protein) && <option value={dish.protein}>{dish.protein}</option>}
        </select>
      </td>
      <td className="px-3 py-1.5">
        <select value={dish.tier} onChange={e => onPatch(dish.id, { tier: e.target.value as Dish['tier'] })}
          className="w-full bg-transparent text-stone-800 focus:outline-none">
          {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </td>
      <td className="px-3 py-1.5">
        <button onClick={() => onPatch(dish.id, { active: !dish.active })} aria-label="Toggle active"
          className={`w-9 h-5 rounded-full transition-colors relative ${dish.active ? 'bg-green-500' : 'bg-stone-200'}`}>
          <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${dish.active ? 'left-4' : 'left-0.5'}`} />
        </button>
      </td>
      <td className="px-3 py-1.5">
        <div className="flex gap-0.5">
          {[1, 2, 3, 4, 5].map(n => (
            <button key={n} onClick={() => onPatch(dish.id, { rating: n })} aria-label={`Rate ${n}`}>
              <Star size={14} className={n <= dish.rating ? 'fill-amber-400 text-amber-400' : 'text-stone-300'} />
            </button>
          ))}
        </div>
      </td>
      <td className="px-3 py-1.5">
        <div className="flex items-center gap-2 whitespace-nowrap">
          <RecipeLinkButton dishId={dish.id} links={dish.recipe_links ?? []}
            onSaved={next => onSync(dish.id, { recipe_links: next })} />
          <button onClick={onEdit}
            className="flex items-center gap-1 text-xs text-stone-500 hover:text-orange-600">
            <BookOpen size={14} /> Edit
          </button>
          <button onClick={() => onDelete(dish.id, dish.name)} aria-label={`Delete ${dish.name}`}
            className="p-1 text-stone-300 hover:text-red-500">
            <Trash2 size={14} />
          </button>
        </div>
      </td>
    </tr>
  )
}
