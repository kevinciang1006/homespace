import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { SLOT_LABELS, type MealPlan } from '@/lib/meals/types'
import { qtyDisplay } from '@/lib/meals/qty'
import DishImage from './DishImage'
import ViewToggle from './ViewToggle'

export type TodayPrepItem = { dish_id: string; dish_name: string; phrase: string; prepDayLabel: string }
export type UpcomingPrepItem = { dish_id: string; dish_name: string; phrase: string; cookDate: string; cookDayLabel: string }

function DishLinks({ dishes }: { dishes: MealPlan['dishes'] }) {
  const links = dishes?.recipe_links ?? []
  if (links.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2 mt-1">
      {links.map((l, i) => (
        <a key={i} href={l.url} target="_blank" rel="noopener noreferrer"
          className="text-xs text-orange-600 hover:text-orange-700 underline underline-offset-2">
          {l.title || l.url}
        </a>
      ))}
    </div>
  )
}

function DishCard({ row, big }: { row: MealPlan; big?: boolean }) {
  const qty = qtyDisplay(row.dishes)
  return (
    <Link href={row.dish_id ? `/meals/dish/${row.dish_id}` : '#'}
      className="block bg-white border border-stone-200 rounded-2xl overflow-hidden hover:border-stone-300 transition-colors">
      <DishImage imageUrl={row.dishes?.recipe_image_url ?? null} protein={row.dishes?.protein ?? 'none'} name={row.dish_name ?? undefined}
        className={big ? 'w-full aspect-video' : 'w-full aspect-[3/1]'} rounded="rounded-none" iconSize={big ? 34 : 22} />
      <div className="p-3">
        <div className="text-[10px] uppercase tracking-wide text-stone-400">
          {row.dishes?.slot ? SLOT_LABELS[row.dishes.slot] : ''}
        </div>
        <div className={big ? 'text-lg text-stone-900' : 'text-sm text-stone-800'} style={{ fontFamily: 'DM Serif Display, serif' }}>
          {row.dish_name ?? '—'}
        </div>
        {qty && <div className="text-xs text-stone-500 mt-0.5">{qty}</div>}
        {row.dishes?.bumbu_packet && (
          <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700">
            {row.dishes.bumbu_packet}
          </span>
        )}
        <DishLinks dishes={row.dishes} />
      </div>
    </Link>
  )
}

export default function DayView({
  date, dayName, rows, todayPrep, upcomingPrep, prevDate, nextDate, backToWeekHref,
}: {
  date: string
  dayName: string
  rows: MealPlan[]
  todayPrep: TodayPrepItem[]
  upcomingPrep: UpcomingPrepItem[]
  prevDate: string
  nextDate: string
  backToWeekHref: string
}) {
  const breakfast = rows.find(r => r.slot === 'breakfast' && r.dish_id && !r.skipped)
  const main = rows.find(r => r.role === 'main' && r.dish_id && !r.skipped)
  const supports = rows.filter(r => r.role === 'support' && r.dish_id && !r.skipped)
  const fruit = rows.find(r => r.slot === 'fruit' && r.dish_id && !r.skipped)
  const desert = rows.find(r => r.slot === 'desert' && r.dish_id && !r.skipped)
  const hasPlan = !!(breakfast || main || supports.length || fruit || desert)

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

      {!hasPlan ? (
        <p className="text-sm text-stone-400 bg-white border border-stone-200 rounded-2xl p-5 text-center">
          Nothing planned for this day yet.
        </p>
      ) : (
        <div className="space-y-3">
          {breakfast && <DishCard row={breakfast} />}
          {main && <DishCard row={main} big />}
          {supports.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {supports.map(s => <DishCard key={s.id} row={s} />)}
            </div>
          )}
          {fruit && <DishCard row={fruit} />}
          {desert && <DishCard row={desert} />}
        </div>
      )}

      {(todayPrep.length > 0 || upcomingPrep.length > 0) && (
        <div className="mt-5 bg-white border border-stone-200 rounded-2xl p-4">
          <h2 className="text-base text-stone-800 mb-3" style={{ fontFamily: 'DM Serif Display, serif' }}>Preparation</h2>
          {todayPrep.length > 0 && (
            <div className="mb-3">
              <div className="text-xs font-medium text-stone-500 mb-1.5">🍽️ Today&apos;s dishes</div>
              <ul className="space-y-1">
                {todayPrep.map(item => (
                  <li key={item.dish_id} className="text-sm text-stone-600">
                    {item.dish_name} — {item.phrase} <span className="text-stone-400">(started {item.prepDayLabel})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {upcomingPrep.length > 0 && (
            <div>
              <div className="text-xs font-medium text-stone-500 mb-1.5">🧊 Prep tonight for upcoming days</div>
              <ul className="space-y-1">
                {upcomingPrep.map(item => (
                  <li key={item.dish_id} className="text-sm text-stone-700">
                    <Link href={`/meals/day/${item.cookDate}`} className="hover:text-orange-700">
                      {item.dish_name} ({item.cookDayLabel}) — {item.phrase}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
