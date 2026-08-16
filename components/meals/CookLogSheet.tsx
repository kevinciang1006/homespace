'use client'
import { useEffect, useState } from 'react'
import type { MealPlan, Slot } from '@/lib/meals/types'

type Draft = { slot: Slot; planned_dish_id: string | null; planned_dish_name: string | null
  actual_dish_id: string | null; actual_dish_name: string | null; cooked: boolean }

export default function CookLogSheet({ date, rows, entries, onClose, onSaved }: {
  date: string; rows: MealPlan[]; entries: Draft[]
  onClose: () => void; onSaved: (date: string, entries: unknown[]) => void
}) {
  const planned = rows.filter(r => r.dish_id && !r.skipped)
  const [drafts, setDrafts] = useState<Draft[]>(() => planned.map(r => {
    const prev = entries.find(e => e.slot === r.slot)
    return {
      slot: r.slot, planned_dish_id: r.dish_id, planned_dish_name: r.dish_name,
      actual_dish_id: prev?.actual_dish_id ?? r.dish_id,
      actual_dish_name: prev?.actual_dish_name ?? r.dish_name,
      cooked: prev ? prev.cooked : true,
    }
  }))
  const [pools, setPools] = useState<Record<string, { id: string; name: string }[]>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    planned.forEach(async r => {
      const res = await fetch(`/api/meals/reroll?plan_date=${date}&slot=${r.slot}&alternatives=8`)
      if (res.ok) { const { alternatives } = await res.json(); setPools(p => ({ ...p, [r.slot]: alternatives })) }
    })
  }, [date]) // eslint-disable-line react-hooks/exhaustive-deps

  function set(i: number, patch: Partial<Draft>) { setDrafts(d => d.map((x, idx) => idx === i ? { ...x, ...patch } : x)) }
  async function save() {
    setSaving(true)
    const res = await fetch('/api/meals/cook-log', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cook_date: date, entries: drafts }),
    })
    if (res.ok) { const { entries: saved } = await res.json(); onSaved(date, saved) }
    setSaving(false); onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-4 max-h-[85vh] overflow-y-auto">
        <h3 className="text-lg text-stone-900 mb-3" style={{ fontFamily: 'DM Serif Display, serif' }}>What did you cook?</h3>
        <div className="space-y-3">
          {drafts.map((d, i) => {
            const pool = pools[d.slot] ?? []
            const options = [
              ...(d.planned_dish_id ? [{ id: d.planned_dish_id, name: (d.planned_dish_name ?? '') + ' (planned)' }] : []),
              ...pool.filter(o => o.id !== d.planned_dish_id),
            ]
            return (
              <div key={d.slot} className={`border border-stone-200 rounded-xl p-2.5 ${!d.cooked ? 'opacity-60' : ''}`}>
                <div className="text-[10px] uppercase tracking-wide text-stone-400">{d.slot}</div>
                <select value={d.actual_dish_id ?? ''} disabled={!d.cooked}
                  onChange={e => { const id = e.target.value || null; const name = options.find(o => o.id === id)?.name.replace(' (planned)', '') ?? null; set(i, { actual_dish_id: id, actual_dish_name: name }) }}
                  className="w-full border border-stone-200 rounded-lg px-2 py-1.5 text-sm mt-1">
                  {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  <option value="">Other / free text…</option>
                </select>
                {!d.actual_dish_id && d.cooked && (
                  <input value={d.actual_dish_name ?? ''} onChange={e => set(i, { actual_dish_name: e.target.value })}
                    placeholder="What did you actually cook?" className="w-full border border-stone-200 rounded-lg px-2 py-1.5 text-sm mt-1.5" />
                )}
                <label className="flex items-center gap-2 text-xs text-stone-500 mt-2">
                  <input type="checkbox" checked={!d.cooked} onChange={e => set(i, { cooked: !e.target.checked })} />
                  Didn&apos;t cook / ate out
                </label>
              </div>
            )
          })}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-stone-500">Cancel</button>
          <button onClick={save} disabled={saving} className="px-4 py-1.5 rounded-lg bg-orange-600 text-white text-sm disabled:opacity-60">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}
