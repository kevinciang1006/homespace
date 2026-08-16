'use client'
import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { WeekOverview as Overview, SignalStatus } from '@/lib/meals/overview'

const STATUS: Record<SignalStatus, string> = { good: 'text-green-600', neutral: 'text-stone-400', headsup: 'text-amber-600' }

export default function WeekOverview({ overview }: { overview: Overview }) {
  const [expanded, setExpanded] = useState(false)

  if (!overview.hasPlan) {
    return (
      <div className="bg-white border border-stone-200 rounded-2xl px-4 py-3 mb-4 text-sm text-stone-500">
        {overview.verdict} — {overview.summary}
      </div>
    )
  }

  return (
    <div className="bg-white border border-stone-200 rounded-2xl p-4 mb-4">
      <button onClick={() => setExpanded(e => !e)} className="w-full flex items-center justify-between text-left sm:cursor-default">
        <div className="min-w-0">
          <div className="text-lg text-stone-900 leading-tight" style={{ fontFamily: 'DM Serif Display, serif' }}>{overview.verdict}</div>
          <div className="text-xs text-stone-500 mt-0.5 truncate">{overview.summary}</div>
        </div>
        <span className="sm:hidden text-stone-400 shrink-0 ml-2">{expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</span>
      </button>

      <div className={`${expanded ? 'grid' : 'hidden'} sm:grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-5 gap-y-2.5 mt-3 pt-3 border-t border-stone-100`}>
        {overview.signals.map(s => (
          <div key={s.label} className="flex items-start gap-2">
            <span className="text-base leading-none mt-0.5">{s.emoji}</span>
            <div className="min-w-0">
              <div className={`text-xs font-medium ${STATUS[s.status]}`}>{s.label}</div>
              <div className="text-[11px] text-stone-500 leading-snug">{s.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
