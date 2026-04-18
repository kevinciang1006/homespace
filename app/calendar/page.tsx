export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { supabase, type CalendarEvent } from '@/lib/supabase'
import CalendarClient from '@/components/calendar/CalendarClient'

export default async function CalendarPage() {
  const { data: tokenRows } = await supabase
    .from('google_tokens')
    .select('id')
    .limit(1)

  const connected = (tokenRows ?? []).length > 0

  let events: CalendarEvent[] = []
  if (connected) {
    const now = new Date().toISOString()
    const { data } = await supabase
      .from('calendar_events')
      .select('*')
      .gte('start_at', now)
      .order('start_at', { ascending: true })
    events = (data as CalendarEvent[]) ?? []
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="bg-white border-b border-stone-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link href="/" className="text-stone-400 hover:text-stone-600 transition-colors">
            <ArrowLeft size={18} />
          </Link>
          <h1 className="text-xl font-semibold text-stone-900" style={{ fontFamily: 'DM Serif Display, serif' }}>
            Calendar
          </h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8">
        <CalendarClient connected={connected} events={events} />
      </main>
    </div>
  )
}
