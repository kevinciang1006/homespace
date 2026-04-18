'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Calendar, MapPin, Users, Plus, X, Link as LinkIcon } from 'lucide-react'
import { type CalendarEvent } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'

type Guest = { name: string; email: string }

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

function EventCard({ event }: { event: CalendarEvent }) {
  return (
    <div className="bg-white border border-stone-200 rounded-xl p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
          <Calendar size={15} className="text-blue-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-stone-900 text-sm">{event.title}</p>
          <p className="text-xs text-stone-400 mt-0.5">
            {formatDate(event.start_at.slice(0, 10))} · {formatTime(event.start_at)} – {formatTime(event.end_at)}
          </p>
          {event.location && (
            <p className="text-xs text-stone-500 flex items-center gap-1 mt-1">
              <MapPin size={11} /> {event.location}
            </p>
          )}
          {(event.guests ?? []).length > 0 && (
            <p className="text-xs text-stone-500 flex items-center gap-1 mt-0.5">
              <Users size={11} /> {event.guests!.length} guest{event.guests!.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function AddEventModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const [location, setLocation] = useState('')
  const [guests, setGuests] = useState<Guest[]>([])
  const [guestName, setGuestName] = useState('')
  const [guestEmail, setGuestEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function addGuest() {
    if (!guestName || !guestEmail) return
    setGuests(prev => [...prev, { name: guestName, email: guestEmail }])
    setGuestName('')
    setGuestEmail('')
  }

  async function submit() {
    if (!title || !startAt || !endAt) { setError('Title, start, and end are required'); return }
    setLoading(true)
    setError('')
    const res = await fetch('/api/calendar/create-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description, start_at: startAt, end_at: endAt, location, guests }),
    })
    setLoading(false)
    if (res.ok) {
      onCreated()
    } else {
      const data = await res.json()
      setError(data.error ?? 'Failed to create event')
    }
  }

  const inputCls = 'w-full text-sm border border-stone-200 rounded-lg px-3 py-2 bg-stone-50 text-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-300'
  const labelCls = 'block text-xs font-medium text-stone-400 uppercase tracking-wider mb-1'

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-black/25" onClick={onClose} />
      <div className="relative w-full md:max-w-md bg-white rounded-t-2xl md:rounded-2xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg text-stone-900" style={{ fontFamily: 'DM Serif Display, serif' }}>Add Event</h2>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className={labelCls}>Title</label>
            <input className={inputCls} value={title} onChange={e => setTitle(e.target.value)} placeholder="Event name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Start</label>
              <input type="datetime-local" className={inputCls} value={startAt} onChange={e => setStartAt(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>End</label>
              <input type="datetime-local" className={inputCls} value={endAt} onChange={e => setEndAt(e.target.value)} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Location</label>
            <input className={inputCls} value={location} onChange={e => setLocation(e.target.value)} placeholder="Optional" />
          </div>
          <div>
            <label className={labelCls}>Description</label>
            <textarea className={inputCls + ' resize-none'} rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional" />
          </div>

          <div>
            <label className={labelCls}>Guests</label>
            {guests.length > 0 && (
              <div className="mb-2 space-y-1">
                {guests.map((g, i) => (
                  <div key={i} className="flex items-center justify-between text-xs bg-stone-50 rounded-lg px-3 py-1.5">
                    <span className="text-stone-700">{g.name} · {g.email}</span>
                    <button onClick={() => setGuests(prev => prev.filter((_, j) => j !== i))} className="text-stone-400 hover:text-red-500 ml-2">
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input className={inputCls} value={guestName} onChange={e => setGuestName(e.target.value)} placeholder="Name" />
              <input className={inputCls} value={guestEmail} onChange={e => setGuestEmail(e.target.value)} placeholder="Email" />
              <button onClick={addGuest} className="shrink-0 px-3 py-2 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors">
                <Plus size={14} />
              </button>
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-red-500 mt-3">{error}</p>}

        <button
          onClick={submit}
          disabled={loading}
          className="mt-5 w-full py-2.5 rounded-xl bg-stone-900 text-white text-sm font-medium disabled:opacity-40 hover:bg-stone-700 transition-colors"
        >
          {loading ? 'Creating…' : 'Create Event'}
        </button>
      </div>
    </div>
  )
}

export default function CalendarClient({
  connected,
  events,
}: {
  connected: boolean
  events: CalendarEvent[]
}) {
  const router = useRouter()
  const [showModal, setShowModal] = useState(false)

  if (!connected) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center mb-4">
          <Calendar size={24} className="text-blue-600" />
        </div>
        <h2 className="text-xl text-stone-900 mb-2" style={{ fontFamily: 'DM Serif Display, serif' }}>
          Connect Google Calendar
        </h2>
        <p className="text-sm text-stone-400 mb-6 max-w-xs">
          Link your Google Calendar to create and manage family events from here.
        </p>
        <a
          href="/api/calendar/connect"
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-stone-900 text-white text-sm font-medium hover:bg-stone-700 transition-colors"
        >
          <LinkIcon size={14} /> Connect Google Calendar
        </a>
      </div>
    )
  }

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-stone-500">
          {events.length === 0 ? 'No upcoming events' : `${events.length} upcoming event${events.length !== 1 ? 's' : ''}`}
        </p>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-stone-900 text-white rounded-lg hover:bg-stone-700 transition-colors"
        >
          <Plus size={14} /> Add Event
        </button>
      </div>

      {events.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-xl py-16 flex flex-col items-center text-stone-400">
          <Calendar size={32} className="mb-3 opacity-30" />
          <p className="font-medium">Nothing coming up</p>
          <p className="text-sm mt-1">Add an event to get started</p>
        </div>
      ) : (
        <div className="space-y-3">
          {events.map(event => <EventCard key={event.id} event={event} />)}
        </div>
      )}

      {showModal && (
        <AddEventModal
          onClose={() => setShowModal(false)}
          onCreated={() => { setShowModal(false); router.refresh() }}
        />
      )}
    </>
  )
}
