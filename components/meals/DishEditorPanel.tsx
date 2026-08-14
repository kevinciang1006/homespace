'use client'
import { useState } from 'react'
import Link from 'next/link'
import { X, Plus, Trash2, ChevronUp, ChevronDown, ExternalLink } from 'lucide-react'
import { SHOP_CATEGORIES, type DishIngredient } from '@/lib/meals/shopping'
import type { Dish } from '@/lib/meals/types'
import DishThumb from './DishThumb'

// Slide-over editor for a dish's photo, ingredients, and recipe steps.
// Structural edits (add/remove/reorder/category) persist immediately; free-text
// fields persist on blur — matching the app's inline-edit convention.
export default function DishEditorPanel({ dish, onClose, onPatch }: {
  dish: Dish
  onClose: () => void
  onPatch: (id: string, fields: Partial<Dish>) => void
}) {
  const [imageUrl, setImageUrl] = useState(dish.recipe_image_url ?? '')
  const [ingredients, setIngredients] = useState<DishIngredient[]>(dish.ingredients ?? [])
  const [steps, setSteps] = useState<string[]>(dish.recipe_steps ?? [])

  function saveIngredients(next: DishIngredient[]) { setIngredients(next); onPatch(dish.id, { ingredients: next }) }
  function saveSteps(next: string[]) { setSteps(next); onPatch(dish.id, { recipe_steps: next }) }

  const addIng = () => saveIngredients([...ingredients, { name: '', quantity: '', category: 'other' }])
  const removeIng = (i: number) => saveIngredients(ingredients.filter((_, idx) => idx !== i))
  const setIngField = (i: number, patch: Partial<DishIngredient>) =>
    setIngredients(list => list.map((it, idx) => (idx === i ? { ...it, ...patch } : it)))

  const addStep = () => saveSteps([...steps, ''])
  const removeStep = (i: number) => saveSteps(steps.filter((_, idx) => idx !== i))
  const setStep = (i: number, val: string) => setSteps(list => list.map((s, idx) => (idx === i ? val : s)))
  const moveStep = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= steps.length) return
    const next = [...steps];[next[i], next[j]] = [next[j], next[i]]; saveSteps(next)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-stretch md:justify-end">
      <div className="absolute inset-0 bg-black/25" onClick={onClose} />
      <div className="relative bg-white w-full md:w-[30rem] md:h-full rounded-t-2xl md:rounded-none max-h-[92vh] md:max-h-full overflow-y-auto">
        {/* header */}
        <div className="sticky top-0 bg-white border-b border-stone-100 px-5 py-3 flex items-center justify-between z-10">
          <div className="min-w-0">
            <div className="text-xs text-stone-400">Recipe & ingredients</div>
            <div className="text-stone-800 font-medium truncate">{dish.name}</div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-stone-400 hover:bg-stone-100" aria-label="Close"><X size={18} /></button>
        </div>

        <div className="px-5 py-4 space-y-6">
          {/* image */}
          <section>
            <label className="block text-sm font-medium text-stone-600 mb-2">Photo URL</label>
            <div className="flex items-center gap-3">
              <DishThumb imageUrl={imageUrl.trim() || null} slot={dish.slot} name={dish.name}
                className="w-14 h-14 shrink-0" rounded="rounded-xl" emojiClass="text-2xl" />
              <input value={imageUrl} onChange={e => setImageUrl(e.target.value)}
                onBlur={() => onPatch(dish.id, { recipe_image_url: imageUrl.trim() || null })}
                placeholder="https://…"
                className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-orange-300" />
            </div>
          </section>

          {/* ingredients */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-stone-600">Ingredients</h3>
              <button onClick={addIng} className="flex items-center gap-1 text-sm text-orange-600 hover:text-orange-700"><Plus size={15} /> Add</button>
            </div>
            {ingredients.length === 0 && <p className="text-sm text-stone-400">No ingredients yet.</p>}
            <div className="space-y-2">
              {ingredients.map((ing, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input value={ing.name ?? ''} onChange={e => setIngField(i, { name: e.target.value })}
                    onBlur={() => saveIngredients(ingredients)} placeholder="Ingredient"
                    className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-orange-300" />
                  <input value={ing.quantity ?? ''} onChange={e => setIngField(i, { quantity: e.target.value })}
                    onBlur={() => saveIngredients(ingredients)} placeholder="qty"
                    className="w-20 px-2 py-1.5 rounded-lg border border-stone-200 text-sm text-stone-500 focus:outline-none focus:border-orange-300" />
                  <select value={(ing.category ?? 'other') as string} onChange={e => saveIngredients(ingredients.map((it, idx) => idx === i ? { ...it, category: e.target.value } : it))}
                    className="px-1.5 py-1.5 rounded-lg border border-stone-200 text-sm text-stone-600 focus:outline-none focus:border-orange-300">
                    {SHOP_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <button onClick={() => removeIng(i)} className="p-1 text-stone-300 hover:text-red-500 shrink-0" aria-label="Remove ingredient"><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
          </section>

          {/* recipe steps */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-stone-600">Recipe steps</h3>
              <button onClick={addStep} className="flex items-center gap-1 text-sm text-orange-600 hover:text-orange-700"><Plus size={15} /> Add step</button>
            </div>
            {steps.length === 0 && <p className="text-sm text-stone-400">No steps yet.</p>}
            <div className="space-y-2">
              {steps.map((s, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <span className="mt-2 shrink-0 w-5 h-5 rounded-full bg-orange-100 text-orange-700 text-[11px] font-semibold flex items-center justify-center">{i + 1}</span>
                  <textarea value={s} onChange={e => setStep(i, e.target.value)} onBlur={() => saveSteps(steps)} rows={2}
                    placeholder="Describe this step…"
                    className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border border-stone-200 text-sm resize-none focus:outline-none focus:border-orange-300" />
                  <div className="flex flex-col shrink-0">
                    <button onClick={() => moveStep(i, -1)} disabled={i === 0} className="p-0.5 text-stone-300 hover:text-stone-600 disabled:opacity-30" aria-label="Move up"><ChevronUp size={14} /></button>
                    <button onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1} className="p-0.5 text-stone-300 hover:text-stone-600 disabled:opacity-30" aria-label="Move down"><ChevronDown size={14} /></button>
                  </div>
                  <button onClick={() => removeStep(i)} className="p-1 mt-1 text-stone-300 hover:text-red-500 shrink-0" aria-label="Remove step"><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
          </section>

          <Link href={`/meals/dish/${dish.id}`} className="inline-flex items-center gap-1 text-sm text-orange-600 hover:text-orange-700">
            View recipe page <ExternalLink size={14} />
          </Link>
        </div>
      </div>
    </div>
  )
}
