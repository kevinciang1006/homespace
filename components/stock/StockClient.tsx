'use client'
import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { INGREDIENT_CATEGORIES, type Ingredient, type IngredientCategory } from '@/lib/meals/types'
import { INGREDIENT_UNITS } from '@/lib/meals/qty'
import { STOCK_LOCATIONS, type StockItem, type StockLocation } from '@/lib/stock/types'
import UndoSnackbar from '@/components/UndoSnackbar'

const CAT_LABELS: Record<IngredientCategory, string> = {
  protein: 'Protein', veg: 'Veg', bumbu: 'Bumbu', pantry: 'Pantry', other: 'Other',
}
const LOCATION_META: Record<StockLocation, { emoji: string; label: string }> = {
  freezer: { emoji: '🧊', label: 'Freezer' },
  fridge: { emoji: '❄️', label: 'Fridge' },
  pantry: { emoji: '🫙', label: 'Pantry' },
}

// Tolerant number parsing for the amount/threshold fields: a comma decimal
// separator ("1,5") is normal Indonesian-locale input on a phone keyboard,
// but `Number("1,5")` is NaN — that was silently failing the add form's
// submit guard with no feedback (looked exactly like "press Enter, nothing
// happens"). Returns null for anything that still isn't a valid number.
function parseQty(raw: string): number | null {
  const cleaned = raw.trim().replace(',', '.')
  if (cleaned === '') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

// Layer 1: manual stock entry only (see AGENTS request) — input, view, edit,
// delete. No reservation/auto-deplete, no shopping integration. One always-
// visible add form per location (no modal) so first-time bulk entry from a
// phone at the fridge is just search -> amount -> Enter -> next, over and
// over, with zero open/close overhead.
export default function StockClient({ initialStock, initialIngredients }: {
  initialStock: StockItem[]
  initialIngredients: Ingredient[]
}) {
  const [stock, setStock] = useState<StockItem[]>(initialStock)
  const [catalog, setCatalog] = useState<Ingredient[]>(initialIngredients)
  const [location, setLocation] = useState<StockLocation>('freezer')
  // Soft delete: hidden from view immediately, real DELETE deferred to
  // UndoSnackbar's own timer — same pattern as ShoppingListClient.
  const [pendingDelete, setPendingDelete] = useState<{ item: StockItem } | null>(null)

  const countsByLocation = useMemo(() => {
    const counts: Record<StockLocation, number> = { freezer: 0, fridge: 0, pantry: 0 }
    for (const s of stock) if (s.id !== pendingDelete?.item.id) counts[s.location]++
    return counts
  }, [stock, pendingDelete])

  const itemsForLocation = useMemo(
    () => stock.filter(s => s.location === location && s.id !== pendingDelete?.item.id),
    [stock, location, pendingDelete],
  )
  // Ingredients already tracked in THIS location are excluded from the add
  // form's search — re-adding one would collide with stock's unique
  // (ingredient_id, location) constraint; editing the existing row is the
  // right move instead, which the list right below already offers.
  const excludeIds = useMemo(
    () => new Set(stock.filter(s => s.location === location).map(s => s.ingredient_id)),
    [stock, location],
  )

  // Both throw on failure now (instead of silently doing nothing) so
  // AddStockRow's submit() can show her what actually went wrong.
  async function addExisting(ingredientId: string, amount: number, unit: string | null, threshold: number | null) {
    const res = await fetch('/api/stock', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ingredient_id: ingredientId, location, on_hand: amount, unit, low_threshold: threshold }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || 'Could not add that item — try again')
    }
    const row = await res.json()
    setStock(s => [...s, row as StockItem])
  }
  // Creating a new ingredient no longer takes a separate "default unit" —
  // whatever unit she picks for THIS entry (the one field, right next to
  // amount) is saved as the ingredient's default_unit too, so a future pick
  // of the same ingredient still prefills correctly. Asking for the unit
  // twice in one breath was pure friction, not a real second decision.
  async function createAndAdd(
    name: string, category: IngredientCategory, shelfStable: boolean,
    amount: number, unit: string | null, threshold: number | null,
  ) {
    const res = await fetch('/api/meals/ingredients', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, category, default_unit: unit, shelf_stable: shelfStable }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || 'Could not create that ingredient — try again')
    }
    const ingredient = await res.json() as Ingredient
    setCatalog(c => [...c, ingredient])
    await addExisting(ingredient.id, amount, unit, threshold)
  }
  // Fixes the "can't edit the grouping after adding" complaint — category
  // lives on the shared ingredients row, not the stock row, so this updates
  // every stock row (any location) pointing at that ingredient, plus the
  // search catalog, so the item immediately re-groups under its new category.
  function patchIngredientCategory(ingredientId: string, category: IngredientCategory) {
    const prevStock = stock
    const prevCatalog = catalog
    setStock(s => s.map(it => it.ingredient_id === ingredientId && it.ingredients
      ? { ...it, ingredients: { ...it.ingredients, category } } : it))
    setCatalog(c => c.map(i => i.id === ingredientId ? { ...i, category } : i))
    fetch(`/api/meals/ingredients/${ingredientId}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ category }),
    }).then(res => { if (!res.ok) { setStock(prevStock); setCatalog(prevCatalog) } })
  }
  function patchItem(id: string, fields: Partial<Pick<StockItem, 'on_hand' | 'unit' | 'low_threshold'>>) {
    const prev = stock.find(s => s.id === id)
    setStock(s => s.map(it => it.id === id ? { ...it, ...fields } : it)) // optimistic
    fetch(`/api/stock/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fields),
    }).then(async res => {
      if (res.ok) { const row = await res.json(); setStock(s => s.map(it => it.id === id ? row : it)) }
      else if (prev) setStock(s => s.map(it => it.id === id ? prev : it))
    })
  }
  function finalizePendingDelete() {
    setPendingDelete(prev => {
      if (prev) fetch(`/api/stock/${prev.item.id}`, { method: 'DELETE' })
      return null
    })
  }
  function requestDelete(item: StockItem) {
    finalizePendingDelete()
    setStock(s => s.filter(it => it.id !== item.id))
    setPendingDelete({ item })
  }
  function undoDelete() {
    setPendingDelete(prev => {
      if (prev) setStock(s => [...s, prev.item])
      return null
    })
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="bg-white border-b border-stone-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link href="/" className="text-stone-400 hover:text-stone-600 transition-colors">
            <ArrowLeft size={18} />
          </Link>
          <h1 className="text-xl font-semibold text-stone-900" style={{ fontFamily: 'DM Serif Display, serif' }}>
            Stock
          </h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6 pb-16 space-y-4">
        <div className="grid grid-cols-3 gap-2">
          {STOCK_LOCATIONS.map(loc => {
            const meta = LOCATION_META[loc]
            const active = loc === location
            return (
              <button key={loc} onClick={() => setLocation(loc)}
                className={`flex flex-col items-center gap-1 rounded-2xl py-3 text-sm font-medium transition-colors ${
                  active ? 'bg-orange-600 text-white' : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-100'}`}>
                <span className="text-xl">{meta.emoji}</span>
                {meta.label}
                <span className={`text-[11px] font-normal ${active ? 'text-orange-100' : 'text-stone-400'}`}>
                  {countsByLocation[loc]} item{countsByLocation[loc] === 1 ? '' : 's'}
                </span>
              </button>
            )
          })}
        </div>

        <AddStockRow
          location={location}
          catalog={catalog}
          excludeIds={excludeIds}
          onAddExisting={addExisting}
          onCreateAndAdd={createAndAdd}
        />

        <LocationSection items={itemsForLocation} onPatch={patchItem} onDelete={requestDelete} onEditCategory={patchIngredientCategory} />
      </main>

      {pendingDelete && (
        <UndoSnackbar
          message={`Removed ${pendingDelete.item.ingredients?.name ?? 'item'}`}
          onUndo={undoDelete}
          onExpire={finalizePendingDelete}
        />
      )}
    </div>
  )
}

function LocationSection({ items, onPatch, onDelete, onEditCategory }: {
  items: StockItem[]
  onPatch: (id: string, fields: Partial<Pick<StockItem, 'on_hand' | 'unit' | 'low_threshold'>>) => void
  onDelete: (item: StockItem) => void
  onEditCategory: (ingredientId: string, category: IngredientCategory) => void
}) {
  const grouped = useMemo(() => {
    const byCategory = new Map<IngredientCategory, StockItem[]>()
    for (const item of items) {
      const cat = item.ingredients?.category ?? 'other'
      if (!byCategory.has(cat)) byCategory.set(cat, [])
      byCategory.get(cat)!.push(item)
    }
    for (const list of byCategory.values()) {
      list.sort((a, b) => (a.ingredients?.name ?? '').localeCompare(b.ingredients?.name ?? ''))
    }
    return INGREDIENT_CATEGORIES.filter(c => byCategory.has(c)).map(c => ({ category: c, items: byCategory.get(c)! }))
  }, [items])

  if (items.length === 0) {
    return <p className="text-sm text-stone-400 text-center py-6">No items yet — add the first one above.</p>
  }

  return (
    <div className="space-y-4">
      {grouped.map(g => (
        <div key={g.category}>
          <div className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-1.5 px-0.5">
            {CAT_LABELS[g.category]}
          </div>
          <div className="space-y-1.5">
            {g.items.map(item => (
              <StockRow key={item.id} item={item} onPatch={onPatch} onDelete={onDelete} onEditCategory={onEditCategory} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function StockRow({ item, onPatch, onDelete, onEditCategory }: {
  item: StockItem
  onPatch: (id: string, fields: Partial<Pick<StockItem, 'on_hand' | 'unit' | 'low_threshold'>>) => void
  onDelete: (item: StockItem) => void
  onEditCategory: (ingredientId: string, category: IngredientCategory) => void
}) {
  const [amount, setAmount] = useState(String(item.on_hand))
  const [editingThreshold, setEditingThreshold] = useState(false)
  const [threshold, setThreshold] = useState(item.low_threshold != null ? String(item.low_threshold) : '')
  const [editingCategory, setEditingCategory] = useState(false)
  const isLow = item.low_threshold != null && Number(item.on_hand) <= Number(item.low_threshold)

  // No effect syncing local state from `item` on every prop change (matching
  // DishIngredientsEditor's IngredientLinkRow) — the only writes to
  // item.on_hand/low_threshold come from this same row's own inputs below,
  // which already keep local state and the optimistic patch in lockstep.
  function saveAmount() {
    const n = parseQty(amount)
    if (n !== null && n !== Number(item.on_hand)) onPatch(item.id, { on_hand: n })
    else setAmount(String(item.on_hand))
  }
  function saveThreshold() {
    const n = parseQty(threshold)
    onPatch(item.id, { low_threshold: n })
    setEditingThreshold(false)
  }

  return (
    <div className={`flex items-center gap-2 bg-white border rounded-xl px-3 py-2 ${isLow ? 'border-red-200 bg-red-50/50' : 'border-stone-200'}`}>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-stone-800 truncate flex items-center gap-1.5">
          <span className="truncate">{item.ingredients?.name ?? 'Unknown ingredient'}</span>
          {isLow && <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-700">low</span>}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {editingCategory ? (
            <select autoFocus defaultValue={item.ingredients?.category ?? 'other'}
              onChange={e => { onEditCategory(item.ingredient_id, e.target.value as IngredientCategory); setEditingCategory(false) }}
              onBlur={() => setEditingCategory(false)}
              className="text-[11px] px-1 py-0.5 rounded border border-stone-200 text-stone-800 focus:outline-none">
              {INGREDIENT_CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABELS[c]}</option>)}
            </select>
          ) : (
            <button onClick={() => setEditingCategory(true)}
              className="text-[11px] text-stone-400 hover:text-stone-600 underline decoration-dotted"
              title="Move this ingredient to a different group">
              {CAT_LABELS[item.ingredients?.category ?? 'other']}
            </button>
          )}
          {editingThreshold ? (
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-stone-400 shrink-0">low at</span>
              <input autoFocus type="text" inputMode="decimal" value={threshold}
                onChange={e => setThreshold(e.target.value)} onBlur={saveThreshold}
                onKeyDown={e => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
                className="w-16 px-1.5 py-0.5 rounded border border-stone-200 text-[11px] text-stone-800 focus:outline-none focus:border-orange-300" />
              <span className="text-[11px] text-stone-400 shrink-0">{item.unit ?? ''}</span>
            </div>
          ) : (
            <button onClick={() => setEditingThreshold(true)} className="text-[11px] text-stone-400 hover:text-stone-600">
              {item.low_threshold != null ? `low at ${item.low_threshold}${item.unit ?? ''}` : '+ low threshold'}
            </button>
          )}
        </div>
      </div>
      <input type="text" inputMode="decimal" value={amount}
        onChange={e => setAmount(e.target.value)} onBlur={saveAmount}
        onKeyDown={e => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
        className="w-16 px-2 py-1.5 rounded-lg border border-stone-200 text-sm text-right text-stone-800 focus:outline-none focus:border-orange-300" />
      <select value={item.unit ?? ''} onChange={e => onPatch(item.id, { unit: e.target.value || null })}
        className="px-2 py-1.5 rounded-lg border border-stone-200 text-sm text-stone-800 focus:outline-none">
        <option value="">—</option>
        {INGREDIENT_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
        {item.unit && !(INGREDIENT_UNITS as readonly string[]).includes(item.unit) && <option value={item.unit}>{item.unit}</option>}
      </select>
      <button onClick={() => onDelete(item)} className="p-1.5 text-stone-300 hover:text-red-500 shrink-0" aria-label="Delete">
        <Trash2 size={16} />
      </button>
    </div>
  )
}

// Always visible (no modal) — the same component serves both "the occasional
// add" and the first-time bulk-entry sitting: search -> tap a match -> type
// amount -> Enter commits and immediately refocuses the search box for the
// next item. Mirrors DishIngredientsEditor's AddIngredientRow (search
// existing / create-new-inline), per the "same as dish editor" spec.
function AddStockRow({ location, catalog, excludeIds, onAddExisting, onCreateAndAdd }: {
  location: StockLocation
  catalog: Ingredient[]
  excludeIds: Set<string>
  onAddExisting: (ingredientId: string, amount: number, unit: string | null, threshold: number | null) => Promise<void>
  onCreateAndAdd: (
    name: string, category: IngredientCategory, shelfStable: boolean,
    amount: number, unit: string | null, threshold: number | null,
  ) => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Ingredient | null>(null)
  const [creating, setCreating] = useState(false)
  const [newCategory, setNewCategory] = useState<IngredientCategory>('other')
  const [newShelfStable, setNewShelfStable] = useState(false)
  const [amount, setAmount] = useState('')
  const [unit, setUnit] = useState('')
  const [threshold, setThreshold] = useState('')
  const [showThreshold, setShowThreshold] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const amountRef = useRef<HTMLInputElement>(null)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || selected || creating) return []
    return catalog.filter(i => !excludeIds.has(i.id) &&
      (i.name.toLowerCase().includes(q) || (i.aliases ?? []).some(a => a.toLowerCase().includes(q)))).slice(0, 8)
  }, [query, selected, creating, catalog, excludeIds])

  // Typical condiments/spices she hasn't tracked in this location yet — tap
  // instead of type. Only surfaced for Pantry, where "the whole spice rack"
  // bulk entry benefits most from not typing every name.
  const quickPicks = useMemo(() => {
    if (location !== 'pantry' || query.trim() || selected || creating) return []
    return catalog.filter(i => !excludeIds.has(i.id) && (i.category === 'bumbu' || i.category === 'pantry')).slice(0, 14)
  }, [location, query, selected, creating, catalog, excludeIds])

  function reset() {
    setQuery(''); setSelected(null); setCreating(false)
    setNewCategory('other'); setNewShelfStable(false)
    setAmount(''); setUnit(''); setThreshold(''); setShowThreshold(false)
    setError(null)
    requestAnimationFrame(() => searchRef.current?.focus())
  }
  function selectMatch(m: Ingredient) {
    setSelected(m); setQuery(m.name); setUnit(m.default_unit ?? ''); setError(null)
    requestAnimationFrame(() => amountRef.current?.focus())
  }
  // Every bail-out now sets a visible message instead of quietly doing
  // nothing — a bad amount (e.g. a comma decimal that failed to parse) used
  // to look exactly like "press Enter, nothing happens" with zero feedback.
  async function submit() {
    if (saving) return
    setError(null)
    const amt = parseQty(amount)
    if (amt === null || amt < 0) { setError('Enter a valid amount'); return }
    const u = unit.trim() || null
    const t = parseQty(threshold)
    setSaving(true)
    try {
      if (creating) {
        if (!query.trim()) { setError('Type a name for the new ingredient'); return }
        await onCreateAndAdd(query.trim(), newCategory, newShelfStable, amt, u, t)
      } else if (selected) {
        await onAddExisting(selected.id, amt, u, t)
      } else {
        setError('Search and pick an ingredient first')
        return
      }
      reset()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong — try again')
    } finally { setSaving(false) }
  }

  return (
    <div className="bg-white border border-stone-200 rounded-2xl p-3 space-y-2">
      <div className="relative">
        <input ref={searchRef} value={query}
          onChange={e => { setQuery(e.target.value); setSelected(null); setCreating(false) }}
          placeholder={`Search or add to ${LOCATION_META[location].label.toLowerCase()}…`}
          className="w-full px-3 py-2.5 rounded-xl border border-stone-200 text-base text-stone-800 focus:outline-none focus:border-orange-300" />
        {matches.length > 0 && (
          <div className="absolute z-10 mt-1 w-full bg-white border border-stone-200 rounded-xl shadow-lg max-h-56 overflow-y-auto">
            {matches.map(m => (
              <button key={m.id} onClick={() => selectMatch(m)}
                className="w-full text-left px-3 py-2.5 text-sm hover:bg-orange-50 flex items-center justify-between gap-2">
                <span className="truncate">{m.name}</span>
                <span className="text-[10px] text-stone-400 shrink-0">{CAT_LABELS[m.category ?? 'other']}</span>
              </button>
            ))}
            <button onClick={() => setCreating(true)}
              className="w-full text-left px-3 py-2.5 text-sm text-orange-600 hover:bg-orange-50 border-t border-stone-100">
              <Plus size={13} className="inline -mt-0.5 mr-1" /> Create &quot;{query.trim()}&quot;
            </button>
          </div>
        )}
        {query.trim() && matches.length === 0 && !selected && !creating && (
          <div className="absolute z-10 mt-1 w-full bg-white border border-stone-200 rounded-xl shadow-lg">
            <button onClick={() => setCreating(true)}
              className="w-full text-left px-3 py-2.5 text-sm text-orange-600 hover:bg-orange-50">
              <Plus size={13} className="inline -mt-0.5 mr-1" /> Create &quot;{query.trim()}&quot; as new ingredient
            </button>
          </div>
        )}
      </div>

      {quickPicks.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {quickPicks.map(ing => (
            <button key={ing.id} onClick={() => selectMatch(ing)}
              className="text-xs px-2.5 py-1.5 rounded-full bg-stone-100 hover:bg-orange-100 hover:text-orange-700 text-stone-600 transition-colors">
              {ing.name}
            </button>
          ))}
        </div>
      )}

      {creating && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <select value={newCategory} onChange={e => setNewCategory(e.target.value as IngredientCategory)}
            className="px-2 py-1.5 rounded-lg border border-stone-200 text-sm text-stone-800 focus:outline-none">
            {INGREDIENT_CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABELS[c]}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-sm text-stone-600">
            <input type="checkbox" checked={newShelfStable} onChange={e => setNewShelfStable(e.target.checked)} />
            Pantry (shelf-stable)
          </label>
        </div>
      )}

      {(selected || creating) && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <input ref={amountRef} type="text" inputMode="decimal" value={amount}
            onChange={e => { setAmount(e.target.value); setError(null) }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
            placeholder="amount"
            className="w-24 px-3 py-2.5 rounded-xl border border-stone-200 text-base text-stone-800 focus:outline-none focus:border-orange-300" />
          <select value={unit} onChange={e => setUnit(e.target.value)}
            className="px-3 py-2.5 rounded-xl border border-stone-200 text-base text-stone-800 focus:outline-none">
            <option value="">—</option>
            {INGREDIENT_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
          {showThreshold ? (
            <input type="text" inputMode="decimal" value={threshold} onChange={e => setThreshold(e.target.value)}
              placeholder="low at…"
              className="w-24 px-3 py-2.5 rounded-xl border border-stone-200 text-sm text-stone-800 focus:outline-none focus:border-orange-300" />
          ) : (
            <button onClick={() => setShowThreshold(true)}
              className="text-xs text-stone-400 hover:text-stone-600 underline decoration-dotted">+ low threshold</button>
          )}
          <button onClick={submit} disabled={saving}
            className="flex items-center gap-1 text-sm font-medium text-white bg-orange-600 hover:bg-orange-700 disabled:opacity-60 px-4 py-2.5 rounded-xl">
            <Plus size={15} /> {creating ? 'Create & add' : 'Add'}
          </button>
          <button onClick={reset} className="text-sm text-stone-400 hover:text-stone-700">Cancel</button>
        </div>
      )}
      {error && <p className="text-xs text-red-500 px-0.5">{error}</p>}
    </div>
  )
}
