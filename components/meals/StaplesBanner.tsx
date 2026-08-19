'use client'
import { useState } from 'react'
import { Pencil, X, Plus, Trash2 } from 'lucide-react'
import type { DailyStaple } from '@/lib/meals/types'
import { formatStaplesLine } from '@/lib/meals/staples'

export default function StaplesBanner({ initialStaples }: { initialStaples: DailyStaple[] }) {
  const [staples, setStaples] = useState<DailyStaple[]>(initialStaples)
  const [editing, setEditing] = useState(false)

  async function patch(id: string, fields: Partial<DailyStaple>) {
    const prev = staples
    setStaples(s => s.map(x => x.id === id ? { ...x, ...fields } : x))
    const res = await fetch(`/api/meals/staples/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fields),
    })
    if (!res.ok) setStaples(prev)
  }
  async function add() {
    const res = await fetch('/api/meals/staples', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'New staple', person: '' }),
    })
    if (res.ok) { const s = await res.json() as DailyStaple; setStaples(prev => [...prev, s]) }
  }
  async function remove(id: string) {
    const prev = staples
    setStaples(s => s.filter(x => x.id !== id))
    const res = await fetch(`/api/meals/staples/${id}`, { method: 'DELETE' })
    if (!res.ok) setStaples(prev)
  }

  if (staples.length === 0 && !editing) return null

  return (
    <div className="mb-4 bg-white border border-stone-200 rounded-xl px-4 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-stone-600 min-w-0 truncate">
          🥛 Daily: <span className="text-stone-500">{formatStaplesLine(staples) || 'No staples yet'}</span>
        </div>
        <button onClick={() => setEditing(e => !e)} className="shrink-0 p-1 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100" aria-label="Edit daily staples">
          {editing ? <X size={14} /> : <Pencil size={14} />}
        </button>
      </div>
      {editing && (
        <div className="mt-2.5 pt-2.5 border-t border-stone-100 space-y-1.5">
          {staples.map(s => <StapleRow key={s.id} staple={s} onPatch={patch} onRemove={remove} />)}
          <button onClick={add} className="flex items-center gap-1 text-xs text-orange-600 hover:text-orange-700">
            <Plus size={13} /> Add staple
          </button>
        </div>
      )}
    </div>
  )
}

function StapleRow({ staple, onPatch, onRemove }: {
  staple: DailyStaple
  onPatch: (id: string, fields: Partial<DailyStaple>) => void
  onRemove: (id: string) => void
}) {
  const [person, setPerson] = useState(staple.person)
  const [name, setName] = useState(staple.name)
  return (
    <div className="flex items-center gap-1.5">
      <input value={person} onChange={e => setPerson(e.target.value)}
        onBlur={() => person.trim() !== staple.person && onPatch(staple.id, { person: person.trim() })}
        placeholder="Person" className="w-24 px-2 py-1 rounded-lg border border-stone-200 text-xs focus:outline-none focus:border-orange-300" />
      <input value={name} onChange={e => setName(e.target.value)}
        onBlur={() => name.trim() !== staple.name && onPatch(staple.id, { name: name.trim() })}
        placeholder="Item" className="flex-1 min-w-0 px-2 py-1 rounded-lg border border-stone-200 text-xs focus:outline-none focus:border-orange-300" />
      <button onClick={() => onRemove(staple.id)} className="p-1 text-stone-300 hover:text-red-500 shrink-0" aria-label={`Remove ${staple.name}`}>
        <Trash2 size={13} />
      </button>
    </div>
  )
}
