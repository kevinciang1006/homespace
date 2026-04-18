'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Check, Trash2, ShoppingCart } from 'lucide-react'
import { supabase, type ShoppingItem } from '@/lib/supabase'

export default function ShoppingClient({ initialItems }: { initialItems: ShoppingItem[] }) {
  const [items, setItems] = useState<ShoppingItem[]>(initialItems)
  const [newItem, setNewItem] = useState('')
  const [adding, setAdding] = useState(false)

  const refetch = useCallback(async () => {
    const { data } = await supabase
      .from('shopping_items')
      .select('*')
      .order('checked', { ascending: true })
      .order('id', { ascending: false })
    setItems((data as ShoppingItem[]) ?? [])
  }, [])

  useEffect(() => {
    const handleFocus = () => refetch()
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [refetch])

  async function addItem() {
    const name = newItem.trim()
    if (!name) return
    setAdding(true)
    const { data } = await supabase
      .from('shopping_items')
      .insert({ name, checked: false })
      .select()
      .single()
    if (data) setItems(prev => [data as ShoppingItem, ...prev])
    setNewItem('')
    setAdding(false)
  }

  async function toggleItem(item: ShoppingItem) {
    const checked = !item.checked
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, checked } : i))
    await supabase.from('shopping_items').update({ checked }).eq('id', item.id)
  }

  async function clearChecked() {
    const checkedIds = items.filter(i => i.checked).map(i => i.id)
    if (!checkedIds.length) return
    setItems(prev => prev.filter(i => !i.checked))
    await supabase.from('shopping_items').delete().in('id', checkedIds)
  }

  const unchecked = items.filter(i => !i.checked)
  const checked = items.filter(i => i.checked)

  return (
    <div>
      {/* Add item */}
      <div className="flex gap-2 mb-6">
        <input
          type="text"
          value={newItem}
          onChange={e => setNewItem(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addItem()}
          placeholder="Add an item…"
          className="flex-1 text-sm border border-stone-200 rounded-xl px-4 py-2.5 bg-white text-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-300"
        />
        <button
          onClick={addItem}
          disabled={adding || !newItem.trim()}
          className="flex items-center gap-1.5 px-4 py-2.5 text-sm bg-stone-900 text-white rounded-xl hover:bg-stone-700 transition-colors disabled:opacity-40"
        >
          <Plus size={14} /> Add
        </button>
      </div>

      {/* Unchecked items */}
      {unchecked.length === 0 && checked.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-xl flex flex-col items-center justify-center py-16 text-stone-400">
          <ShoppingCart size={32} className="mb-3 opacity-30" />
          <p className="font-medium">List is empty</p>
          <p className="text-sm mt-1">Add items above to get started</p>
        </div>
      ) : (
        <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
          {unchecked.map(item => (
            <div
              key={item.id}
              className="flex items-center gap-3 px-4 py-3 border-b border-stone-100 last:border-0 hover:bg-stone-50 transition-colors"
            >
              <button
                onClick={() => toggleItem(item)}
                className="w-5 h-5 rounded-full border-2 border-stone-300 hover:border-green-500 transition-colors shrink-0 flex items-center justify-center"
              />
              <span className="flex-1 text-sm text-stone-800">{item.name}</span>
              {item.quantity && (
                <span className="text-xs text-stone-400 bg-stone-100 px-2 py-0.5 rounded-full">{item.quantity}</span>
              )}
            </div>
          ))}

          {checked.length > 0 && (
            <>
              <div className="px-4 py-2 bg-stone-50 border-t border-stone-100 flex items-center justify-between">
                <span className="text-xs font-medium text-stone-400 uppercase tracking-wider">
                  Done ({checked.length})
                </span>
                <button
                  onClick={clearChecked}
                  className="flex items-center gap-1 text-xs text-stone-400 hover:text-red-500 transition-colors"
                >
                  <Trash2 size={11} /> Clear
                </button>
              </div>
              {checked.map(item => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 px-4 py-3 border-b border-stone-100 last:border-0 hover:bg-stone-50 transition-colors"
                >
                  <button
                    onClick={() => toggleItem(item)}
                    className="w-5 h-5 rounded-full border-2 border-green-400 bg-green-400 hover:border-stone-300 hover:bg-transparent transition-colors shrink-0 flex items-center justify-center"
                  >
                    <Check size={10} className="text-white" />
                  </button>
                  <span className="flex-1 text-sm text-stone-400 line-through">{item.name}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
