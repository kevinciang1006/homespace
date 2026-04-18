'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, Plus, Trash2, Archive, RotateCcw, ShoppingCart, ChevronDown } from 'lucide-react'
import type { ShoppingItem, ShoppingGroup } from '@/lib/supabase'

type FilterDays = 7 | 30 | 'all'

function today(): string {
  return new Date().toISOString().split('T')[0]
}

function formatGroupDate(dateStr: string | null): string | null {
  if (!dateStr) return null
  // Parse as local date to avoid timezone shift
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const todayDate = new Date(); todayDate.setHours(0, 0, 0, 0)
  const yesterdayDate = new Date(todayDate); yesterdayDate.setDate(todayDate.getDate() - 1)
  if (date.getTime() === todayDate.getTime()) return 'Today'
  if (date.getTime() === yesterdayDate.getTime()) return 'Yesterday'
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function parseItemInput(input: string): { name: string; quantity: string | null } {
  const trimmed = input.trim()
  const qtyFirst = trimmed.match(/^(\d+(?:\.\d+)?(?:kg|g|l|ml|lbs|oz|x|pcs|packs?|bags?|bottles?|cans?|boxes?)?)\s+(.+)$/i)
  if (qtyFirst) return { name: qtyFirst[2].trim(), quantity: qtyFirst[1].trim() }
  const qtyLast = trimmed.match(/^(.+?)\s+(\d+(?:\.\d+)?(?:kg|g|l|ml|lbs|oz|x|pcs|packs?|bags?|bottles?|cans?|boxes?)?)$/i)
  if (qtyLast) return { name: qtyLast[1].trim(), quantity: qtyLast[2].trim() }
  return { name: trimmed, quantity: null }
}

function ItemRow({ item, onToggle, onUpdate, onDelete }: {
  item: ShoppingItem
  onToggle: () => void
  onUpdate: (fields: Partial<ShoppingItem>) => void
  onDelete: () => void
}) {
  const [editingName, setEditingName] = useState(false)
  const [editingQty, setEditingQty] = useState(false)
  const [nameVal, setNameVal] = useState(item.name)
  const [qtyVal, setQtyVal] = useState(item.quantity ?? '')
  const nameRef = useRef<HTMLInputElement>(null)
  const qtyRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editingName) nameRef.current?.focus() }, [editingName])
  useEffect(() => { if (editingQty) qtyRef.current?.focus() }, [editingQty])

  function saveName() {
    setEditingName(false)
    const name = nameVal.trim()
    if (!name) { setNameVal(item.name); return }
    if (name !== item.name) onUpdate({ name })
  }

  function saveQty() {
    setEditingQty(false)
    const quantity = qtyVal.trim() || null
    if (quantity !== item.quantity) onUpdate({ quantity })
  }

  return (
    <div className="group/item flex items-center gap-2.5 px-4 py-2.5 hover:bg-stone-50 transition-colors border-b border-stone-100 last:border-0">
      <button
        onClick={onToggle}
        className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${
          item.checked
            ? 'border-green-400 bg-green-400 hover:border-stone-300 hover:bg-transparent'
            : 'border-stone-300 hover:border-green-500'
        }`}
      >
        {item.checked && (
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
            <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      <div className="flex-1 flex items-baseline gap-1.5 min-w-0">
        {editingName ? (
          <input
            ref={nameRef}
            value={nameVal}
            onChange={e => setNameVal(e.target.value)}
            onBlur={saveName}
            onKeyDown={e => {
              if (e.key === 'Enter') saveName()
              if (e.key === 'Escape') { setNameVal(item.name); setEditingName(false) }
            }}
            className="flex-1 text-sm bg-stone-100 rounded px-1.5 py-0.5 text-stone-900 outline-none min-w-0"
          />
        ) : (
          <span
            onClick={() => { setNameVal(item.name); setEditingName(true) }}
            className={`text-sm cursor-text truncate transition-colors ${
              item.checked ? 'line-through text-stone-400' : 'text-stone-800'
            }`}
          >
            {item.name}
          </span>
        )}

        {editingQty ? (
          <input
            ref={qtyRef}
            value={qtyVal}
            onChange={e => setQtyVal(e.target.value)}
            onBlur={saveQty}
            onKeyDown={e => {
              if (e.key === 'Enter') saveQty()
              if (e.key === 'Escape') { setQtyVal(item.quantity ?? ''); setEditingQty(false) }
            }}
            placeholder="qty"
            className="w-16 text-xs bg-stone-100 rounded px-1.5 py-0.5 text-stone-500 outline-none shrink-0"
          />
        ) : (
          <span
            onClick={() => { setQtyVal(item.quantity ?? ''); setEditingQty(true) }}
            className={`text-xs cursor-text shrink-0 transition-opacity ${
              item.quantity
                ? 'text-stone-400'
                : 'text-stone-300 opacity-0 group-hover/item:opacity-100'
            }`}
          >
            {item.quantity ?? '+qty'}
          </span>
        )}
      </div>

      <button
        onClick={onDelete}
        className="opacity-0 group-hover/item:opacity-100 p-1 text-stone-300 hover:text-red-500 transition-all shrink-0"
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}

function GroupCard({ group, currentUserId, onUpdate, onArchive, onItemAdd, onItemToggle, onItemUpdate, onItemDelete }: {
  group: ShoppingGroup
  currentUserId: string | null
  onUpdate: (fields: Partial<ShoppingGroup>) => void
  onArchive: () => void
  onItemAdd: (item: ShoppingItem) => void
  onItemToggle: (itemId: string) => void
  onItemUpdate: (itemId: string, fields: Partial<ShoppingItem>) => void
  onItemDelete: (itemId: string) => void
}) {
  const [editingName, setEditingName] = useState(false)
  const [nameVal, setNameVal] = useState(group.name)
  const [addInput, setAddInput] = useState('')
  const [adding, setAdding] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editingName) nameRef.current?.focus() }, [editingName])

  const items = group.shopping_items
  const checkedCount = items.filter(i => i.checked).length
  const allChecked = items.length > 0 && checkedCount === items.length
  const dateLabel = formatGroupDate(group.shopping_date)

  function saveName() {
    setEditingName(false)
    const name = nameVal.trim()
    if (!name) { setNameVal(group.name); return }
    if (name !== group.name) onUpdate({ name })
  }

  async function addItem() {
    const input = addInput.trim()
    if (!input || adding) return
    setAdding(true)
    const { name, quantity } = parseItemInput(input)
    const res = await fetch('/api/shopping/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, quantity, group_id: group.id, added_by: currentUserId }),
    })
    if (res.ok) {
      onItemAdd(await res.json())
      setAddInput('')
    }
    setAdding(false)
  }

  return (
    <div className="bg-white border border-stone-200 rounded-xl shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-stone-100">
        <div className="flex-1 min-w-0">
          {editingName ? (
            <input
              ref={nameRef}
              value={nameVal}
              onChange={e => setNameVal(e.target.value)}
              onBlur={saveName}
              onKeyDown={e => {
                if (e.key === 'Enter') saveName()
                if (e.key === 'Escape') { setNameVal(group.name); setEditingName(false) }
              }}
              className="w-full text-base font-semibold bg-stone-100 rounded px-2 py-0.5 text-stone-900 outline-none"
              style={{ fontFamily: 'DM Serif Display, serif' }}
            />
          ) : (
            <h3
              onClick={() => { setNameVal(group.name); setEditingName(true) }}
              className="text-base font-semibold text-stone-900 cursor-text"
              style={{ fontFamily: 'DM Serif Display, serif' }}
            >
              {group.name}
            </h3>
          )}
          {dateLabel && !editingName && (
            <p className="text-xs text-stone-400 mt-0.5">{dateLabel}</p>
          )}
        </div>

        <span className="text-xs text-stone-400 bg-stone-100 px-2 py-0.5 rounded-full shrink-0">
          {checkedCount}/{items.length} done
        </span>

        {allChecked && (
          <button
            onClick={onArchive}
            className="flex items-center gap-1 text-xs font-medium text-green-600 bg-green-50 hover:bg-green-100 px-2.5 py-1 rounded-full transition-colors shrink-0"
          >
            <Archive size={12} />
            Archive
          </button>
        )}
      </div>

      <div>
        {items.length === 0 ? (
          <p className="text-sm text-stone-400 px-4 py-4 italic">No items yet. Add one below.</p>
        ) : (
          items.map(item => (
            <ItemRow
              key={item.id}
              item={item}
              onToggle={() => onItemToggle(item.id)}
              onUpdate={(fields) => onItemUpdate(item.id, fields)}
              onDelete={() => onItemDelete(item.id)}
            />
          ))
        )}
      </div>

      <div className="px-4 py-2.5 border-t border-stone-100 flex gap-2 items-center">
        <input
          value={addInput}
          onChange={e => setAddInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addItem()}
          placeholder="Add item… (e.g. '2kg apples')"
          className="flex-1 text-sm text-stone-700 placeholder-stone-300 outline-none bg-transparent"
        />
        <button
          onClick={addItem}
          disabled={adding || !addInput.trim()}
          className="text-stone-400 hover:text-stone-700 transition-colors disabled:opacity-30"
        >
          <Plus size={16} />
        </button>
      </div>
    </div>
  )
}

export default function ShoppingClient({
  initialGroups,
  currentUser,
  initialDays,
}: {
  initialGroups: ShoppingGroup[]
  currentUser: { id: string; name: string } | null
  initialDays: FilterDays
}) {
  const [groups, setGroups] = useState<ShoppingGroup[]>(initialGroups)
  const [filterDays, setFilterDays] = useState<FilterDays>(initialDays)
  const [loadingFilter, setLoadingFilter] = useState(false)
  const [showNewGroup, setShowNewGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [archivedExpanded, setArchivedExpanded] = useState(false)
  const newGroupRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (showNewGroup) newGroupRef.current?.focus() }, [showNewGroup])

  const fetchGroups = useCallback(async (days: FilterDays) => {
    setLoadingFilter(true)
    const res = await fetch(`/api/shopping/groups?days=${days}`)
    if (res.ok) setGroups(await res.json())
    setLoadingFilter(false)
  }, [])

  async function changeFilter(days: FilterDays) {
    setFilterDays(days)
    await fetchGroups(days)
  }

  const activeGroups = groups.filter(g => !g.archived)
  const archivedGroups = groups
    .filter(g => g.archived)
    .sort((a, b) => new Date(b.archived_at!).getTime() - new Date(a.archived_at!).getTime())

  async function createGroup() {
    const name = newGroupName.trim()
    if (!name || creatingGroup) return
    setCreatingGroup(true)
    const res = await fetch('/api/shopping/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, created_by: currentUser?.id ?? null, shopping_date: today() }),
    })
    if (res.ok) {
      const group = await res.json()
      setGroups(prev => [{ ...group, shopping_items: [] }, ...prev])
      setNewGroupName('')
      setShowNewGroup(false)
    }
    setCreatingGroup(false)
  }

  async function updateGroup(groupId: string, fields: Partial<ShoppingGroup>) {
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, ...fields } : g))
    await fetch(`/api/shopping/groups/${groupId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    })
  }

  async function archiveGroup(groupId: string) {
    const archived_at = new Date().toISOString()
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, archived: true, archived_at } : g))
    await fetch(`/api/shopping/groups/${groupId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: true, archived_at }),
    })
    setArchivedExpanded(true)
  }

  async function restoreGroup(groupId: string) {
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, archived: false, archived_at: null } : g))
    await fetch(`/api/shopping/groups/${groupId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: false, archived_at: null }),
    })
  }

  function addItemToGroup(groupId: string, item: ShoppingItem) {
    setGroups(prev => prev.map(g =>
      g.id === groupId ? { ...g, shopping_items: [...g.shopping_items, item] } : g
    ))
  }

  async function toggleItem(groupId: string, itemId: string) {
    const item = groups.find(g => g.id === groupId)?.shopping_items.find(i => i.id === itemId)
    if (!item) return
    const checked = !item.checked
    setGroups(prev => prev.map(g => g.id === groupId ? {
      ...g,
      shopping_items: g.shopping_items.map(i => i.id === itemId ? { ...i, checked } : i),
    } : g))
    await fetch(`/api/shopping/items/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checked }),
    })
  }

  async function updateItem(groupId: string, itemId: string, fields: Partial<ShoppingItem>) {
    setGroups(prev => prev.map(g => g.id === groupId ? {
      ...g,
      shopping_items: g.shopping_items.map(i => i.id === itemId ? { ...i, ...fields } : i),
    } : g))
    await fetch(`/api/shopping/items/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    })
  }

  async function deleteItem(groupId: string, itemId: string) {
    setGroups(prev => prev.map(g => g.id === groupId ? {
      ...g,
      shopping_items: g.shopping_items.filter(i => i.id !== itemId),
    } : g))
    await fetch(`/api/shopping/items/${itemId}`, { method: 'DELETE' })
  }

  const filterButtons: { label: string; value: FilterDays }[] = [
    { label: 'This week', value: 7 },
    { label: 'This month', value: 30 },
    { label: 'All', value: 'all' },
  ]

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="bg-white border-b border-stone-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-stone-400 hover:text-stone-600 transition-colors">
              <ArrowLeft size={18} />
            </Link>
            <h1 className="text-xl font-semibold text-stone-900" style={{ fontFamily: 'DM Serif Display, serif' }}>
              Shopping List
            </h1>
          </div>
          <button
            onClick={() => { setShowNewGroup(v => !v); setNewGroupName('') }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-stone-900 text-white rounded-lg hover:bg-stone-700 transition-colors"
          >
            <Plus size={14} /> New Group
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8 space-y-4">
        {/* Filter bar */}
        <div className="bg-white border border-stone-200 rounded-xl px-4 py-3 flex items-center gap-2">
          <span className="text-sm font-medium text-stone-500 mr-1">Show</span>
          {filterButtons.map(({ label, value }) => (
            <button
              key={value}
              onClick={() => changeFilter(value)}
              disabled={loadingFilter}
              className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${
                filterDays === value
                  ? 'bg-stone-900 text-white'
                  : 'text-stone-500 hover:bg-stone-100'
              }`}
            >
              {label}
            </button>
          ))}
          {loadingFilter && (
            <span className="text-xs text-stone-400 ml-auto">Loading…</span>
          )}
        </div>

        {/* New group input */}
        {showNewGroup && (
          <div className="bg-white border-2 border-stone-900 rounded-xl px-4 py-3 flex gap-2 items-center">
            <input
              ref={newGroupRef}
              value={newGroupName}
              onChange={e => setNewGroupName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') createGroup()
                if (e.key === 'Escape') { setShowNewGroup(false); setNewGroupName('') }
              }}
              placeholder="Group name… (press Enter to create)"
              className="flex-1 text-sm font-semibold text-stone-900 outline-none bg-transparent"
              style={{ fontFamily: 'DM Serif Display, serif' }}
            />
            <button
              onClick={createGroup}
              disabled={creatingGroup || !newGroupName.trim()}
              className="text-stone-400 hover:text-stone-700 disabled:opacity-30 transition-colors"
            >
              <Plus size={16} />
            </button>
          </div>
        )}

        {/* Active groups */}
        {activeGroups.length === 0 && !showNewGroup ? (
          <div className="flex flex-col items-center justify-center py-20 text-stone-400">
            <ShoppingCart size={36} className="mb-3 opacity-30" />
            <p className="font-medium">No shopping lists</p>
            <p className="text-sm mt-1">
              {filterDays !== 'all' ? 'Try a wider date range, or create a new group' : 'Hit "New Group" to create one'}
            </p>
          </div>
        ) : (
          activeGroups.map(group => (
            <GroupCard
              key={group.id}
              group={group}
              currentUserId={currentUser?.id ?? null}
              onUpdate={(fields) => updateGroup(group.id, fields)}
              onArchive={() => archiveGroup(group.id)}
              onItemAdd={(item) => addItemToGroup(group.id, item)}
              onItemToggle={(itemId) => toggleItem(group.id, itemId)}
              onItemUpdate={(itemId, fields) => updateItem(group.id, itemId, fields)}
              onItemDelete={(itemId) => deleteItem(group.id, itemId)}
            />
          ))
        )}

        {/* Archived section */}
        {archivedGroups.length > 0 && (
          <div className="pt-2">
            <button
              onClick={() => setArchivedExpanded(v => !v)}
              className="flex items-center gap-2 text-sm font-medium text-stone-400 hover:text-stone-600 transition-colors mb-3"
            >
              <ChevronDown
                size={16}
                className={`transition-transform duration-200 ${archivedExpanded ? '' : '-rotate-90'}`}
              />
              Archived ({archivedGroups.length})
            </button>

            {archivedExpanded && (
              <div className="space-y-2">
                {archivedGroups.map(group => (
                  <div
                    key={group.id}
                    className="bg-white border border-stone-200 rounded-xl px-4 py-3 flex items-center justify-between"
                  >
                    <div>
                      <p className="text-sm font-medium text-stone-500">{group.name}</p>
                      <p className="text-xs text-stone-400 mt-0.5">
                        {group.shopping_items.length} item{group.shopping_items.length !== 1 ? 's' : ''} · archived{' '}
                        {group.archived_at
                          ? new Date(group.archived_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                          : ''}
                      </p>
                    </div>
                    <button
                      onClick={() => restoreGroup(group.id)}
                      className="flex items-center gap-1 text-xs text-stone-500 hover:text-stone-800 border border-stone-200 hover:border-stone-300 px-2.5 py-1 rounded-full transition-colors shrink-0"
                    >
                      <RotateCcw size={11} />
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
