import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import bcrypt from 'bcryptjs'

export async function POST(request: Request) {
  const { userId, password } = await request.json()

  if (!userId || !password) {
    return Response.json({ error: 'userId and password are required' }, { status: 400 })
  }

  const { data: user } = await supabase
    .from('users')
    .select('id, name, phone, password_hash')
    .eq('id', userId)
    .single()

  if (!user?.password_hash) {
    return Response.json({ error: 'Invalid password' }, { status: 401 })
  }

  const match = await bcrypt.compare(password, user.password_hash)
  if (!match) {
    return Response.json({ error: 'Invalid password' }, { status: 401 })
  }

  const response = NextResponse.json({ success: true, user: { id: user.id, name: user.name } })
  response.cookies.set('hs_session', JSON.stringify({ id: user.id, name: user.name, phone: user.phone }), {
    httpOnly: true,
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  })

  return response
}
