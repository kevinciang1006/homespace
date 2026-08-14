'use client'
import { useRef, useState } from 'react'
import { Camera, Loader2 } from 'lucide-react'
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    setBusy(true); setError(null)
    try {
      const blob = await compressImage(file)
      const path = `${dishId}.jpg`
      const { error: upErr } = await supabase.storage.from('dish-images')
        .upload(path, blob, { upsert: true, contentType: 'image/jpeg' })
      if (upErr) throw upErr
      const publicUrl = supabase.storage.from('dish-images').getPublicUrl(path).data.publicUrl
      const url = `${publicUrl}?v=${Date.now()}`
      const res = await fetch(`/api/meals/dishes/${dishId}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recipe_image_url: url }),
      })
      if (!res.ok) throw new Error('Could not save photo URL')
      onUploaded(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const trigger = () => inputRef.current?.click()

  return (
    <>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
      {variant === 'overlay' ? (
        <button type="button" onClick={trigger} disabled={busy}
          className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-white/85 backdrop-blur text-stone-700 hover:bg-white disabled:opacity-70 transition-colors ${className}`}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />}
          {busy ? 'Uploading…' : label}
        </button>
      ) : (
        <button type="button" onClick={trigger} disabled={busy}
          className={`flex items-center gap-1.5 text-sm text-orange-600 hover:text-orange-700 disabled:opacity-60 ${className}`}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
          {busy ? 'Uploading…' : label}
        </button>
      )}
      {error && <span className="text-xs text-red-500 ml-2">{error}</span>}
    </>
  )
}
