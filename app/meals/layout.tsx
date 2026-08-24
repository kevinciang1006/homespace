import { cookies } from 'next/headers'
import Link from 'next/link'
import { Settings } from 'lucide-react'
import MealsTabs from '@/components/meals/MealsTabs'
import MealsBottomNav from '@/components/meals/MealsBottomNav'

export default async function MealsLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('hs_session')?.value
  let userName = ''
  if (sessionCookie) {
    try { userName = JSON.parse(sessionCookie).name ?? '' } catch {}
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="bg-white border-b border-stone-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-2xl font-semibold text-stone-900" style={{ fontFamily: 'DM Serif Display, serif' }}>
              home<span className="text-orange-500 italic">space</span>
            </Link>
            {userName && <span className="text-sm text-stone-500">Hi, {userName}</span>}
          </div>
          <div className="flex items-center gap-3">
            <MealsTabs />
            <Link href="/settings" aria-label="Notification settings"
              className="p-2 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors">
              <Settings size={18} />
            </Link>
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 pb-24 sm:pb-6">{children}</main>
      <MealsBottomNav />
    </div>
  )
}
