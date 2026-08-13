'use client'
import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, ListChecks, Trash2, Plus } from 'lucide-react'
import { SHOP_CATEGORIES, type ShopCategory } from '@/lib/meals/shopping'
import { currentMonday, shiftWeek, weekDates } from '@/lib/meals/dates'
import type { MealShoppingList, MealShoppingItem } from '@/lib/meals/types'

const CAT_LABEL: Record<string, string> = {
  protein: 'Protein', vegetable: 'Vegetable', pantry: 'Pantry', other: 'Other', dish: 'Dishes this week',
}
const CAT_BADGE: Record<string, string> = {
  protein: 'bg-rose-100 text-rose-700', vegetable: 'bg-green-100 text-green-700',
  pantry: 'bg-amber-100 text-amber-700', other: 'bg-stone-100 text-stone-600', dish: 'bg-stone-100 text-stone-500',
}
function label(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function ShoppingListClient({ initialWeekStart, initialList, initialItems }: {
  initialWeekStart: string
  initialList: MealShoppingList | null
  initialItems: MealShoppingItem[]
}) {
  const [weekStart, setWeekStart] = useState(initialWeekStart)
  const [list, setList] = useState<MealShoppingList | null>(initialList)
  const [items, setItems] = useState<MealShoppingItem[]>(initialItems)
  const [busy, setBusy] = useState(false)
  const days = useMemo(() => weekDates(weekStart), [weekStart])

  async function loadWeek(ws: string) {
    setWeekStart(ws)
    const res = await fetch(`/api/meals/shopping?weekStart=${ws}`)
    const { list, items } = await res.json()
    setList(list ?? null); setItems(items ?? [])
  }

  async function generate() {
    if (list && !window.confirm('Regenerate? This clears manually-added items and your ✓ marks.')) return
    setBusy(true)
    try {
      const res = await fetch('/api/meals/shopping/generate', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ weekStart }),
      })
      const { list, items } = await res.json()
      setList(list ?? null); setItems(items ?? [])
    } finally { setBusy(false) }
  }

  function patchItem(id: string, fields: Partial<MealShoppingItem>) {
    const prev = items.find(i => i.id === id)
    setItems(is => is.map(i => i.id === id ? { ...i, ...fields } : i)) // optimistic
    fetch(`/api/meals/shopping/items/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fields),
    }).then(res => { if (!res.ok && prev) setItems(is => is.map(i => i.id === id ? prev : i)) })
  }
  async function deleteItem(id: string) {
    const prev = items
    setItems(is => is.filter(i => i.id !== id)) // optimistic
    const res = await fetch(`/api/meals/shopping/items/${id}`, { method: 'DELETE' })
    if (!res.ok) setItems(prev)
  }
  async function addItem(ingredient: string, quantity: string, category: ShopCategory) {
    if (!list || !ingredient.trim()) return
    const res = await fetch('/api/meals/shopping/items', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ list_id: list.id, ingredient, quantity, category }),
    })
    if (res.ok) { const row = await res.json(); setItems(is => [...is, row as MealShoppingItem]) }
  }

  const buyable = items.filter(i => i.category !== 'dish' && !i.already_have)
  const remaining = buyable.filter(i => !i.checked).length
  const dishRows = items.filter(i => i.category === 'dish')

  return (
    <div>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => loadWeek(shiftWeek(weekStart, -7))} className="p-2 rounded-lg hover:bg-stone-100 text-stone-600" aria-label="Previous week"><ChevronLeft size={18} /></button>
          <span className="text-sm font-medium text-stone-700 min-w-[9rem] text-center">{label(days[0])} – {label(days[6])}</span>
          <button onClick={() => loadWeek(shiftWeek(weekStart, 7))} className="p-2 rounded-lg hover:bg-stone-100 text-stone-600" aria-label="Next week"><ChevronRight size={18} /></button>
          <button onClick={() => loadWeek(currentMonday())} className="ml-1 text-sm text-stone-500 hover:text-stone-800 px-2 py-1">This week</button>
        </div>
        <div className="flex items-center gap-3">
          {list && <span className="text-sm text-stone-500">{remaining} of {buyable.length} to buy</span>}
          <button onClick={generate} disabled={busy}
            className="flex items-center gap-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors">
            <ListChecks size={16} /> {busy ? 'Working…' : list ? 'Regenerate' : 'Generate shopping list'}
          </button>
        </div>
      </div>

      {!list && (
        <div className="bg-white border border-stone-200 rounded-2xl p-8 text-center text-stone-500">
          No shopping list for this week yet.<br />
          <span className="text-sm">Generate one from this week&apos;s meal plan.</span>
        </div>
      )}

      {list && SHOP_CATEGORIES.map(cat => {
        const rows = items.filter(i => i.category === cat)
          .sort((a, b) => Number(a.already_have) - Number(b.already_have))
        if (rows.length === 0) return null
        return (
          <section key={cat} className="mb-5">
            <h2 className="text-sm font-semibold text-stone-500 mb-2">{CAT_LABEL[cat]}</h2>
            <div className="bg-white border border-stone-200 rounded-2xl divide-y divide-stone-100">
              {rows.map(item => <ItemRow key={item.id} item={item} onPatch={patchItem} onDelete={deleteItem} />)}
            </div>
          </section>
        )
      })}

      {list && <AddItem onAdd={addItem} />}

      {dishRows.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-stone-500 mb-1">Dishes this week</h2>
          <p className="text-xs text-stone-400 mb-2">These dishes have no ingredients yet — add what to buy manually above.</p>
          <div className="bg-white border border-stone-200 rounded-2xl divide-y divide-stone-100">
            {dishRows.map(item => (
              <div key={item.id} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-stone-700">{item.ingredient}</span>
                <button onClick={() => deleteItem(item.id)} className="text-stone-300 hover:text-stone-600" aria-label="Delete"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function ItemRow({ item, onPatch, onDelete }: {
  item: MealShoppingItem
  onPatch: (id: string, f: Partial<MealShoppingItem>) => void
  onDelete: (id: string) => void
}) {
  const [name, setName] = useState(item.ingredient)
  const [qty, setQty] = useState(item.quantity ?? '')
  const dishes = (item.from_dishes ?? []).map(f => f.dish).filter(Boolean)
  return (
    <div className={`flex items-center gap-2.5 px-4 py-2.5 ${item.already_have ? 'opacity-50' : ''}`}>
      <button onClick={() => onPatch(item.id, { checked: !item.checked })} aria-label="Bought"
        className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${
          item.checked ? 'border-green-400 bg-green-400' : 'border-stone-300 hover:border-stone-400'}`}>
        {item.checked && <span className="text-white text-xs">✓</span>}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <input value={name} onChange={e => setName(e.target.value)}
            onBlur={() => name.trim() && name !== item.ingredient && onPatch(item.id, { ingredient: name.trim() })}
            className={`bg-transparent focus:outline-none focus:bg-stone-50 rounded px-1 ${item.checked ? 'line-through text-stone-400' : 'text-stone-800'}`} />
          <input value={qty} onChange={e => setQty(e.target.value)} placeholder="qty"
            onBlur={() => (qty.trim() || null) !== item.quantity && onPatch(item.id, { quantity: qty.trim() || null })}
            className="bg-transparent focus:outline-none focus:bg-stone-50 rounded px-1 text-sm text-stone-500 w-24" />
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${CAT_BADGE[item.category]}`}>{CAT_LABEL[item.category]}</span>
        </div>
        {dishes.length > 0 && <div className="text-[11px] text-stone-400 mt-0.5 truncate">for: {dishes.join(', ')}</div>}
      </div>
      <button onClick={() => onPatch(item.id, { already_have: !item.already_have })}
        className={`text-xs px-2 py-1 rounded-lg whitespace-nowrap ${item.already_have ? 'text-green-600 bg-green-50' : 'text-stone-400 hover:text-stone-700'}`}>
        Already have ✓
      </button>
      <button onClick={() => onDelete(item.id)} className="text-stone-300 hover:text-stone-600" aria-label="Delete"><Trash2 size={15} /></button>
    </div>
  )
}

function AddItem({ onAdd }: { onAdd: (ingredient: string, quantity: string, category: ShopCategory) => void }) {
  const [name, setName] = useState('')
  const [qty, setQty] = useState('')
  const [cat, setCat] = useState<ShopCategory>('other')
  function submit() { if (name.trim()) { onAdd(name.trim(), qty.trim(), cat); setName(''); setQty('') } }
  return (
    <div className="flex items-center gap-2 flex-wrap bg-white border border-stone-200 rounded-2xl px-3 py-2 mt-2">
      <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()}
        placeholder="Add an item…" className="flex-1 min-w-[8rem] bg-transparent focus:outline-none text-sm text-stone-800 px-1" />
      <input value={qty} onChange={e => setQty(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()}
        placeholder="qty" className="w-20 bg-transparent focus:outline-none text-sm text-stone-500 px-1" />
      <select value={cat} onChange={e => setCat(e.target.value as ShopCategory)} className="text-sm text-stone-600 bg-transparent focus:outline-none">
        {SHOP_CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
      </select>
      <button onClick={submit} className="flex items-center gap-1 text-sm text-orange-600 hover:text-orange-700"><Plus size={15} /> Add</button>
    </div>
  )
}
