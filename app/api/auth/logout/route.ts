import { NextResponse } from 'next/server'

export async function POST() {
  const response = NextResponse.json({ success: true })
  response.cookies.set('hs_session', '', {
    httpOnly: true,
    path: '/',
    maxAge: 0,
  })
  return response
}
