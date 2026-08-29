'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Bell } from 'lucide-react'
import type { WaSettings } from '@/lib/wa/types'

type Row = {
  key: 'weekly' | 'daily' | 'prep' | 'backlog' | 'batch_prep'
  label: string
  description: string
}

const ROWS: Row[] = [
  { key: 'weekly', label: 'Weekly shopping list', description: 'Saturday morning, a flat ingredient list' },
  { key: 'daily', label: 'Daily meal reminder', description: "Tomorrow's meals, sent the evening before" },
  { key: 'prep', label: 'Prep/thaw reminder', description: 'Batches same-evening thaw & marinate prep' },
  { key: 'batch_prep', label: 'Batch prep (post-shopping)', description: 'Weekly by-dish prep checklist, split between Wife and Kevin' },
  { key: 'backlog', label: 'Backlog nudge', description: 'One evening chore suggestion that fits the moment' },
]

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] // Mon=0..Sun=6

export default function WaSettingsClient({ initialSettings }: { initialSettings: WaSettings }) {
  const [settings, setSettings] = useState(initialSettings)
  const [saving, setSaving] = useState(false)

  async function patch(fields: Partial<WaSettings>) {
    setSettings(s => ({ ...s, ...fields }))
    setSaving(true)
    try {
      const res = await fetch('/api/wa/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      })
      const updated = await res.json()
      setSettings(updated)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="bg-white border-b border-stone-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link href="/" className="text-stone-400 hover:text-stone-600 transition-colors">
            <ArrowLeft size={18} />
          </Link>
          <h1 className="text-xl font-semibold text-stone-900" style={{ fontFamily: 'DM Serif Display, serif' }}>
            Notifications
          </h1>
          {saving && <span className="text-xs text-stone-400 ml-auto">Saving…</span>}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8 space-y-4">
        {ROWS.map(({ key, label, description }) => {
          const enabledKey = `${key}_enabled` as const
          const timeKey = `${key}_time` as const
          return (
            <div key={key} className="bg-white border border-stone-200 rounded-xl p-4 flex items-center justify-between gap-4">
              <div>
                <p className="font-medium text-stone-900 flex items-center gap-2"><Bell size={15} /> {label}</p>
                <p className="text-sm text-stone-500 mt-0.5">{description}</p>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="time"
                  value={settings[timeKey]}
                  onChange={e => patch({ [timeKey]: e.target.value } as Partial<WaSettings>)}
                  className="border border-stone-200 rounded-lg px-2 py-1 text-sm"
                  disabled={!settings[enabledKey]}
                />
                <button
                  onClick={() => patch({ [enabledKey]: !settings[enabledKey] } as Partial<WaSettings>)}
                  className={`w-11 h-6 rounded-full transition-colors relative ${settings[enabledKey] ? 'bg-orange-500' : 'bg-stone-300'}`}
                >
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${settings[enabledKey] ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
              </div>
            </div>
          )
        })}

        <div className="bg-white border border-stone-200 rounded-xl p-4 flex items-center justify-between gap-4">
          <div>
            <p className="font-medium text-stone-900">Switch to next week from</p>
            <p className="text-sm text-stone-500 mt-0.5">On/after this weekday, the shopping list targets next week&apos;s plan instead of this week&apos;s</p>
          </div>
          <select
            value={settings.weekly_cutoff_dow}
            onChange={e => patch({ weekly_cutoff_dow: Number(e.target.value) })}
            className="border border-stone-200 rounded-lg px-2 py-1 text-sm"
          >
            {WEEKDAYS.map((name, dow) => <option key={dow} value={dow}>{name}</option>)}
          </select>
        </div>

        <div className="bg-white border border-stone-200 rounded-xl p-4 flex items-center justify-between gap-4">
          <div>
            <p className="font-medium text-stone-900">Batch prep day</p>
            <p className="text-sm text-stone-500 mt-0.5">Which day the post-shopping prep messages go out</p>
          </div>
          <select
            value={settings.batch_prep_dow}
            onChange={e => patch({ batch_prep_dow: Number(e.target.value) })}
            className="border border-stone-200 rounded-lg px-2 py-1 text-sm"
            disabled={!settings.batch_prep_enabled}
          >
            {WEEKDAYS.map((name, dow) => <option key={dow} value={dow}>{name}</option>)}
          </select>
        </div>

        <div className="bg-white border border-stone-200 rounded-xl p-4">
          <p className="font-medium text-stone-900 mb-0.5">Batch prep recipients</p>
          <p className="text-sm text-stone-500 mb-3">Each gets different content (cooking prep vs. fruit/yogurt) — turn either off independently</p>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm text-stone-700">
              <input type="checkbox" checked={settings.batch_prep_wife_enabled}
                onChange={e => patch({ batch_prep_wife_enabled: e.target.checked })}
                disabled={!settings.batch_prep_enabled} className="w-4 h-4 accent-orange-600" />
              Wife (cooking prep)
            </label>
            <label className="flex items-center gap-2 text-sm text-stone-700">
              <input type="checkbox" checked={settings.batch_prep_kevin_enabled}
                onChange={e => patch({ batch_prep_kevin_enabled: e.target.checked })}
                disabled={!settings.batch_prep_enabled} className="w-4 h-4 accent-orange-600" />
              Kevin (fruit/yogurt)
            </label>
          </div>
        </div>

        <div className="bg-white border border-stone-200 rounded-xl p-4 flex items-center justify-between gap-4">
          <div>
            <p className="font-medium text-stone-900">Also send to Kevin</p>
            <p className="text-sm text-stone-500 mt-0.5">Wife always gets these; toggle this to CC Kevin too</p>
          </div>
          <button
            onClick={() => patch({ include_kevin: !settings.include_kevin })}
            className={`w-11 h-6 rounded-full transition-colors relative ${settings.include_kevin ? 'bg-orange-500' : 'bg-stone-300'}`}
          >
            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${settings.include_kevin ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </div>
      </main>
    </div>
  )
}
