'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, Clock, PackageCheck, Pencil, Plus, RotateCcw } from 'lucide-react'
import type { BacklogItem } from '@/lib/backlog/types'
import TagEditor from './TagEditor'

const CATEGORIES = ['car', 'kitchen', 'home_maint', 'outdoor', 'online', 'errand', 'other']

function todayJakarta(): string {
  const shifted = new Date(Date.now() + 7 * 3600_000)
  return shifted.toISOString().slice(0, 10)
}

type Section = { key: string; title: string; items: BacklogItem[] }

export default function BacklogClient({ initialItems }: { initialItems: BacklogItem[] }) {
  const [items, setItems] = useState<BacklogItem[]>(initialItems)
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showDone, setShowDone] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newCategory, setNewCategory] = useState('other')
  const today = todayJakarta()

  const sections = useMemo<Section[]>(() => {
    const isSnoozed = (i: BacklogItem) => !!(i.snooze_until && i.snooze_until > today)
    const snoozed = items.filter(i => i.status === 'ready' && isSnoozed(i))
    const ready = items.filter(i => i.status === 'ready' && !isSnoozed(i))
    const blocked = items.filter(i => i.status === 'blocked')
    const done = items.filter(i => i.status === 'done')
      .sort((a, b) => (b.last_done_at ?? '').localeCompare(a.last_done_at ?? ''))
      .slice(0, 20)
    return [
      { key: 'ready', title: 'Ready', items: ready },
      { key: 'blocked', title: 'Blocked', items: blocked },
      { key: 'snoozed', title: 'Snoozed', items: snoozed },
      { key: 'done', title: 'Done', items: done },
    ]
  }, [items, today])

  function replace(row: BacklogItem) {
    setItems(list => list.map(i => (i.id === row.id ? row : i)))
  }

  async function act(id: string, action: 'done' | 'snooze' | 'arrived') {
    setBusy(true)
    try {
      const res = await fetch(`/api/backlog/items/${id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (res.ok) replace(await res.json())
    } finally { setBusy(false) }
  }

  async function savePatch(id: string, patch: Partial<BacklogItem>) {
    setBusy(true)
    try {
      const res = await fetch(`/api/backlog/items/${id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ patch }),
      })
      if (res.ok) { replace(await res.json()); setEditingId(null) }
    } finally { setBusy(false) }
  }

  async function addItem() {
    if (!newTitle.trim()) return
    setBusy(true)
    try {
      const res = await fetch('/api/backlog/items', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: newTitle, category: newCategory }),
      })
      if (res.ok) {
        const row = await res.json()
        setItems(list => [row as BacklogItem, ...list])
        setNewTitle('')
      }
    } finally { setBusy(false) }
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="bg-white border-b border-stone-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link href="/" className="text-stone-400 hover:text-stone-600 transition-colors">
            <ArrowLeft size={18} />
          </Link>
          <h1 className="text-xl font-semibold text-stone-900" style={{ fontFamily: 'DM Serif Display, serif' }}>
            Backlog
          </h1>
          {busy && <span className="text-xs text-stone-400 ml-auto">Saving…</span>}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        <div className="flex gap-2">
          <input
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addItem() }}
            placeholder="Add something to the pile…"
            className="flex-1 border border-stone-200 rounded-lg px-3 py-2 text-sm"
          />
          <select value={newCategory} onChange={e => setNewCategory(e.target.value)}
            className="border border-stone-200 rounded-lg px-2 py-2 text-sm">
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button onClick={addItem} disabled={busy}
            className="px-3 py-2 rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50">
            <Plus size={16} />
          </button>
        </div>

        {sections.map(section => {
          if (section.items.length === 0) return null
          const collapsed = section.key === 'done' && !showDone
          return (
            <section key={section.key}>
              <button
                className="text-xs font-medium uppercase tracking-wide text-stone-400 mb-2"
                onClick={() => section.key === 'done' && setShowDone(s => !s)}
              >
                {section.title} ({section.items.length}){section.key === 'done' ? (showDone ? ' ▾' : ' ▸') : ''}
              </button>
              {!collapsed && (
                <div className="space-y-2">
                  {section.items.map(it => (
                    <div key={it.id} className="bg-white border border-stone-200 rounded-xl p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium text-stone-900">{it.title}</p>
                          <p className="text-xs text-stone-400 mt-0.5">
                            {it.category}
                            {it.priority > 0 && ` · priority ${it.priority}`}
                            {it.day_pref !== 'any' && ` · ${it.day_pref}`}
                            {!it.time_of_day.includes('any') && ` · ${it.time_of_day.join('/')}`}
                          </p>
                          {it.blocked_by && <p className="text-xs text-amber-600 mt-1">{it.blocked_by}</p>}
                          {it.notes && <p className="text-sm text-stone-500 mt-1">{it.notes}</p>}
                          {it.snooze_until && it.snooze_until > today &&
                            <p className="text-xs text-stone-400 mt-1">snoozed until {it.snooze_until}</p>}
                        </div>
                        <div className="flex shrink-0 gap-1">
                          {section.key !== 'done' && (
                            <button title="Edit tags" onClick={() => setEditingId(id => id === it.id ? null : it.id)}
                              className="p-1.5 rounded-lg text-stone-400 hover:bg-stone-100">
                              <Pencil size={15} />
                            </button>
                          )}
                          {section.key === 'blocked' && (
                            <button title="Arrived / unblock" onClick={() => act(it.id, 'arrived')}
                              className="p-1.5 rounded-lg text-green-600 hover:bg-green-50">
                              <PackageCheck size={15} />
                            </button>
                          )}
                          {(section.key === 'ready' || section.key === 'snoozed') && (
                            <button title="Mark done" onClick={() => act(it.id, 'done')}
                              className="p-1.5 rounded-lg text-green-600 hover:bg-green-50">
                              <Check size={15} />
                            </button>
                          )}
                          {section.key === 'ready' && (
                            <button title="Snooze to tomorrow" onClick={() => act(it.id, 'snooze')}
                              className="p-1.5 rounded-lg text-stone-400 hover:bg-stone-100">
                              <Clock size={15} />
                            </button>
                          )}
                          {section.key === 'snoozed' && (
                            <button title="Un-snooze" onClick={() => savePatch(it.id, { snooze_until: null })}
                              className="p-1.5 rounded-lg text-stone-400 hover:bg-stone-100">
                              <RotateCcw size={15} />
                            </button>
                          )}
                        </div>
                      </div>
                      {editingId === it.id && (
                        <TagEditor
                          item={it}
                          onSave={patch => savePatch(it.id, patch)}
                          onCancel={() => setEditingId(null)}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </main>
    </div>
  )
}
