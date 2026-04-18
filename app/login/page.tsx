'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, type User } from '@/lib/supabase'

export default function LoginPage() {
  const router = useRouter()
  const [users, setUsers] = useState<User[]>([])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('users').select('id, name').then(({ data }) => {
      setUsers((data as User[]) ?? [])
    })
  }, [])

  async function login() {
    if (!selectedUserId || !password) return
    setLoading(true)
    setError('')
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: selectedUserId, password }),
    })
    setLoading(false)
    if (res.ok) {
      router.push('/')
    } else {
      const data = await res.json()
      setError(data.error ?? 'Login failed. Try again.')
    }
  }

  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl text-stone-900 mb-1" style={{ fontFamily: 'DM Serif Display, serif' }}>
            home<span className="text-orange-500 italic">space</span>
          </h1>
          <p className="text-sm text-stone-400">Sign in to your family hub</p>
        </div>

        <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-sm">
          <label className="block text-xs font-medium text-stone-400 uppercase tracking-wider mb-2">
            Who are you?
          </label>
          <select
            value={selectedUserId}
            onChange={e => setSelectedUserId(e.target.value)}
            className="w-full text-sm border border-stone-200 rounded-xl px-3 py-2.5 bg-stone-50 text-stone-700 mb-4 focus:outline-none focus:ring-2 focus:ring-stone-300"
          >
            <option value="">Select a member…</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>

          <label className="block text-xs font-medium text-stone-400 uppercase tracking-wider mb-2">
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && login()}
            placeholder="Enter your password"
            className="w-full text-sm border border-stone-200 rounded-xl px-3 py-2.5 bg-stone-50 text-stone-700 mb-4 focus:outline-none focus:ring-2 focus:ring-stone-300"
          />

          {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

          <button
            onClick={login}
            disabled={!selectedUserId || !password || loading}
            className="w-full py-2.5 rounded-xl bg-stone-900 text-white text-sm font-medium disabled:opacity-40 hover:bg-stone-700 transition-colors"
          >
            {loading ? 'Signing in…' : 'Login'}
          </button>
        </div>
      </div>
    </div>
  )
}
