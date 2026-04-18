'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, type User } from '@/lib/supabase'

export default function LoginPage() {
  const router = useRouter()
  const [users, setUsers] = useState<User[]>([])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [otp, setOtp] = useState('')
  const [step, setStep] = useState<'select' | 'otp'>('select')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('users').select('id, name, phone').then(({ data }) => {
      setUsers((data as User[]) ?? [])
    })
  }, [])

  const selectedUser = users.find(u => u.id === selectedUserId)

  async function sendOTP() {
    if (!selectedUser) return
    setLoading(true)
    setError('')
    const res = await fetch('/api/auth/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: selectedUser.phone }),
    })
    setLoading(false)
    if (res.ok) {
      setStep('otp')
    } else {
      setError('Failed to send OTP. Try again.')
    }
  }

  async function verifyOTP() {
    if (!selectedUser || !otp) return
    setLoading(true)
    setError('')
    const res = await fetch('/api/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: selectedUser.phone, code: otp }),
    })
    setLoading(false)
    if (res.ok) {
      router.push('/')
    } else {
      const data = await res.json()
      setError(data.error ?? 'Invalid code. Try again.')
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
          {step === 'select' ? (
            <>
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

              {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

              <button
                onClick={sendOTP}
                disabled={!selectedUserId || loading}
                className="w-full py-2.5 rounded-xl bg-stone-900 text-white text-sm font-medium disabled:opacity-40 hover:bg-stone-700 transition-colors"
              >
                {loading ? 'Sending…' : 'Send OTP via WhatsApp'}
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-stone-500 mb-4">
                Code sent to <span className="font-medium text-stone-700">{selectedUser?.name}</span>'s WhatsApp.
              </p>

              <label className="block text-xs font-medium text-stone-400 uppercase tracking-wider mb-2">
                Enter 6-digit code
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={otp}
                onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="w-full text-center text-2xl tracking-widest border border-stone-200 rounded-xl px-3 py-3 bg-stone-50 text-stone-900 mb-4 focus:outline-none focus:ring-2 focus:ring-stone-300"
                style={{ fontFamily: 'DM Serif Display, serif' }}
              />

              {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

              <button
                onClick={verifyOTP}
                disabled={otp.length !== 6 || loading}
                className="w-full py-2.5 rounded-xl bg-stone-900 text-white text-sm font-medium disabled:opacity-40 hover:bg-stone-700 transition-colors mb-3"
              >
                {loading ? 'Verifying…' : 'Verify'}
              </button>

              <button
                onClick={() => { setStep('select'); setOtp(''); setError('') }}
                className="w-full py-2 text-sm text-stone-400 hover:text-stone-600 transition-colors"
              >
                ← Back
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
