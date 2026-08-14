'use client'
import { useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, Star, RotateCcw } from 'lucide-react'
import { SLOT_LABELS, type Dish, type Tier } from '@/lib/meals/types'
import DishImage from './DishImage'
import PhotoUploadButton from './PhotoUploadButton'

const TIER_STYLE: Record<Tier, string> = {
  everyday: 'bg-stone-100 text-stone-500',
  nice: 'bg-amber-100 text-amber-700',
  special: 'bg-orange-100 text-orange-700',
}

export default function RecipeClient({ dish }: { dish: Dish }) {
  const [imageUrl, setImageUrl] = useState(dish.recipe_image_url)
  const ingredients = dish.ingredients ?? []
  const steps = dish.recipe_steps ?? []
  // Ephemeral cooking checklist — "have I added this yet?" — resets on reload.
  const [checked, setChecked] = useState<boolean[]>(() => ingredients.map(() => false))
  const toggle = (i: number) => setChecked(c => c.map((v, idx) => (idx === i ? !v : v)))
  const reset = () => setChecked(ingredients.map(() => false))
  const doneCount = checked.filter(Boolean).length

  return (
    <div>
      <Link href="/meals" className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-800 mb-4">
        <ChevronLeft size={16} /> Back to plan
      </Link>

      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-4 sm:gap-5 mb-7">
        <div className="sm:w-52 shrink-0">
          <DishImage imageUrl={imageUrl} protein={dish.protein} name={dish.name}
            className="w-full h-44 sm:h-44" rounded="rounded-2xl" iconSize={56} />
          <div className="mt-2">
            <PhotoUploadButton dishId={dish.id} label={imageUrl ? 'Change photo' : 'Add photo'}
              onUploaded={url => setImageUrl(url)} />
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-stone-400 mb-1">{SLOT_LABELS[dish.slot]}</div>
          <h1 className="text-3xl text-stone-900 leading-tight" style={{ fontFamily: 'DM Serif Display, serif' }}>{dish.name}</h1>
          <div className="flex items-center flex-wrap gap-2 mt-3">
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${TIER_STYLE[dish.tier]}`}>{dish.tier}</span>
            {dish.protein && dish.protein !== 'none' && (
              <span className="px-2 py-0.5 rounded text-xs bg-stone-100 text-stone-600">{dish.protein}</span>
            )}
            {dish.spicy && <span className="px-2 py-0.5 rounded text-xs bg-orange-50 text-orange-600">🌶️ Spicy</span>}
            <span className="flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map(n => (
                <Star key={n} size={13} className={n <= dish.rating ? 'fill-amber-400 text-amber-400' : 'text-stone-300'} />
              ))}
            </span>
          </div>
          <Link href="/meals/dishes" className="text-sm text-orange-600 hover:text-orange-700 mt-3 inline-block">Edit in Dishes →</Link>
        </div>
      </div>

      {/* Steps (left, wide) + ingredient checklist (right, narrow); stacked on mobile with checklist first */}
      <div className="grid sm:grid-cols-[2fr_1fr] gap-6">
        <section className="order-2 sm:order-1">
          <h2 className="text-lg text-stone-800 mb-3" style={{ fontFamily: 'DM Serif Display, serif' }}>Recipe</h2>
          {steps.length === 0 ? (
            <p className="text-sm text-stone-400 bg-white border border-stone-200 rounded-2xl p-5">
              No recipe steps yet — add them in the Dishes tab.
            </p>
          ) : (
            <ol className="space-y-2.5">
              {steps.map((s, i) => (
                <li key={i} className="flex gap-3 bg-white border border-stone-200 rounded-2xl p-4">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-orange-100 text-orange-700 text-xs font-semibold flex items-center justify-center">{i + 1}</span>
                  <span className="text-stone-700 leading-relaxed">{s}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="order-1 sm:order-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg text-stone-800" style={{ fontFamily: 'DM Serif Display, serif' }}>Ingredients</h2>
            {ingredients.length > 0 && (
              <button onClick={reset} className="flex items-center gap-1 text-xs text-stone-400 hover:text-stone-700">
                <RotateCcw size={13} /> Reset
              </button>
            )}
          </div>
          {ingredients.length === 0 ? (
            <p className="text-sm text-stone-400 bg-white border border-stone-200 rounded-2xl p-5">
              No ingredients yet — add them in the Dishes tab.
            </p>
          ) : (
            <>
              <div className="bg-white border border-stone-200 rounded-2xl divide-y divide-stone-100">
                {ingredients.map((ing, i) => (
                  <button key={i} onClick={() => toggle(i)} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left">
                    <span className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${
                      checked[i] ? 'border-green-400 bg-green-400' : 'border-stone-300'}`}>
                      {checked[i] && <span className="text-white text-xs">✓</span>}
                    </span>
                    <span className={`flex-1 min-w-0 ${checked[i] ? 'line-through text-stone-400' : 'text-stone-800'}`}>
                      {ing.name}
                      {ing.quantity && <span className="text-stone-400 text-sm"> · {ing.quantity}</span>}
                    </span>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-stone-400 mt-2">{doneCount}/{ingredients.length} added · check off as you cook. Resets each visit.</p>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
