// NEW — Step 0 of the voice-assistant build found no existing Groq/Whisper
// integration anywhere in this codebase (no package, no client, no env
// var referencing it). This is a fresh integration, not a reuse of
// something that already existed here.
//
// Groq's Whisper endpoint is OpenAI-compatible: POST multipart/form-data
// with a `file` field to /openai/v1/audio/transcriptions. No SDK needed
// for one endpoint — a plain fetch keeps this route's bundle small.
const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
const MODEL = 'whisper-large-v3-turbo' // fast + strong multilingual (ID/EN) accuracy; swap to whisper-large-v3 for max accuracy over speed

export async function POST(request: Request) {
  if (!process.env.GROQ_API_KEY) {
    return Response.json({ error: 'GROQ_API_KEY is not configured' }, { status: 500 })
  }

  const incoming = await request.formData().catch(() => null)
  const audio = incoming?.get('audio')
  if (!audio || !(audio instanceof Blob) || audio.size === 0) {
    return Response.json({ error: 'No audio received' }, { status: 400 })
  }
  // A press-and-release with no real speech can still produce a tiny
  // valid-but-empty webm container — not worth a round trip to Groq for.
  if (audio.size < 1000) {
    return Response.json({ text: '' })
  }

  const forward = new FormData()
  forward.append('file', audio, 'audio.webm')
  forward.append('model', MODEL)
  forward.append('response_format', 'json')
  // No `language` pinned — she switches between Indonesian and English
  // sentence to sentence; Whisper's own language detection handles that
  // better than forcing one.

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: forward,
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error('[assistant/transcribe] Groq error:', res.status, body)
    return Response.json({ error: 'Transcription failed' }, { status: 502 })
  }
  const { text } = await res.json() as { text?: string }
  return Response.json({ text: (text ?? '').trim() })
}
