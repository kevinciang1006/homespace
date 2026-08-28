'use client'
import { useState } from 'react'
import type { BacklogItem, TimeOfDay } from '@/lib/backlog/types'

const CATEGORIES = ['car', 'kitchen', 'home_maint', 'outdoor', 'online', 'errand', 'other']
const STATUSES = ['ready', 'blocked', 'snoozed', 'done', 'dropped']
const DAY_PREFS = ['any', 'weekday', 'weekend']
const TIMES: TimeOfDay[] = ['morning', 'afternoon', 'evening', 'night', 'any']

export default function TagEditor({ item, onSave, onCancel }: {
  item: BacklogItem
  onSave: (patch: Partial<BacklogItem>) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<BacklogItem>(item)
  const set = <K extends keyof BacklogItem>(k: K, v: BacklogItem[K]) =>
    setDraft(d => ({ ...d, [k]: v }))

  function toggleTime(t: TimeOfDay) {
    const has = draft.time_of_day.includes(t)
    set('time_of_day', (has
      ? draft.time_of_day.filter(x => x !== t)
      : [...draft.time_of_day, t]) as TimeOfDay[])
  }

  function save() {
    onSave({
      title: draft.title.trim(),
      category: draft.category,
      status: draft.status,
      blocked_by: draft.blocked_by?.trim() || null,
      time_of_day: draft.time_of_day.length ? draft.time_of_day : (['any'] as TimeOfDay[]),
      day_pref: draft.day_pref,
      needs_daylight: draft.needs_daylight,
      needs_dry: draft.needs_dry,
      prep_ahead: draft.prep_ahead,
      lead_time_hours: draft.lead_time_hours,
      mutex_group: draft.mutex_group?.trim() || null,
      recurring: draft.recurring,
      recurrence: draft.recurrence?.trim() || null,
      deadline: draft.deadline || null,
      priority: Number(draft.priority) || 0,
      snooze_until: draft.snooze_until || null,
      notes: draft.notes?.trim() || null,
    })
  }

  const field = 'border border-stone-200 rounded-lg px-2 py-1 text-sm w-full'

  return (
    <div className="mt-3 grid gap-3 rounded-lg bg-stone-50 border border-stone-200 p-3 text-sm">
      <label className="grid gap-1">
        <span className="text-xs text-stone-500">Title</span>
        <input className={field} value={draft.title} onChange={e => set('title', e.target.value)} />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1">
          <span className="text-xs text-stone-500">Category</span>
          <select className={field} value={draft.category}
            onChange={e => set('category', e.target.value as BacklogItem['category'])}>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-stone-500">Status</span>
          <select className={field} value={draft.status}
            onChange={e => set('status', e.target.value as BacklogItem['status'])}>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>

      <label className="grid gap-1">
        <span className="text-xs text-stone-500">Blocked by</span>
        <input className={field} value={draft.blocked_by ?? ''}
          onChange={e => set('blocked_by', e.target.value)} placeholder="awaiting: …" />
      </label>

      <div className="grid gap-1">
        <span className="text-xs text-stone-500">Time of day</span>
        <div className="flex flex-wrap gap-2">
          {TIMES.map(t => (
            <button key={t} type="button" onClick={() => toggleTime(t)}
              className={`px-2 py-1 rounded-full text-xs border ${
                draft.time_of_day.includes(t)
                  ? 'bg-orange-500 text-white border-orange-500'
                  : 'bg-white text-stone-600 border-stone-200'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1">
          <span className="text-xs text-stone-500">Day preference</span>
          <select className={field} value={draft.day_pref}
            onChange={e => set('day_pref', e.target.value as BacklogItem['day_pref'])}>
            {DAY_PREFS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-stone-500">Priority</span>
          <input type="number" className={field} value={draft.priority}
            onChange={e => set('priority', Number(e.target.value) as BacklogItem['priority'])} />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1">
          <span className="text-xs text-stone-500">Deadline</span>
          <input type="date" className={field} value={draft.deadline ?? ''}
            onChange={e => set('deadline', (e.target.value || null) as BacklogItem['deadline'])} />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-stone-500">Snooze until</span>
          <input type="date" className={field} value={draft.snooze_until ?? ''}
            onChange={e => set('snooze_until', (e.target.value || null) as BacklogItem['snooze_until'])} />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1">
          <span className="text-xs text-stone-500">Lead time (hours)</span>
          <input type="number" className={field} value={draft.lead_time_hours ?? ''}
            onChange={e => set('lead_time_hours',
              (e.target.value === '' ? null : Number(e.target.value)) as BacklogItem['lead_time_hours'])} />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-stone-500">Mutex group</span>
          <input className={field} value={draft.mutex_group ?? ''}
            onChange={e => set('mutex_group', (e.target.value || null) as BacklogItem['mutex_group'])} />
        </label>
      </div>

      <label className="grid gap-1">
        <span className="text-xs text-stone-500">Recurrence (e.g. &quot;daily&quot;)</span>
        <input className={field} value={draft.recurrence ?? ''}
          onChange={e => set('recurrence', (e.target.value || null) as BacklogItem['recurrence'])} />
      </label>

      <div className="flex flex-wrap gap-4">
        {(['needs_daylight', 'needs_dry', 'prep_ahead', 'recurring'] as const).map(k => (
          <label key={k} className="flex items-center gap-1.5 text-xs text-stone-600">
            <input type="checkbox" checked={draft[k]} onChange={e => set(k, e.target.checked)} />
            {k.replace(/_/g, ' ')}
          </label>
        ))}
      </div>

      <label className="grid gap-1">
        <span className="text-xs text-stone-500">Notes</span>
        <textarea className={field} rows={2} value={draft.notes ?? ''}
          onChange={e => set('notes', e.target.value)} />
      </label>

      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-sm text-stone-500 hover:bg-stone-200">
          Cancel
        </button>
        <button onClick={save} className="px-3 py-1.5 rounded-lg text-sm bg-orange-500 text-white hover:bg-orange-600">
          Save
        </button>
      </div>
    </div>
  )
}
