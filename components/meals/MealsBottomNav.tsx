'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarDays, UtensilsCrossed, Carrot, ShoppingCart } from 'lucide-react'

const tabs = [
  { href: '/meals', label: 'Plan', Icon: CalendarDays },
  { href: '/meals/dishes', label: 'Dishes', Icon: UtensilsCrossed },
  { href: '/meals/ingredients', label: 'Ingredients', Icon: Carrot },
  { href: '/meals/shopping', label: 'Shopping', Icon: ShoppingCart },
]

export default function MealsBottomNav() {
  const pathname = usePathname()
  return (
    <nav className="sm:hidden fixed bottom-0 inset-x-0 z-20 bg-white/95 backdrop-blur border-t border-stone-200 pb-[env(safe-area-inset-bottom)]">
      <div className="flex">
        {tabs.map(({ href, label, Icon }) => {
          const active = pathname === href
          return (
            <Link key={href} href={href}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors ${
                active ? 'text-orange-600' : 'text-stone-400 hover:text-stone-600'}`}>
              <Icon size={20} strokeWidth={active ? 2.4 : 2} />
              {label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
