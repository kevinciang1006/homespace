import { supabase } from '@/lib/supabase'

export async function POST(request: Request) {
  const { phone } = await request.json()

  if (!phone) {
    return Response.json({ error: 'Phone is required' }, { status: 400 })
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString()
  const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  const RELAY_URL = process.env.WHATSAPP_RELAY_URL
  const RELAY_SECRET = process.env.WHATSAPP_RELAY_SECRET

  await supabase.from('otp_codes').insert({ phone, code, expires_at, used: false })

  try {
    const res = await fetch(`${RELAY_URL}/send-whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: RELAY_SECRET,
        phone,
        message: `Your Homespace OTP is ${code}. Valid for 10 minutes.`
      })
    })
    if (!res.ok) {
      console.error('[OTP] Relay error:', await res.text())
    }
  } catch (err) {
    console.log(`[OTP FALLBACK] ${phone}: ${code}`)
  }

  return Response.json({ success: true })
}
