'use client'
import { useRef, useState } from 'react'
import { Camera, Loader2, Upload, Link2, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { compressImage } from '@/lib/meals/images'

export default function PhotoUploadButton({
  dishId, onUploaded, label = 'Add photo', className = '', variant = 'button',
}: {
  dishId: string
  onUploaded: (url: string) => void
  label?: string
  className?: string
  variant?: 'button' | 'overlay'
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [url, setUrl] = useState('')

  async function savePatch(imageUrl: string) {
    const res = await fetch(`/api/meals/dishes/${dishId}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recipe_image_url: imageUrl }),
    })
    if (!res.ok) throw new Error('Could not save photo')
  }

  async function handleFile(file: File) {
    setBusy(true); setError(null)
    try {
      const blob = await compressImage(file)
      const path = `${dishId}.jpg`
      const { error: upErr } = await supabase.storage.from('dish-images')
        .upload(path, blob, { upsert: true, contentType: 'image/jpeg' })
      if (upErr) throw upErr
      const publicUrl = supabase.storage.from('dish-images').getPublicUrl(path).data.publicUrl
      const finalUrl = `${publicUrl}?v=${Date.now()}`
      await savePatch(finalUrl)
      onUploaded(finalUrl)
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function saveUrl() {
    const u = url.trim()
    if (!u) return
    if (!/^https?:\/\/.+/i.test(u)) { setError('Enter a valid http(s) image URL'); return }
    setBusy(true); setError(null)
    try {
      await savePatch(u)
      onUploaded(u)
      setUrl(''); setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save URL')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />

      {variant === 'overlay' ? (
        <button type="button" onClick={() => setOpen(true)} disabled={busy}
          className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-white/85 backdrop-blur text-stone-700 hover:bg-white disabled:opacity-70 transition-colors ${className}`}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />}
          {busy ? 'Uploading…' : label}
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(true)} disabled={busy}
          className={`flex items-center gap-1.5 text-sm text-orange-600 hover:text-orange-700 disabled:opacity-60 ${className}`}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
          {busy ? 'Uploading…' : label}
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => !busy && setOpen(false)} />
          <div className="relative bg-white rounded-2xl border border-stone-200 shadow-xl w-full max-w-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-stone-800 font-medium" style={{ fontFamily: 'DM Serif Display, serif' }}>Dish photo</h3>
              <button onClick={() => !busy && setOpen(false)} className="p-1 rounded-lg text-stone-400 hover:bg-stone-100" aria-label="Close"><X size={18} /></button>
            </div>

            <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}
              className="w-full flex items-center gap-2 justify-center px-4 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 disabled:opacity-60 text-white text-sm font-medium transition-colors">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
              {busy ? 'Uploading…' : 'Upload from device'}
            </button>

            <div className="flex items-center gap-3 my-4 text-xs text-stone-400">
              <span className="flex-1 h-px bg-stone-200" /> or <span className="flex-1 h-px bg-stone-200" />
            </div>

            <label className="block text-sm text-stone-600 mb-1.5">Paste an image URL</label>
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border border-stone-200 focus-within:border-orange-300">
                <Link2 size={15} className="text-stone-400 shrink-0" />
                <input value={url} onChange={e => setUrl(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveUrl()}
                  placeholder="https://…" autoFocus
                  className="flex-1 min-w-0 bg-transparent text-sm text-stone-800 focus:outline-none" />
              </div>
              <button type="button" onClick={saveUrl} disabled={busy || !url.trim()}
                className="px-3 py-2 rounded-lg bg-stone-800 hover:bg-stone-900 disabled:opacity-40 text-white text-sm">Save</button>
            </div>

            {error && <p className="text-xs text-red-500 mt-3">{error}</p>}
          </div>
        </div>
      )}
    </>
  )
}
