'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, RefreshCw, Trash2, Plus, Check } from 'lucide-react'
import { SHOP_CATEGORIES, type ShopCategory } from '@/lib/meals/shopping'
import {
  classifyShoppingGroup, sectionOf, shoppingSubRank, SHOPPING_SECTION_ORDER, SHOPPING_SECTION_LABEL, type ShoppingSection,
} from '@/lib/meals/shoppingGroups'
import { currentMonday, shiftWeek, weekDates } from '@/lib/meals/dates'
import type { MealShoppingList, MealShoppingItem } from '@/lib/meals/types'
import UndoSnackbar from '@/components/UndoSnackbar'

const RAW_CATEGORY_LABEL: Record<ShopCategory, string> = {
  protein: 'Protein', vegetable: 'Vegetable', bumbu: 'Bumbu', pantry: 'Pantry', other: 'Other',
}

function label(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// Grouped the same way as the WhatsApp message (lib/meals/shoppingGroups) so
// the two stay consistent: Protein -> Sayur -> Bumbu -> Buah. Non-fruit
// "bought as-is" items with no real ingredient breakdown ("lainnya" — the
// item still exists and can be seen/edited via the API, just not surfaced
// here) are left off, same as the message — this page is a shopping list,
// not a catch-all.
export default function ShoppingListClient({ initialWeekStart, initialList, initialItems }: {
  initialWeekStart: string
  initialList: MealShoppingList | null
  initialItems: MealShoppingItem[]
}) {
  const router = useRouter()
  const [weekStart, setWeekStart] = useState(initialWeekStart)
  const [list, setList] = useState<MealShoppingList | null>(initialList)
  const [items, setItems] = useState<MealShoppingItem[]>(initialItems)
  const [busy, setBusy] = useState(false)
  // Swipe/click delete is a soft delete: hidden from view immediately, but
  // the real DELETE only fires once the undo window (UndoSnackbar's own
  // timer) expires without the user hitting Undo.
  const [pendingDelete, setPendingDelete] = useState<{ item: MealShoppingItem } | null>(null)
  const days = useMemo(() => weekDates(weekStart), [weekStart])

  // Auto-build on open: the list on screen is always current, no manual click
  // needed. Non-destructive (mergeShoppingItems keeps ✓/"already have"/manual
  // rows), so it's safe to run on every mount/week-change.
  async function refresh(ws: string) {
    setWeekStart(ws)
    router.replace(`/meals/shopping?week=${ws}`, { scroll: false })
    setBusy(true)
    try {
      const res = await fetch('/api/meals/shopping/generate', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ weekStart: ws }),
      })
      const { list, items } = await res.json()
      setList(list ?? null); setItems(items ?? [])
    } finally { setBusy(false) }
  }

  useEffect(() => {
    refresh(initialWeekStart)
    // Auto-build once on mount, using whichever week the page opened to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function patchItem(id: string, fields: Partial<MealShoppingItem>) {
    const prev = items.find(i => i.id === id)
    setItems(is => is.map(i => i.id === id ? { ...i, ...fields } : i)) // optimistic
    fetch(`/api/meals/shopping/items/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fields),
    }).then(res => { if (!res.ok && prev) setItems(is => is.map(i => i.id === id ? prev : i)) })
  }
  // Committing a delete is deferred to UndoSnackbar's onExpire below — only
  // one item's delete is "pending" at a time; requesting a new one commits
  // whatever was already pending first (no stacked undo windows).
  function finalizePendingDelete() {
    setPendingDelete(prev => {
      if (prev) fetch(`/api/meals/shopping/items/${prev.item.id}`, { method: 'DELETE' })
      return null
    })
  }
  function requestDelete(item: MealShoppingItem) {
    finalizePendingDelete()
    setItems(is => is.filter(i => i.id !== item.id))
    setPendingDelete({ item })
  }
  function undoDelete() {
    setPendingDelete(prev => {
      if (prev) setItems(is => [...is, prev.item])
      return null
    })
  }
  async function addItem(ingredient: string, quantity: string, category: ShopCategory) {
    if (!list || !ingredient.trim()) return
    const res = await fetch('/api/meals/shopping/items', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ list_id: list.id, ingredient, quantity, category }),
    })
    if (res.ok) { const row = await res.json(); setItems(is => [...is, row as MealShoppingItem]) }
  }

  const visibleItems = useMemo(
    () => items.filter(i => classifyShoppingGroup(i.ingredient, i.category) !== 'lainnya'),
    [items],
  )
  const buyable = visibleItems.filter(i => !i.already_have)
  const remaining = buyable.filter(i => !i.checked).length
  const sections = SHOPPING_SECTION_ORDER.filter((s): s is Exclude<ShoppingSection, 'lainnya'> => s !== 'lainnya')

  return (
    <div>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => refresh(shiftWeek(weekStart, -7))} className="p-2 rounded-lg hover:bg-stone-100 text-stone-600" aria-label="Previous week"><ChevronLeft size={18} /></button>
          <span className="text-sm font-medium text-stone-700 min-w-[9rem] text-center">{label(days[0])} – {label(days[6])}</span>
          <button onClick={() => refresh(shiftWeek(weekStart, 7))} className="p-2 rounded-lg hover:bg-stone-100 text-stone-600" aria-label="Next week"><ChevronRight size={18} /></button>
          <button onClick={() => refresh(currentMonday())} className="ml-1 text-sm text-stone-500 hover:text-stone-800 px-2 py-1">This week</button>
        </div>
        <div className="flex items-center gap-3">
          {list && <span className="text-sm text-stone-500">{remaining} of {buyable.length} to buy</span>}
          {/* Hidden on mobile — keep the list itself as simple as possible there. */}
          <button onClick={() => refresh(weekStart)} disabled={busy}
            className="hidden sm:flex items-center gap-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors">
            <RefreshCw size={16} className={busy ? 'animate-spin' : ''} /> {busy ? 'Working…' : 'Rebuild'}
          </button>
        </div>
      </div>

      {!list && !busy && (
        <div className="bg-white border border-stone-200 rounded-2xl p-8 text-center text-stone-500">
          No shopping list for this week yet.<br />
          <span className="text-sm">Add some dishes to the meal plan, then hit Rebuild.</span>
        </div>
      )}

      {list && sections.map(section => {
        const rows = visibleItems.filter(i => sectionOf(classifyShoppingGroup(i.ingredient, i.category)) === section)
          .sort((a, b) =>
            Number(a.already_have) - Number(b.already_have)
            || shoppingSubRank(section, a.ingredient) - shoppingSubRank(section, b.ingredient)
            || a.ingredient.localeCompare(b.ingredient))
        if (rows.length === 0) return null
        return (
          <section key={section} className="mb-5">
            <h2 className="text-sm font-semibold text-stone-500 mb-2">{SHOPPING_SECTION_LABEL[section]}</h2>
            <div className="bg-white border border-stone-200 rounded-2xl divide-y divide-stone-100">
              {rows.map(item => <ItemRow key={item.id} item={item} onCheck={patchItem} onDelete={requestDelete} />)}
            </div>
          </section>
        )
      })}

      {list && <AddItem onAdd={addItem} />}

      {pendingDelete && (
        <UndoSnackbar message={`Removed ${pendingDelete.item.ingredient}`} onUndo={undoDelete} onExpire={finalizePendingDelete} />
      )}
    </div>
  )
}

// Swipe left to delete on touch; a small trash icon covers the same action
// for a mouse (desktop has no swipe). Simplified per feedback: just the
// checkbox, name, and amount — no inline editing, no "already have" toggle,
// no "for: <dishes>" caption.
const SWIPE_REVEAL_PX = 88
const SWIPE_COMMIT_PX = 60

function ItemRow({ item, onCheck, onDelete }: {
  item: MealShoppingItem
  onCheck: (id: string, f: Partial<MealShoppingItem>) => void
  onDelete: (item: MealShoppingItem) => void
}) {
  const [dragX, setDragX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const startXRef = useRef(0)

  function onTouchStart(e: React.TouchEvent) {
    startXRef.current = e.touches[0].clientX
    setDragging(true)
  }
  function onTouchMove(e: React.TouchEvent) {
    const dx = e.touches[0].clientX - startXRef.current
    setDragX(Math.min(0, Math.max(dx, -SWIPE_REVEAL_PX)))
  }
  function onTouchEnd() {
    setDragging(false)
    if (dragX < -SWIPE_COMMIT_PX) onDelete(item)
    setDragX(0)
  }

  return (
    <div className="relative overflow-hidden">
      <div className="absolute inset-y-0 right-0 w-20 bg-red-500 flex items-center justify-center text-white">
        <Trash2 size={16} />
      </div>
      <div
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        style={{ transform: `translateX(${dragX}px)`, transition: dragging ? 'none' : 'transform 0.2s' }}
        className="relative bg-white flex items-center gap-3 px-4 py-3"
      >
        {item.already_have ? (
          <span className="w-5 h-5 rounded-full border-2 border-green-200 bg-green-50 shrink-0 flex items-center justify-center text-green-600" aria-hidden="true">
            <Check size={12} />
          </span>
        ) : (
          <button onClick={() => onCheck(item.id, { checked: !item.checked })} aria-label="Bought"
            className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${
              item.checked ? 'border-green-400 bg-green-400' : 'border-stone-300 hover:border-stone-400'}`}>
            {item.checked && <span className="text-white text-xs">✓</span>}
          </button>
        )}
        <span className={`flex-1 min-w-0 truncate text-sm ${item.already_have || item.checked ? 'text-stone-400' : 'text-stone-800'} ${item.checked && !item.already_have ? 'line-through' : ''}`}>
          {item.ingredient}
        </span>
        {item.already_have ? (
          <span className="shrink-0 text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full whitespace-nowrap"
            title="Covered by what's already in stock — not on this week's buy list">
            ✓ in stock
          </span>
        ) : (
          item.quantity && <span className="shrink-0 text-sm text-stone-500">{item.quantity}</span>
        )}
        <button onClick={() => onDelete(item)} className="hidden sm:inline-flex shrink-0 text-stone-300 hover:text-red-500" aria-label="Delete">
          <Trash2 size={14} />
        </button>
      </div>
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
        placeholder="qty" className="w-20 bg-transparent focus:outline-none text-sm text-stone-800 px-1" />
      <select value={cat} onChange={e => setCat(e.target.value as ShopCategory)} className="text-sm text-stone-800 bg-transparent focus:outline-none">
        {SHOP_CATEGORIES.map(c => <option key={c} value={c}>{RAW_CATEGORY_LABEL[c]}</option>)}
      </select>
      <button onClick={submit} className="flex items-center gap-1 text-sm text-orange-600 hover:text-orange-700"><Plus size={15} /> Add</button>
    </div>
  )
}
