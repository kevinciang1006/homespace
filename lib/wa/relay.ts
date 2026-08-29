export type SendResult = { ok: true } | { ok: false; error: string }

// Posts one message to the Mac Mini WhatsApp relay (over Tailscale Funnel).
// Not unit-tested — network I/O, same convention as the Google Calendar call
// in app/api/calendar/create-event/route.ts.
//
// Every failure is console.error'd here (not just returned) so the actual
// reason shows up in `vercel logs` / runtime logs even when a caller only
// checks the boolean `.ok` and drops `.error` on the floor.
export async function sendWhatsapp(phone: string, message: string): Promise<SendResult> {
  const url = process.env.WHATSAPP_RELAY_URL
  const secret = process.env.WHATSAPP_RELAY_SECRET
  if (!url || !secret) {
    const error = 'WHATSAPP_RELAY_URL/WHATSAPP_RELAY_SECRET not configured'
    console.error(`[sendWhatsapp] ${error} (url=${url ? 'set' : 'MISSING'}, secret=${secret ? 'set' : 'MISSING'})`)
    return { ok: false, error }
  }

  const endpoint = `${url.replace(/\/+$/, '')}/send-whatsapp`
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: secret, phone, message }),
    })
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '')
      const error = `relay HTTP ${res.status}: ${bodyText.slice(0, 300)}`
      console.error(`[sendWhatsapp] ${error} (endpoint=${endpoint}, phone=${phone})`)
      return { ok: false, error }
    }
    const body = await res.json().catch(() => null)
    if (!body?.ok) {
      const error = `relay response: ${JSON.stringify(body)}`
      console.error(`[sendWhatsapp] ${error} (endpoint=${endpoint}, phone=${phone})`)
      return { ok: false, error }
    }
    return { ok: true }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error(`[sendWhatsapp] fetch threw: ${error} (endpoint=${endpoint}, phone=${phone})`)
    return { ok: false, error }
  }
}
