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

// Groq's Whisper endpoint accepts an optional `prompt` used the same way
// OpenAI's Whisper API does: not an instruction the model follows, but a
// short piece of "prior context" that biases its vocabulary/spelling toward
// words it contains. Homespace's short command words (especially one-word
// utterances like "hapus"/"delete") are exactly the case Whisper mishears
// most, since there's no surrounding sentence to disambiguate — this primes
// it with the app's actual command vocabulary in both languages.
const COMMAND_VOCAB_PROMPT = 'Homespace voice commands. Common words: tambah, hapus, add, delete, ubah, edit, stok, stock, belanja, shopping, resep, dish, menu, masak, cooked, ayam, ikan, udang, babi, sayur, buah, kuah.'

// A recording shorter than this can't contain real speech — a stray tap or
// an accidental double-press. Below it we skip the Groq round trip entirely
// (same reasoning as the byte-size guard below, just duration-based instead
// of size-based, since a very short clip can still exceed 1000 bytes of
// webm container overhead alone).
const MIN_DURATION_MS = 700

// Common Whisper hallucinations on near-silent/no-speech audio — it's a
// captioning model at heart, so silence often decodes to stock captioning
// filler rather than an empty string. Treated the same as "didn't catch
// that" rather than sent to the assistant as a real utterance.
const HALLUCINATION_RE = /^(thank(s| you)( for watching)?\.?|terima kasih( telah| sudah)?( menonton)?\.?|you\.?|bye\.?|\.+)$/i

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
  const durationMsRaw = incoming?.get('durationMs')
  const durationMs = typeof durationMsRaw === 'string' ? Number(durationMsRaw) : null
  if (audio.size < 1000 || (durationMs !== null && Number.isFinite(durationMs) && durationMs < MIN_DURATION_MS)) {
    return Response.json({ text: '' })
  }

  const forward = new FormData()
  forward.append('file', audio, 'audio.webm')
  forward.append('model', MODEL)
  forward.append('response_format', 'json')
  forward.append('prompt', COMMAND_VOCAB_PROMPT)
  // Deterministic/literal output — less room for the model to "helpfully"
  // hallucinate wording on a short or slightly unclear clip.
  forward.append('temperature', '0')
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
  const trimmed = (text ?? '').trim()
  if (!trimmed || HALLUCINATION_RE.test(trimmed)) return Response.json({ text: '' })
  return Response.json({ text: trimmed })
}
