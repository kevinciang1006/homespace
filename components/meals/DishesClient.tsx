'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Star, BookOpen, Trash2 } from 'lucide-react'
import { SLOTS, SLOT_LABELS, type Dish, type Slot, type Tier } from '@/lib/meals/types'
import DishImage from './DishImage'
import DishEditorPanel from './DishEditorPanel'

const PROTEINS = ['fish', 'chicken', 'pork', 'beef', 'shrimp', 'squid', 'crab', 'duck', 'egg', 'tofu_tempe', 'none', 'mixed']
const TIERS: Tier[] = ['everyday', 'nice', 'special']
const METHODS = ['', 'fried', 'boiled', 'grilled', 'steamed', 'sauteed', 'braised', 'raw', 'baked', 'soup']

export default function DishesClient({ initialDishes }: { initialDishes: Dish[] }) {
  const [dishes, setDishes] = useState<Dish[]>(initialDishes)
  const [slotFilter, setSlotFilter] = useState<Slot | 'all'>('all')
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const editing = dishes.find(d => d.id === editingId) ?? null

  async function patch(id: string, fields: Partial<Dish>) {
    const prev = dishes.find(d => d.id === id)
    setDishes(ds => ds.map(d => d.id === id ? { ...d, ...fields } : d)) // optimistic
    const res = await fetch(`/api/meals/dishes/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fields),
    })
    if (!res.ok && prev) setDishes(ds => ds.map(d => d.id === id ? prev : d)) // rollback
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
      setSlotFilter(slot)   // ensure the new row is visible even if a filter was set
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

  const filtered = useMemo(() => dishes.filter(d =>
    (slotFilter === 'all' || d.slot === slotFilter) &&
    d.name.toLowerCase().includes(search.toLowerCase())), [dishes, slotFilter, search])

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <button onClick={() => setSlotFilter('all')}
          className={`px-3 py-1.5 rounded-lg text-sm ${slotFilter === 'all' ? 'bg-orange-100 text-orange-700' : 'text-stone-500 hover:bg-stone-100'}`}>All</button>
        {SLOTS.map(s => (
          <button key={s} onClick={() => setSlotFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-sm ${slotFilter === s ? 'bg-orange-100 text-orange-700' : 'text-stone-500 hover:bg-stone-100'}`}>
            {SLOT_LABELS[s]}</button>
        ))}
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search dishes…"
          className="ml-auto px-3 py-1.5 rounded-lg border border-stone-200 text-sm text-stone-800 focus:outline-none focus:border-orange-300" />
      </div>

      {SLOTS.filter(s => slotFilter === 'all' || s === slotFilter).map(slot => {
        const rows = filtered.filter(d => d.slot === slot)
        return (
          <section key={slot} className="mb-8">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg text-stone-800" style={{ fontFamily: 'DM Serif Display, serif' }}>{SLOT_LABELS[slot]}</h2>
              <button onClick={() => addDish(slot)}
                className="flex items-center gap-1 text-sm text-orange-600 hover:text-orange-700"><Plus size={15} /> Add dish</button>
            </div>
            <div className="bg-white border border-stone-200 rounded-2xl overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="text-left text-xs text-stone-400 border-b border-stone-100">
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Group</th>
                    <th className="px-3 py-2 font-medium">Protein</th>
                    <th className="px-3 py-2 font-medium">Tier</th>
                    <th className="px-3 py-2 font-medium">Method</th>
                    <th className="px-3 py-2 font-medium">Spicy</th>
                    <th className="px-3 py-2 font-medium">Rating</th>
                    <th className="px-3 py-2 font-medium">Active</th>
                    <th className="px-3 py-2 font-medium">Recipe</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(d => <DishRow key={d.id} dish={d} onPatch={patch} onEdit={() => setEditingId(d.id)}
                    onDelete={deleteDish} autoFocus={d.id === focusId} />)}
                  {rows.length === 0 && <tr><td colSpan={9} className="px-3 py-4 text-stone-400">No dishes</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}

      {editing && (
        <DishEditorPanel key={editing.id} dish={editing} onClose={() => setEditingId(null)} onPatch={patch} />
      )}
    </div>
  )
}

function DishRow({ dish, onPatch, onEdit, onDelete, autoFocus }: {
  dish: Dish
  onPatch: (id: string, f: Partial<Dish>) => void
  onEdit: () => void
  onDelete: (id: string, name: string) => void
  autoFocus?: boolean
}) {
  const [name, setName] = useState(dish.name)
  const nameRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (autoFocus && nameRef.current) { nameRef.current.focus(); nameRef.current.select() }
    // run once on mount for a freshly added row
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <tr className="border-b border-stone-50 last:border-0">
      <td className="px-3 py-1.5">
        <div className="flex items-center gap-2">
          <DishImage imageUrl={dish.recipe_image_url} protein={dish.protein} name={dish.name}
            className="w-7 h-7 shrink-0" rounded="rounded-md" iconSize={14} />
          <input ref={nameRef} value={name} onChange={e => setName(e.target.value)}
            placeholder="Dish name…"
            onBlur={() => name.trim() && name !== dish.name && onPatch(dish.id, { name: name.trim() })}
            className="w-full min-w-[11rem] bg-transparent text-stone-800 focus:outline-none focus:bg-stone-50 rounded px-1 py-0.5" />
        </div>
      </td>
      <td className="px-3 py-1.5">
        <select value={dish.slot} onChange={e => onPatch(dish.id, { slot: e.target.value as Slot })}
          className="bg-transparent text-stone-600 focus:outline-none">
          {SLOTS.map(s => <option key={s} value={s}>{SLOT_LABELS[s]}</option>)}
        </select>
      </td>
      <td className="px-3 py-1.5">
        <select value={dish.protein} onChange={e => onPatch(dish.id, { protein: e.target.value })}
          className="bg-transparent text-stone-600 focus:outline-none">
          {PROTEINS.map(p => <option key={p} value={p}>{p}</option>)}
          {!PROTEINS.includes(dish.protein) && <option value={dish.protein}>{dish.protein}</option>}
        </select>
      </td>
      <td className="px-3 py-1.5">
        <select value={dish.tier} onChange={e => onPatch(dish.id, { tier: e.target.value as Tier })}
          className="bg-transparent text-stone-600 focus:outline-none">
          {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </td>
      <td className="px-3 py-1.5">
        <select value={dish.method ?? ''} onChange={e => onPatch(dish.id, { method: e.target.value || null })}
          className="bg-transparent text-stone-600 focus:outline-none">
          {METHODS.map(m => <option key={m} value={m}>{m || '—'}</option>)}
          {dish.method && !METHODS.includes(dish.method) && <option value={dish.method}>{dish.method}</option>}
        </select>
      </td>
      <td className="px-3 py-1.5">
        <button onClick={() => onPatch(dish.id, { spicy: !dish.spicy })} aria-label="Toggle spicy"
          className={`w-9 h-5 rounded-full transition-colors relative ${dish.spicy ? 'bg-orange-500' : 'bg-stone-200'}`}>
          <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${dish.spicy ? 'left-4' : 'left-0.5'}`} />
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
        <button onClick={() => onPatch(dish.id, { active: !dish.active })} aria-label="Toggle active"
          className={`w-9 h-5 rounded-full transition-colors relative ${dish.active ? 'bg-green-500' : 'bg-stone-200'}`}>
          <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${dish.active ? 'left-4' : 'left-0.5'}`} />
        </button>
      </td>
      <td className="px-3 py-1.5">
        <div className="flex items-center gap-2 whitespace-nowrap">
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
