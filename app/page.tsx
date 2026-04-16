import Link from 'next/link'
import { Receipt, Calendar, ShoppingCart, Plus } from 'lucide-react'

const features = [
  {
    href: '/expenses',
    icon: Receipt,
    label: 'Expenses',
    description: 'Track receipts & spending',
    color: 'bg-orange-50 text-orange-600',
  },
  {
    href: '/calendar',
    icon: Calendar,
    label: 'Calendar',
    description: 'Family schedule',
    color: 'bg-blue-50 text-blue-600',
    soon: true,
  },
  {
    href: '/shopping',
    icon: ShoppingCart,
    label: 'Shopping',
    description: 'Shared grocery lists',
    color: 'bg-green-50 text-green-600',
    soon: true,
  },
]

export default function Home() {
  return (
    <div className="min-h-screen bg-stone-50">
      <header className="bg-white border-b border-stone-200 px-6 py-4 sticky top-0 z-10">
        <h1 className="text-2xl font-semibold text-stone-900" style={{ fontFamily: 'DM Serif Display, serif' }}>
          home<span className="text-orange-500 italic">space</span>
        </h1>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-10">
        <p className="text-stone-500 text-sm mb-8">Good to have you back. What would you like to manage today?</p>

        <div className="grid gap-4">
          {features.map(({ href, icon: Icon, label, description, color, soon }) => (
            <Link
              key={href}
              href={soon ? '#' : href}
              className={`group flex items-center gap-4 bg-white border border-stone-200 rounded-2xl p-5 transition-all hover:border-stone-300 hover:shadow-sm ${soon ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${color}`}>
                <Icon size={22} />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-stone-900">{label}</span>
                  {soon && (
                    <span className="text-xs bg-stone-100 text-stone-500 px-2 py-0.5 rounded-full">Soon</span>
                  )}
                </div>
                <p className="text-sm text-stone-500 mt-0.5">{description}</p>
              </div>
              <span className="text-stone-300 group-hover:text-stone-400 transition-colors">→</span>
            </Link>
          ))}

          <div className="flex items-center gap-4 border-2 border-dashed border-stone-200 rounded-2xl p-5 text-stone-400">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-stone-50">
              <Plus size={22} />
            </div>
            <div>
              <p className="font-medium text-stone-400">More features coming</p>
              <p className="text-sm mt-0.5">Add whatever your family needs</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
