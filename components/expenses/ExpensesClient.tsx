'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { ArrowLeft, Download, RefreshCw, Trash2, Receipt } from 'lucide-react'
import { supabase, type Expense } from '@/lib/supabase'
import { formatCurrency, formatDate, getCurrentMonth } from '@/lib/utils'

export default function ExpensesClient({ initialExpenses }: { initialExpenses: Expense[] }) {
  const [expenses, setExpenses] = useState<Expense[]>(initialExpenses)
  const [filterMonth, setFilterMonth] = useState(getCurrentMonth())
  const [filterBy, setFilterBy] = useState('')
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState('')

  const filtered = useMemo(() => {
    return expenses.filter(e => {
      if (filterMonth) {
        const d = new Date(e.date)
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        if (ym !== filterMonth) return false
      }
      if (filterBy && e.logged_by !== filterBy) return false
      return true
    })
  }, [expenses, filterMonth, filterBy])

  const stats = useMemo(() => {
    const now = new Date()
    const thisMonth = expenses.filter(e => {
      const d = new Date(e.date)
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
    })
    const thisYear = expenses.filter(e => new Date(e.date).getFullYear() === now.getFullYear())
    return {
      monthTotal: thisMonth.reduce((s, e) => s + Number(e.total), 0),
      monthCount: thisMonth.length,
      yearTotal: thisYear.reduce((s, e) => s + Number(e.total), 0),
      total: expenses.length,
    }
  }, [expenses])

  async function refresh() {
    setLoading(true)
    const { data } = await supabase
      .from('expenses')
      .select('*')
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
    setExpenses(data ?? [])
    setLoading(false)
    showToast('Refreshed')
  }

  async function deleteExpense(id: string) {
    if (!confirm('Delete this expense?')) return
    await supabase.from('expenses').delete().eq('id', id)
    setExpenses(prev => prev.filter(e => e.id !== id))
    showToast('Deleted')
  }

  function exportCSV() {
    if (!filtered.length) { showToast('Nothing to export'); return }
    const rows = [['Date', 'Store', 'Items', 'Total', 'Currency', 'Logged By']]
    filtered.forEach(e => {
      const items = (e.items ?? []).map(i => i.name).join(' | ')
      rows.push([e.date, e.store ?? '', items, String(e.total), e.currency, e.logged_by ?? ''])
    })
    const csv = rows.map(r => r.map(v => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `expenses-${filterMonth || 'all'}.csv`
    a.click()
    showToast('Exported!')
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  const memberBadge = (name: string | null) => {
    if (name === 'Kevin') return 'bg-blue-50 text-blue-700'
    if (name === 'Wife') return 'bg-pink-50 text-pink-700'
    return 'bg-stone-100 text-stone-600'
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="bg-white border-b border-stone-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-stone-400 hover:text-stone-600 transition-colors">
              <ArrowLeft size={18} />
            </Link>
            <h1 className="text-xl font-semibold text-stone-900" style={{ fontFamily: 'DM Serif Display, serif' }}>
              Expenses
            </h1>
          </div>
          <div className="flex gap-2">
            <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-stone-200 rounded-lg hover:bg-stone-50 transition-colors text-stone-600">
              <Download size={14} /> Export
            </button>
            <button onClick={refresh} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-stone-200 rounded-lg hover:bg-stone-50 transition-colors text-stone-600">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          {[
            { label: 'This month', value: formatCurrency(stats.monthTotal), sub: `${stats.monthCount} transactions` },
            { label: 'This year', value: formatCurrency(stats.yearTotal), sub: 'all categories' },
            { label: 'Total entries', value: String(stats.total), sub: 'all time' },
            { label: 'Avg per month', value: formatCurrency(stats.yearTotal / (new Date().getMonth() + 1)), sub: 'this year' },
          ].map(s => (
            <div key={s.label} className="bg-white border border-stone-200 rounded-xl p-4">
              <p className="text-xs font-medium text-stone-400 uppercase tracking-wider mb-1">{s.label}</p>
              <p className="text-xl font-semibold text-stone-900" style={{ fontFamily: 'DM Serif Display, serif' }}>{s.value}</p>
              <p className="text-xs text-stone-400 mt-0.5">{s.sub}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="bg-white border border-stone-200 rounded-xl px-4 py-3 mb-4 flex flex-wrap gap-3 items-center">
          <span className="text-sm font-medium text-stone-500">Filter</span>
          <input
            type="month"
            value={filterMonth}
            onChange={e => setFilterMonth(e.target.value)}
            className="text-sm border border-stone-200 rounded-lg px-2.5 py-1.5 bg-stone-50 text-stone-700"
          />
          <select
            value={filterBy}
            onChange={e => setFilterBy(e.target.value)}
            className="text-sm border border-stone-200 rounded-lg px-2.5 py-1.5 bg-stone-50 text-stone-700"
          >
            <option value="">All members</option>
            <option value="Kevin">Kevin</option>
            <option value="Wife">Wife</option>
          </select>
          <button
            onClick={() => { setFilterMonth(''); setFilterBy('') }}
            className="text-sm text-stone-400 hover:text-stone-600 ml-auto transition-colors"
          >
            Clear
          </button>
        </div>

        {/* Table */}
        <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-stone-400">
              <Receipt size={32} className="mb-3 opacity-30" />
              <p className="font-medium">No expenses yet</p>
              <p className="text-sm mt-1">Send a receipt photo on WhatsApp to log one</p>
            </div>
          ) : (
            <>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-stone-100 bg-stone-50">
                    {['Date', 'Store', 'Items', 'Total', 'By', ''].map(h => (
                      <th key={h} className="text-left text-xs font-medium text-stone-400 uppercase tracking-wider px-4 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(e => {
                    const items = e.items ?? []
                    const preview = items.slice(0, 2).map(i => i.name).join(', ')
                    return (
                      <tr key={e.id} className="border-b border-stone-100 last:border-0 hover:bg-stone-50 transition-colors">
                        <td className="px-4 py-3 text-sm text-stone-500 whitespace-nowrap">{formatDate(e.date)}</td>
                        <td className="px-4 py-3">
                          <p className="text-sm font-medium text-stone-900">{e.store ?? '—'}</p>
                          {preview && <p className="text-xs text-stone-400 mt-0.5">{preview}{items.length > 2 ? ` +${items.length - 2}` : ''}</p>}
                        </td>
                        <td className="px-4 py-3 text-sm text-stone-500">{items.length > 0 ? `${items.length} item${items.length !== 1 ? 's' : ''}` : '—'}</td>
                        <td className="px-4 py-3 text-sm font-semibold text-stone-900" style={{ fontFamily: 'DM Serif Display, serif' }}>
                          {formatCurrency(Number(e.total), e.currency)}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-medium px-2 py-1 rounded-full ${memberBadge(e.logged_by)}`}>
                            {e.logged_by ?? '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => deleteExpense(e.id)}
                            className="text-stone-300 hover:text-red-500 transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className="px-4 py-2.5 border-t border-stone-100 bg-stone-50 flex justify-between items-center">
                <span className="text-xs text-stone-400">{filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}</span>
                <span className="text-xs font-medium text-stone-600">
                  Total: {formatCurrency(filtered.reduce((s, e) => s + Number(e.total), 0))}
                </span>
              </div>
            </>
          )}
        </div>
      </main>

      {toast && (
        <div className="fixed bottom-6 right-6 bg-stone-900 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg animate-in fade-in slide-in-from-bottom-2">
          {toast}
        </div>
      )}
    </div>
  )
}
