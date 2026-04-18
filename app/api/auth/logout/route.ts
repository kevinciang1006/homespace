import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL('/login', request.url), { status: 302 })
  response.cookies.delete('hs_session')
  return response
}
