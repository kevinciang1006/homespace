export type SendResult = { ok: true } | { ok: false; error: string }

// Posts one message to the Mac Mini WhatsApp relay (over Tailscale Funnel).
// Not unit-tested — network I/O, same convention as the Google Calendar call
// in app/api/calendar/create-event/route.ts.
export async function sendWhatsapp(phone: string, message: string): Promise<SendResult> {
  const url = process.env.WHATSAPP_RELAY_URL
  const secret = process.env.WHATSAPP_RELAY_SECRET
  if (!url || !secret) return { ok: false, error: 'WHATSAPP_RELAY_URL/WHATSAPP_RELAY_SECRET not configured' }

  try {
    const res = await fetch(`${url}/send-whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: secret, phone, message }),
    })
    if (!res.ok) return { ok: false, error: `relay HTTP ${res.status}` }
    const body = await res.json().catch(() => null)
    if (!body?.ok) return { ok: false, error: `relay response: ${JSON.stringify(body)}` }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
