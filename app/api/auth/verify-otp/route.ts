import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function POST(request: Request) {
  const { phone, code } = await request.json()

  if (!phone || !code) {
    return Response.json({ error: 'Phone and code are required' }, { status: 400 })
  }

  const now = new Date().toISOString()

  const { data: otp } = await supabase
    .from('otp_codes')
    .select('*')
    .eq('phone', phone)
    .eq('code', code)
    .eq('used', false)
    .gt('expires_at', now)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!otp) {
    return Response.json({ error: 'Invalid or expired code' }, { status: 400 })
  }

  await supabase.from('otp_codes').update({ used: true }).eq('id', otp.id)

  const { data: user } = await supabase
    .from('users')
    .select('id, name, phone')
    .eq('phone', phone)
    .single()

  if (!user) {
    return Response.json({ error: 'User not found' }, { status: 404 })
  }

  const response = NextResponse.json({ success: true, user })
  response.cookies.set('hs_session', user.id, {
    httpOnly: true,
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  })

  return response
}
