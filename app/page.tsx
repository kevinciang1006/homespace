import Link from 'next/link'
import { cookies } from 'next/headers'
import { Receipt, Calendar, ShoppingCart, Plus, LogOut } from 'lucide-react'

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
  },
  {
    href: '/shopping',
    icon: ShoppingCart,
    label: 'Shopping',
    description: 'Shared grocery lists',
    color: 'bg-green-50 text-green-600',
  },
]

export default async function Home() {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('hs_session')?.value

  let userName = ''
  if (sessionCookie) {
    try {
      const session = JSON.parse(sessionCookie)
      userName = session.name ?? ''
    } catch {}
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="bg-white border-b border-stone-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-semibold text-stone-900" style={{ fontFamily: 'DM Serif Display, serif' }}>
              home<span className="text-orange-500 italic">space</span>
            </h1>
            {userName && (
              <span className="text-sm text-stone-500">Hi, {userName}</span>
            )}
          </div>
          <form action="/api/auth/logout" method="POST">
            <button
              type="submit"
              className="flex items-center gap-1.5 text-sm text-stone-400 hover:text-stone-600 transition-colors"
            >
              <LogOut size={15} />
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-10">
        <p className="text-stone-500 text-sm mb-8">
          What would you like to manage today?
        </p>

        <div className="grid gap-4">
          {features.map(({ href, icon: Icon, label, description, color }) => (
            <Link
              key={href}
              href={href}
              className="group flex items-center gap-4 bg-white border border-stone-200 rounded-2xl p-5 transition-all hover:border-stone-300 hover:shadow-sm"
            >
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${color}`}>
                <Icon size={22} />
              </div>
              <div className="flex-1">
                <span className="font-medium text-stone-900">{label}</span>
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
