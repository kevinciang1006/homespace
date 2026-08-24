'use client'
import { useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Check } from 'lucide-react'
import { SLOT_LABELS, type MealPlan, type PrepTask } from '@/lib/meals/types'
import { dayNameShort } from '@/lib/meals/dates'
import { qtyDisplay } from '@/lib/meals/qty'
import DishImage from './DishImage'
import ViewToggle from './ViewToggle'

const PREP_ICON: Record<string, string> = {
  thaw_batch: '🧊', marinate: '🫙', cook_overnight: '🍲', cut: '🔪', portion: '📦',
}

function DishLinks({ dishes }: { dishes: MealPlan['dishes'] }) {
  const links = dishes?.recipe_links ?? []
  if (links.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5 mt-1">
      {links.map((l, i) => (
        <a key={i} href={l.url} target="_blank" rel="noopener noreferrer"
          className="text-[11px] text-orange-600 hover:text-orange-700 underline underline-offset-2">
          {l.title || l.url}
        </a>
      ))}
    </div>
  )
}

// Compact reference card — smaller than the old hero style, since meals
// are now secondary to the prep checklist above them.
// The recipe-links row renders its own <a> tags, so it must sit OUTSIDE
// the card's own <Link> — nesting an <a> inside an <a> is invalid HTML and
// causes a hydration mismatch (this bug pre-existed in the old DayView too,
// just never surfaced because no previously-tested day had both).
function DishCard({ row }: { row: MealPlan }) {
  const qty = qtyDisplay(row.dishes)
  return (
    <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
      <Link href={row.dish_id ? `/meals/dish/${row.dish_id}` : '#'}
        className="flex items-center gap-2.5 hover:bg-stone-50 transition-colors p-1.5">
        <DishImage imageUrl={row.dishes?.recipe_image_url ?? null} protein={row.dishes?.protein ?? 'none'} name={row.dish_name ?? undefined}
          className="w-12 h-12 shrink-0" rounded="rounded-lg" iconSize={20} />
        <div className="min-w-0 flex-1 py-0.5">
          <div className="text-[10px] uppercase tracking-wide text-stone-400">
            {row.dishes?.slot ? SLOT_LABELS[row.dishes.slot] : ''}
          </div>
          <div className="text-sm text-stone-800 truncate">{row.dish_name ?? '—'}</div>
          {qty && <div className="text-xs text-stone-500 mt-0.5">{qty}</div>}
          {row.dishes?.bumbu_packet && (
            <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700">
              {row.dishes.bumbu_packet}
            </span>
          )}
        </div>
      </Link>
      {(row.dishes?.recipe_links?.length ?? 0) > 0 && (
        <div className="px-1.5 pb-1.5">
          <DishLinks dishes={row.dishes} />
        </div>
      )}
    </div>
  )
}

function PrepChecklist({ date, tasks }: { date: string; tasks: PrepTask[] }) {
  const [items, setItems] = useState(tasks)
  async function toggle(id: string, done: boolean) {
    setItems(list => list.map(t => t.id === id ? { ...t, done } : t)) // optimistic
    const res = await fetch(`/api/meals/prep-tasks/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ done }),
    })
    if (!res.ok) setItems(list => list.map(t => t.id === id ? { ...t, done: !done } : t)) // revert
  }
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-4">
      <h2 className="text-base text-stone-800 mb-3 flex items-center gap-1.5" style={{ fontFamily: 'DM Serif Display, serif' }}>
        🔪 Persiapan hari ini
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-stone-500">Tidak ada persiapan khusus hari ini 👍</p>
      ) : (
        <ul className="space-y-2">
          {items.map(t => (
            <li key={t.id} className={`flex items-start gap-3 bg-white border border-amber-100 rounded-xl p-3 ${t.done ? 'opacity-60' : ''}`}>
              <button onClick={() => toggle(t.id, !t.done)} aria-label={t.done ? 'Mark not done' : 'Mark done'}
                className={`shrink-0 w-7 h-7 rounded-lg border-2 flex items-center justify-center mt-0.5 ${t.done ? 'bg-orange-600 border-orange-600' : 'border-stone-300'}`}>
                {t.done && <Check size={16} className="text-white" />}
              </button>
              <div className="min-w-0">
                <div className={`text-sm text-stone-800 ${t.done ? 'line-through' : ''}`}>
                  <span className="mr-1.5">{PREP_ICON[t.prep_type ?? ''] ?? '📋'}</span>
                  {t.instruction}
                </div>
                {t.prep_type !== 'thaw_batch' && t.cook_date !== date && (
                  <div className="text-xs text-stone-400 mt-0.5">untuk {dayNameShort(t.cook_date)}</div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RawIngredientsGlance({ rows }: { rows: MealPlan[] }) {
  const withIngredients = rows.filter(r => r.dish_id && !r.skipped && (r.dishes?.shop_ingredients?.length ?? 0) > 0)
  if (withIngredients.length === 0) return null
  return (
    <div className="bg-white border border-stone-200 rounded-2xl p-4 mb-4">
      <h3 className="text-xs font-medium text-stone-500 mb-2">🧺 Bahan mentah hari ini</h3>
      <div className="space-y-2">
        {withIngredients.map(r => (
          <div key={r.id}>
            <div className="text-xs text-stone-600 mb-1">{r.dish_name}</div>
            <div className="flex flex-wrap gap-1.5">
              {(r.dishes?.shop_ingredients ?? []).map((ing, i) => (
                <span key={i} className="px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 text-[11px]">
                  {ing.name}{ing.quantity ? ` · ${ing.quantity}` : ''}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function DayView({
  date, dayName, rows, prepTasks, prevDate, nextDate, backToWeekHref,
}: {
  date: string
  dayName: string
  rows: MealPlan[]
  prepTasks: PrepTask[]
  prevDate: string
  nextDate: string
  backToWeekHref: string
}) {
  const breakfast = rows.find(r => r.slot === 'breakfast' && r.dish_id && !r.skipped)
  const breakfastFruit = rows.find(r => r.slot === 'fruit' && r.role === 'breakfast' && r.dish_id && !r.skipped)
  const main = rows.find(r => r.role === 'main' && r.dish_id && !r.skipped)
  const supports = rows.filter(r => r.role === 'support' && r.dish_id && !r.skipped)
  const dessertFruit = rows.find(r => r.slot === 'fruit' && r.role === 'optional' && r.dish_id && !r.skipped)
  const desert = rows.find(r => r.slot === 'desert' && r.dish_id && !r.skipped)
  const hasPlan = !!(breakfast || main || supports.length || dessertFruit || desert)

  return (
    <div className="max-w-md mx-auto">
      <div className="mb-4">
        <ViewToggle weekHref={backToWeekHref} dayHref={`/meals/day/${date}`} />
      </div>

      <div className="flex items-center justify-between mb-4">
        <Link href={`/meals/day/${prevDate}`} className="p-2 rounded-lg hover:bg-stone-100 text-stone-600" aria-label="Previous day">
          <ChevronLeft size={18} />
        </Link>
        <h1 className="text-xl text-stone-900" style={{ fontFamily: 'DM Serif Display, serif' }}>{dayName}</h1>
        <Link href={`/meals/day/${nextDate}`} className="p-2 rounded-lg hover:bg-stone-100 text-stone-600" aria-label="Next day">
          <ChevronRight size={18} />
        </Link>
      </div>

      <PrepChecklist date={date} tasks={prepTasks} />
      <RawIngredientsGlance rows={rows} />

      <div>
        <h3 className="text-xs font-medium text-stone-400 mb-2">🍽️ Makan hari ini</h3>
        {!hasPlan ? (
          <p className="text-sm text-stone-400 bg-white border border-stone-200 rounded-2xl p-5 text-center">
            Nothing planned for this day yet.
          </p>
        ) : (
          <div className="space-y-2">
            {breakfast && <DishCard row={breakfast} />}
            {breakfastFruit && <DishCard row={breakfastFruit} />}
            {main && <DishCard row={main} />}
            {supports.map(s => <DishCard key={s.id} row={s} />)}
            {dessertFruit && <DishCard row={dessertFruit} />}
            {desert && <DishCard row={desert} />}
          </div>
        )}
      </div>
    </div>
  )
}
