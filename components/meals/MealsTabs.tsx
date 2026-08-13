'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const tabs = [
  { href: '/meals', label: 'Plan' },
  { href: '/meals/dishes', label: 'Dishes' },
  { href: '/meals/shopping', label: 'Shopping List' },
]

export default function MealsTabs() {
  const pathname = usePathname()
  return (
    <nav className="flex gap-1">
      {tabs.map(t => {
        const active = pathname === t.href
        return (
          <Link key={t.href} href={t.href}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              active ? 'text-orange-600 bg-orange-50' : 'text-stone-500 hover:text-stone-800'}`}>
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
