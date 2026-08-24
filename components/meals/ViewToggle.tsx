'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

// Small "Week | Day" segmented control. Purely navigational — no shared
// client state — so it works the same whether it's rendered on /meals
// (week grid) or /meals/day/[date] (single-day view).
export default function ViewToggle({ weekHref, dayHref }: { weekHref: string; dayHref: string }) {
  const pathname = usePathname()
  const isDay = pathname.startsWith('/meals/day/')

  return (
    <div className="inline-flex rounded-lg border border-stone-200 bg-stone-100 p-0.5" role="tablist" aria-label="View">
      <Link href={weekHref} role="tab" aria-selected={!isDay}
        className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
          !isDay ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}>
        Week
      </Link>
      <Link href={dayHref} role="tab" aria-selected={isDay}
        className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
          isDay ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}>
        Day
      </Link>
    </div>
  )
}
