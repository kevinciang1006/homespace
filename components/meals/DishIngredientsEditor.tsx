'use client'
import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { INGREDIENT_CATEGORIES, type Ingredient, type DishIngredientDetail, type IngredientCategory } from '@/lib/meals/types'
import { INGREDIENT_UNITS } from '@/lib/meals/qty'

const CAT_LABELS: Record<IngredientCategory, string> = {
  protein: 'Protein', veg: 'Veg', bumbu: 'Bumbu', pantry: 'Pantry', other: 'Other',
}

// Normalized replacement for the old free-text ingredients textbox: reads/writes
// dish_ingredients (joined to the canonical ingredients table) instead of the
// dishes.ingredients jsonb column. Searchable add (existing ingredient or
// create-new-inline), inline amount/unit edit, remove.
export default function DishIngredientsEditor({ dishId }: { dishId: string }) {
  const [links, setLinks] = useState<DishIngredientDetail[] | null>(null) // null = still loading
  const [catalog, setCatalog] = useState<Ingredient[]>([])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch(`/api/meals/dishes/${dishId}/ingredients`).then(r => r.json()),
      fetch('/api/meals/ingredients').then(r => r.json()),
    ]).then(([dishLinks, ingredients]) => {
      if (cancelled) return
      setLinks(dishLinks as DishIngredientDetail[])
      setCatalog(ingredients as Ingredient[])
    })
    return () => { cancelled = true }
  }, [dishId])

  function patchLink(linkId: string, fields: { amount?: number | null; unit?: string | null }) {
    const prev = links
    setLinks(ls => ls?.map(l => l.id === linkId ? { ...l, ...fields } : l) ?? ls) // optimistic
    fetch(`/api/meals/dishes/${dishId}/ingredients/${linkId}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fields),
    }).then(res => { if (!res.ok) setLinks(prev) })
  }

  async function removeLink(linkId: string) {
    const prev = links
    setLinks(ls => ls?.filter(l => l.id !== linkId) ?? ls) // optimistic
    const res = await fetch(`/api/meals/dishes/${dishId}/ingredients/${linkId}`, { method: 'DELETE' })
    if (!res.ok) setLinks(prev)
  }

  async function addLink(ingredientId: string, amount: number | null, unit: string | null) {
    const res = await fetch(`/api/meals/dishes/${dishId}/ingredients`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ingredient_id: ingredientId, amount, unit }),
    })
    if (res.ok) {
      const row = await res.json() as DishIngredientDetail
      setLinks(ls => [...(ls ?? []), row])
    }
  }

  async function createAndAdd(
    name: string, category: IngredientCategory, defaultUnit: string, shelfStable: boolean,
    amount: number | null, unit: string | null,
  ) {
    const res = await fetch('/api/meals/ingredients', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, category, default_unit: defaultUnit || null, shelf_stable: shelfStable }),
    })
    if (!res.ok) return
    const ingredient = await res.json() as Ingredient
    setCatalog(c => [...c, ingredient])
    await addLink(ingredient.id, amount, unit)
  }

  const linkedIds = useMemo(() => new Set((links ?? []).map(l => l.ingredient_id)), [links])

  return (
    <section>
      <h3 className="text-sm font-medium text-stone-600 mb-2">Ingredients</h3>
      {links === null && <p className="text-sm text-stone-400">Loading…</p>}
      {links !== null && links.length === 0 && <p className="text-sm text-stone-400 mb-2">No ingredients yet.</p>}
      {links !== null && links.length > 0 && (
        <div className="space-y-1.5 mb-2">
          {links.map(l => <IngredientLinkRow key={l.id} link={l} onPatch={patchLink} onRemove={removeLink} />)}
        </div>
      )}
      {links !== null && (
        <AddIngredientRow catalog={catalog} excludeIds={linkedIds} onAddExisting={addLink} onCreateNew={createAndAdd} />
      )}
    </section>
  )
}

function IngredientLinkRow({ link, onPatch, onRemove }: {
  link: DishIngredientDetail
  onPatch: (linkId: string, f: { amount?: number | null; unit?: string | null }) => void
  onRemove: (linkId: string) => void
}) {
  const [amount, setAmount] = useState(link.amount ?? '')
  const shelfStable = link.ingredients?.shelf_stable ?? false

  function saveAmount() {
    const n = amount === '' ? null : Number(amount)
    if (n !== link.amount) onPatch(link.id, { amount: n === null || Number.isNaN(n) ? null : n })
  }

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 min-w-0 flex items-center gap-1.5">
        <span className="text-sm text-stone-700 truncate">{link.ingredients?.name ?? 'Unknown ingredient'}</span>
        {shelfStable && (
          <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700"
            title="Pantry staple — always excluded from the shopping list">pantry</span>
        )}
      </div>
      <input type="number" step="any" value={amount} onChange={e => setAmount(e.target.value)} onBlur={saveAmount}
        placeholder="amt"
        className="w-16 px-2 py-1.5 rounded-lg border border-stone-200 text-sm text-stone-800 focus:outline-none focus:border-orange-300" />
      <select value={link.unit ?? ''} onChange={e => onPatch(link.id, { unit: e.target.value || null })}
        className="px-2 py-1.5 rounded-lg border border-stone-200 text-sm text-stone-800 focus:outline-none focus:border-orange-300">
        <option value="">—</option>
        {INGREDIENT_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
        {/* legacy free-text unit from before the dropdown existed — keep it selectable/visible rather than silently blanking it */}
        {link.unit && !(INGREDIENT_UNITS as readonly string[]).includes(link.unit) && <option value={link.unit}>{link.unit}</option>}
      </select>
      <button onClick={() => onRemove(link.id)} className="p-1 text-stone-300 hover:text-red-500 shrink-0" aria-label="Remove ingredient">
        <Trash2 size={15} />
      </button>
    </div>
  )
}

function AddIngredientRow({ catalog, excludeIds, onAddExisting, onCreateNew }: {
  catalog: Ingredient[]
  excludeIds: Set<string>
  onAddExisting: (ingredientId: string, amount: number | null, unit: string | null) => void
  onCreateNew: (name: string, category: IngredientCategory, defaultUnit: string, shelfStable: boolean, amount: number | null, unit: string | null) => void
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Ingredient | null>(null)
  const [creating, setCreating] = useState(false)
  const [newCategory, setNewCategory] = useState<IngredientCategory>('other')
  const [newUnit, setNewUnit] = useState('')
  const [newShelfStable, setNewShelfStable] = useState(false)
  const [amount, setAmount] = useState('')
  const [unit, setUnit] = useState('') // pre-filled from the ingredient's default_unit on selection

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || selected || creating) return []
    return catalog.filter(i => !excludeIds.has(i.id) &&
      (i.name.toLowerCase().includes(q) || (i.aliases ?? []).some(a => a.toLowerCase().includes(q)))).slice(0, 8)
  }, [query, selected, creating, catalog, excludeIds])

  function reset() {
    setQuery(''); setSelected(null); setCreating(false)
    setNewCategory('other'); setNewUnit(''); setNewShelfStable(false)
    setAmount(''); setUnit('')
  }

  function submit() {
    const amt = amount.trim() === '' ? null : Number(amount)
    const parsedAmount = amt === null || Number.isNaN(amt) ? null : amt
    const u = unit.trim() || null
    if (creating) {
      if (!query.trim()) return
      onCreateNew(query.trim(), newCategory, newUnit.trim(), newShelfStable, parsedAmount, u)
    } else if (selected) {
      onAddExisting(selected.id, parsedAmount, u)
    } else return
    reset()
  }

  return (
    <div className="bg-stone-50 border border-stone-200 rounded-xl p-2.5 space-y-2">
      <div className="relative">
        <input value={query}
          onChange={e => { setQuery(e.target.value); setSelected(null); setCreating(false) }}
          placeholder="Search ingredients…"
          className="w-full px-2.5 py-1.5 rounded-lg border border-stone-200 text-sm text-stone-800 focus:outline-none focus:border-orange-300" />
        {matches.length > 0 && (
          <div className="absolute z-10 mt-1 w-full bg-white border border-stone-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
            {matches.map(m => (
              <button key={m.id} onClick={() => { setSelected(m); setQuery(m.name); setUnit(m.default_unit ?? '') }}
                className="w-full text-left px-2.5 py-1.5 text-sm hover:bg-orange-50 flex items-center justify-between gap-2">
                <span className="truncate">{m.name}</span>
                {m.shelf_stable && <span className="text-[10px] text-amber-600 shrink-0">pantry</span>}
              </button>
            ))}
            <button onClick={() => { setCreating(true) }}
              className="w-full text-left px-2.5 py-1.5 text-sm text-orange-600 hover:bg-orange-50 border-t border-stone-100">
              <Plus size={13} className="inline -mt-0.5 mr-1" /> Create &quot;{query.trim()}&quot; as new ingredient
            </button>
          </div>
        )}
        {query.trim() && matches.length === 0 && !selected && !creating && (
          <div className="absolute z-10 mt-1 w-full bg-white border border-stone-200 rounded-lg shadow-lg">
            <button onClick={() => setCreating(true)}
              className="w-full text-left px-2.5 py-1.5 text-sm text-orange-600 hover:bg-orange-50">
              <Plus size={13} className="inline -mt-0.5 mr-1" /> Create &quot;{query.trim()}&quot; as new ingredient
            </button>
          </div>
        )}
      </div>

      {creating && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <select value={newCategory} onChange={e => setNewCategory(e.target.value as IngredientCategory)}
            className="px-2 py-1.5 rounded-lg border border-stone-200 text-sm text-stone-800 focus:outline-none">
            {INGREDIENT_CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABELS[c]}</option>)}
          </select>
          <select value={newUnit} onChange={e => setNewUnit(e.target.value)}
            className="px-2 py-1.5 rounded-lg border border-stone-200 text-sm text-stone-800 focus:outline-none">
            <option value="">default unit —</option>
            {INGREDIENT_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-sm text-stone-600">
            <input type="checkbox" checked={newShelfStable} onChange={e => setNewShelfStable(e.target.checked)} />
            Pantry (shelf-stable)
          </label>
        </div>
      )}

      {(selected || creating) && (
        <div className="flex items-center gap-1.5">
          <input type="number" step="any" value={amount} onChange={e => setAmount(e.target.value)} placeholder="amount"
            className="w-20 px-2 py-1.5 rounded-lg border border-stone-200 text-sm text-stone-800 focus:outline-none focus:border-orange-300" />
          <select value={unit} onChange={e => setUnit(e.target.value)}
            className="px-2 py-1.5 rounded-lg border border-stone-200 text-sm text-stone-800 focus:outline-none">
            <option value="">—</option>
            {INGREDIENT_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
          <button onClick={submit} className="flex items-center gap-1 text-sm text-white bg-orange-600 hover:bg-orange-700 px-3 py-1.5 rounded-lg">
            <Plus size={14} /> {creating ? 'Create & add' : 'Add'}
          </button>
          <button onClick={reset} className="text-sm text-stone-400 hover:text-stone-700">Cancel</button>
        </div>
      )}
    </div>
  )
}
