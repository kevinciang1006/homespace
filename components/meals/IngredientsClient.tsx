'use client'
import { useMemo, useState } from 'react'
import { Plus, Trash2, Merge } from 'lucide-react'
import { INGREDIENT_CATEGORIES, type Ingredient, type IngredientCategory } from '@/lib/meals/types'

const CAT_LABELS: Record<IngredientCategory, string> = {
  protein: 'Protein', veg: 'Veg', bumbu: 'Bumbu', pantry: 'Pantry', other: 'Other',
}

export default function IngredientsClient({ initialIngredients }: { initialIngredients: Ingredient[] }) {
  const [ingredients, setIngredients] = useState<Ingredient[]>(initialIngredients)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [keepId, setKeepId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function patch(id: string, fields: Partial<Ingredient>) {
    const prev = ingredients.find(i => i.id === id)
    setIngredients(is => is.map(i => i.id === id ? { ...i, ...fields } : i)) // optimistic
    fetch(`/api/meals/ingredients/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fields),
    }).then(res => { if (!res.ok && prev) setIngredients(is => is.map(i => i.id === id ? prev : i)) })
  }

  async function addIngredient() {
    const res = await fetch('/api/meals/ingredients', { method: 'POST' })
    if (res.ok) { const row = await res.json() as Ingredient; setIngredients(is => [...is, row]) }
  }

  async function deleteIngredient(id: string, name: string) {
    if (!window.confirm(`Delete "${name}"? Any dishes using it will lose that shopping-list link.`)) return
    const prev = ingredients
    setIngredients(is => is.filter(i => i.id !== id)) // optimistic
    toggleSelect(id, false)
    const res = await fetch(`/api/meals/ingredients/${id}`, { method: 'DELETE' })
    if (!res.ok) setIngredients(prev) // rollback
  }

  function toggleSelect(id: string, on: boolean) {
    setSelected(s => {
      const next = new Set(s)
      if (on) next.add(id); else next.delete(id)
      return next
    })
    setKeepId(null)
  }

  const selectedIngredients = [...selected]
    .map(id => ingredients.find(i => i.id === id))
    .filter((i): i is Ingredient => !!i)

  async function mergeSelected() {
    if (selectedIngredients.length !== 2 || !keepId) return
    const mergeId = selectedIngredients.find(i => i.id !== keepId)!.id
    setBusy(true)
    try {
      const res = await fetch('/api/meals/ingredients/merge', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ keepId, mergeId }),
      })
      if (res.ok) {
        const updated = await res.json() as Ingredient
        setIngredients(is => is.filter(i => i.id !== mergeId).map(i => i.id === keepId ? updated : i))
        setSelected(new Set()); setKeepId(null)
      }
    } finally { setBusy(false) }
  }

  const filtered = useMemo(() => ingredients.filter(i =>
    i.name.toLowerCase().includes(search.toLowerCase()) ||
    (i.aliases ?? []).some(a => a.toLowerCase().includes(search.toLowerCase()))), [ingredients, search])

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search ingredients or aliases…"
          className="px-3 py-1.5 rounded-lg border border-stone-200 text-sm text-stone-800 focus:outline-none focus:border-orange-300" />
        <button onClick={addIngredient}
          className="ml-auto flex items-center gap-1 text-sm text-orange-600 hover:text-orange-700"><Plus size={15} /> Add ingredient</button>
      </div>

      {selectedIngredients.length === 2 && (
        <div className="sticky top-2 z-10 mb-4 flex items-center gap-3 flex-wrap bg-orange-50 border border-orange-200 rounded-2xl px-4 py-3">
          <Merge size={16} className="text-orange-600 shrink-0" />
          <span className="text-sm text-stone-700">Merge into:</span>
          {selectedIngredients.map(i => (
            <label key={i.id} className="flex items-center gap-1.5 text-sm text-stone-700">
              <input type="radio" name="keep" checked={keepId === i.id} onChange={() => setKeepId(i.id)} />
              {i.name}
            </label>
          ))}
          <button onClick={mergeSelected} disabled={!keepId || busy}
            className="ml-auto bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white text-sm font-medium px-3 py-1.5 rounded-lg transition-colors">
            {busy ? 'Merging…' : 'Merge'}
          </button>
          <button onClick={() => { setSelected(new Set()); setKeepId(null) }} className="text-sm text-stone-400 hover:text-stone-700">Cancel</button>
        </div>
      )}

      {INGREDIENT_CATEGORIES.map(cat => {
        const rows = filtered.filter(i => (i.category ?? 'other') === cat)
        if (rows.length === 0) return null
        return (
          <section key={cat} className="mb-8">
            <h2 className="text-lg text-stone-800 mb-2" style={{ fontFamily: 'DM Serif Display, serif' }}>{CAT_LABELS[cat]}</h2>
            <div className="bg-white border border-stone-200 rounded-2xl overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="text-left text-xs text-stone-400 border-b border-stone-100">
                    <th className="px-3 py-2 font-medium w-8" />
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Aliases</th>
                    <th className="px-3 py-2 font-medium">Category</th>
                    <th className="px-3 py-2 font-medium">Default unit</th>
                    <th className="px-3 py-2 font-medium">Shelf-stable</th>
                    <th className="px-3 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(i => (
                    <IngredientRow key={i.id} ingredient={i} onPatch={patch} onDelete={deleteIngredient}
                      selected={selected.has(i.id)} onToggleSelect={on => toggleSelect(i.id, on)} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}
    </div>
  )
}

function IngredientRow({ ingredient, onPatch, onDelete, selected, onToggleSelect }: {
  ingredient: Ingredient
  onPatch: (id: string, f: Partial<Ingredient>) => void
  onDelete: (id: string, name: string) => void
  selected: boolean
  onToggleSelect: (on: boolean) => void
}) {
  const [name, setName] = useState(ingredient.name)
  const [aliases, setAliases] = useState((ingredient.aliases ?? []).join(', '))
  const [unit, setUnit] = useState(ingredient.default_unit ?? '')

  function saveAliases() {
    const next = aliases.split(',').map(a => a.trim()).filter(Boolean)
    onPatch(ingredient.id, { aliases: next })
  }

  return (
    <tr className="border-b border-stone-50 last:border-0">
      <td className="px-3 py-1.5">
        <input type="checkbox" checked={selected} onChange={e => onToggleSelect(e.target.checked)}
          aria-label={`Select ${ingredient.name} for merge`} />
      </td>
      <td className="px-3 py-1.5">
        <input value={name} onChange={e => setName(e.target.value)}
          onBlur={() => name.trim() && name !== ingredient.name && onPatch(ingredient.id, { name: name.trim() })}
          className="w-full min-w-[9rem] bg-transparent text-stone-800 focus:outline-none focus:bg-stone-50 rounded px-1 py-0.5" />
      </td>
      <td className="px-3 py-1.5">
        <input value={aliases} onChange={e => setAliases(e.target.value)} onBlur={saveAliases}
          placeholder="comma, separated, aliases"
          className="w-full min-w-[12rem] bg-transparent text-stone-500 focus:outline-none focus:bg-stone-50 rounded px-1 py-0.5" />
      </td>
      <td className="px-3 py-1.5">
        <select value={ingredient.category ?? 'other'}
          onChange={e => onPatch(ingredient.id, { category: e.target.value as Ingredient['category'] })}
          className="bg-transparent text-stone-600 focus:outline-none">
          {INGREDIENT_CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABELS[c]}</option>)}
        </select>
      </td>
      <td className="px-3 py-1.5">
        <input value={unit} onChange={e => setUnit(e.target.value)}
          onBlur={() => { const v = unit.trim() || null; if (v !== ingredient.default_unit) onPatch(ingredient.id, { default_unit: v }) }}
          placeholder="g, pcs…"
          className="w-20 px-1.5 py-1 rounded-lg border border-stone-200 text-stone-600 focus:outline-none focus:border-orange-300" />
      </td>
      <td className="px-3 py-1.5">
        <button onClick={() => onPatch(ingredient.id, { shelf_stable: !ingredient.shelf_stable })} aria-label="Toggle shelf-stable"
          className={`w-9 h-5 rounded-full transition-colors relative ${ingredient.shelf_stable ? 'bg-orange-500' : 'bg-stone-200'}`}>
          <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${ingredient.shelf_stable ? 'left-4' : 'left-0.5'}`} />
        </button>
      </td>
      <td className="px-3 py-1.5">
        <button onClick={() => onDelete(ingredient.id, ingredient.name)} aria-label={`Delete ${ingredient.name}`}
          className="p-1 text-stone-300 hover:text-red-500">
          <Trash2 size={14} />
        </button>
      </td>
    </tr>
  )
}
