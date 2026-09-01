'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, Loader2, Volume2, X } from 'lucide-react'
import type { ChatMessage, PendingAction } from '@/lib/assistant/types'

type Mode = 'idle' | 'listening' | 'thinking' | 'speaking'
const HOLD_THRESHOLD_MS = 350

// A tap (down+up under HOLD_THRESHOLD_MS) toggles listening on, then off on
// the NEXT tap. A press-and-hold past the threshold records only while
// held, sending as soon as she lets go — both patterns share the same
// start/stop plumbing below, distinguished purely by how long the pointer
// was down.
export default function VoiceFab() {
  const [mode, setMode] = useState<Mode>('idle')
  const [open, setOpen] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [reply, setReply] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<ChatMessage[]>([])
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const pointerDownAtRef = useRef<number | null>(null)
  const recordingStartedAtRef = useRef<number | null>(null)

  // Live waveform — real mic input via AnalyserNode, not a fake loop. See
  // startAnalyser/stopAnalyser below.
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const barRefs = useRef<(HTMLDivElement | null)[]>([])
  const BAR_COUNT = 20

  // Some browsers populate the voice list asynchronously — nudge it once so
  // speak() below isn't racing an empty list on the very first reply.
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    window.speechSynthesis.getVoices()
  }, [])

  // Reads the mic's real-time frequency data into the bar refs directly
  // (bypassing React state) so the waveform can update every animation
  // frame without a re-render per frame — getByteFrequencyData means the
  // bars genuinely track how loud she's actually speaking, not a canned loop.
  function startAnalyser(stream: MediaStream) {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const audioCtx = new Ctx()
    const source = audioCtx.createMediaStreamSource(stream)
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 64
    analyser.smoothingTimeConstant = 0.6
    source.connect(analyser)
    audioCtxRef.current = audioCtx
    analyserRef.current = analyser
    const data = new Uint8Array(analyser.frequencyBinCount)
    const tick = () => {
      analyser.getByteFrequencyData(data)
      for (let i = 0; i < BAR_COUNT; i++) {
        const level = data[i % data.length] / 255 // 0..1, real mic amplitude for this frequency bin
        const el = barRefs.current[i]
        if (el) el.style.height = `${8 + level * 92}%`
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    tick()
  }

  function stopAnalyser() {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    analyserRef.current = null
    audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
    barRefs.current.forEach(el => { if (el) el.style.height = '8%' })
  }

  useEffect(() => stopAnalyser, [])

  async function startRecording() {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mr = new MediaRecorder(stream)
      chunksRef.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.start()
      mediaRecorderRef.current = mr
      recordingStartedAtRef.current = Date.now()
      startAnalyser(stream)
      setOpen(true)
      setTranscript('')
      setReply('')
      setMode('listening')
    } catch {
      setError("Can't access the microphone — check your browser's mic permission for this site.")
      setOpen(true)
      setMode('idle')
    }
  }

  const stopAndSend = useCallback(async () => {
    const mr = mediaRecorderRef.current
    if (!mr) { setMode('idle'); return }
    stopAnalyser()
    setMode('thinking')
    const durationMs = recordingStartedAtRef.current ? Date.now() - recordingStartedAtRef.current : null
    const audioBlob: Blob = await new Promise(resolve => {
      mr.onstop = () => resolve(new Blob(chunksRef.current, { type: 'audio/webm' }))
      mr.stop()
    })
    streamRef.current?.getTracks().forEach(t => t.stop())
    mediaRecorderRef.current = null
    streamRef.current = null
    recordingStartedAtRef.current = null

    try {
      const form = new FormData()
      form.append('audio', audioBlob, 'audio.webm')
      if (durationMs !== null) form.append('durationMs', String(durationMs))
      const transcribeRes = await fetch('/api/assistant/transcribe', { method: 'POST', body: form })
      const transcribeData = await transcribeRes.json()
      if (!transcribeRes.ok) { setError(transcribeData.error || 'Transcription failed.'); setMode('idle'); return }
      const text = (transcribeData.text ?? '').trim()
      if (!text) { setReply("Didn't catch that — try again?"); setMode('idle'); return }
      setTranscript(text)

      const assistantRes = await fetch('/api/assistant', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: text, history, pendingAction }),
      })
      const data = await assistantRes.json()
      if (!assistantRes.ok) { setError(data.error || 'The assistant had a problem.'); setMode('idle'); return }
      setHistory(data.history ?? history)
      setPendingAction(data.pendingAction ?? null)
      setReply(data.reply ?? '')
      speak(data.reply ?? '', setMode)
    } catch {
      setError('Network error — try again.')
      setMode('idle')
    }
  }, [history, pendingAction])

  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault()
    if (mode === 'idle') {
      pointerDownAtRef.current = Date.now()
      startRecording()
    } else if (mode === 'listening' && pointerDownAtRef.current === null) {
      // Already listening from an earlier quick tap — this tap stops it.
      stopAndSend()
    }
  }
  function onPointerUp() {
    if (mode !== 'listening' || pointerDownAtRef.current === null) return
    const heldFor = Date.now() - pointerDownAtRef.current
    pointerDownAtRef.current = null
    if (heldFor >= HOLD_THRESHOLD_MS) stopAndSend()
    // else: a quick tap — stays listening; the NEXT pointerDown stops it.
  }
  function interrupt() {
    if (mode === 'speaking' && typeof window !== 'undefined') window.speechSynthesis.cancel()
    setMode('idle')
  }

  const meta: Record<Mode, { label: string; className: string }> = {
    idle: { label: 'Tap to talk', className: 'bg-orange-600 hover:bg-orange-700' },
    listening: { label: 'Listening…', className: 'bg-red-500' },
    thinking: { label: 'Thinking…', className: 'bg-stone-500' },
    speaking: { label: 'Speaking…', className: 'bg-green-600' },
  }

  return (
    <>
      {open && (
        <div className="fixed bottom-24 right-4 z-40 w-[calc(100vw-2rem)] max-w-sm bg-white border border-stone-200 rounded-2xl shadow-xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-stone-400 uppercase tracking-wide">{meta[mode].label}</span>
            <button onClick={() => setOpen(false)} className="p-1 rounded-lg text-stone-400 hover:bg-stone-100" aria-label="Close"><X size={16} /></button>
          </div>

          {/* Live waveform — real mic amplitude per bar, set directly via
              refs by the analyser's rAF loop (see startAnalyser), not
              React state, so it can update every frame without re-rendering. */}
          {mode === 'listening' && (
            <div className="flex items-end justify-center gap-[3px] h-14" aria-hidden="true">
              {Array.from({ length: BAR_COUNT }).map((_, i) => (
                <div key={i} ref={el => { barRefs.current[i] = el }}
                  className="w-1.5 rounded-full bg-red-500 transition-[height] duration-75"
                  style={{ height: '8%' }} />
              ))}
            </div>
          )}

          {transcript && <p className="text-sm text-stone-600"><span className="text-stone-400 font-medium">You: </span>{transcript}</p>}
          {mode === 'thinking' && !reply && !error && (
            <p className="text-sm text-stone-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Thinking…</p>
          )}
          {reply && <p className="text-sm text-stone-800">{reply}</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {mode !== 'listening' && !transcript && !reply && !error && (
            <p className="text-sm text-stone-400">
              Tap the mic and ask — shopping, stock, meals, expenses, or backlog.{' '}
              <span className="text-stone-300">Coba: &quot;hapus ayam goreng&quot; atau &quot;tambah stok 1kg ayam&quot;.</span>
            </p>
          )}
        </div>
      )}

      <button
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onClick={mode === 'speaking' ? interrupt : undefined}
        aria-label={meta[mode].label}
        className={`fixed bottom-6 right-4 z-40 w-16 h-16 rounded-full shadow-lg flex items-center justify-center text-white transition-colors ${meta[mode].className} ${mode === 'listening' ? 'animate-pulse' : ''} ${mode === 'speaking' ? 'animate-[speak-pulse_1.1s_ease-in-out_infinite]' : ''}`}
      >
        {mode === 'thinking' ? <Loader2 size={26} className="animate-spin" />
          : mode === 'speaking' ? <Volume2 size={26} />
          : <Mic size={26} />}
      </button>
    </>
  )
}

// Picks an id-ID voice for an Indonesian-looking reply, else the platform
// default — a heuristic (common ID function words), not real language
// detection, but Claude's own reply already matches her spoken language per
// the system prompt, so this only has to catch the common case. Some
// phones have no id-ID voice installed at all; the on-screen text (above)
// is the fallback either way.
const ID_WORD_RE = /\b(yang|untuk|dan|tidak|sudah|akan|nggak|gak|belum|apa|berapa|kamu|saya|ini|itu|dengan|dari|ke|di|sudah|tolong|mau|bisa)\b/i

function speak(text: string, setMode: (m: Mode) => void) {
  if (!text || typeof window === 'undefined' || !('speechSynthesis' in window)) { setMode('idle'); return }
  window.speechSynthesis.cancel()
  const utter = new SpeechSynthesisUtterance(text)
  const voices = window.speechSynthesis.getVoices()
  const isIndonesian = ID_WORD_RE.test(text)
  const voice = isIndonesian
    ? voices.find(v => v.lang.toLowerCase().startsWith('id'))
    : voices.find(v => v.lang.toLowerCase().startsWith('en'))
  if (voice) utter.voice = voice
  utter.lang = isIndonesian ? 'id-ID' : (voice?.lang ?? 'en-US')
  utter.onend = () => setMode('idle')
  utter.onerror = () => setMode('idle')
  setMode('speaking')
  window.speechSynthesis.speak(utter)
}
