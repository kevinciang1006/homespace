import { NextRequest, NextResponse } from 'next/server'

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  const isPublic = pathname === '/login' || pathname.startsWith('/api/auth/')
  if (isPublic) return NextResponse.next()

  const sessionCookie = request.cookies.get('hs_session')?.value
  if (!sessionCookie) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  try {
    JSON.parse(sessionCookie)
    return NextResponse.next()
  } catch {
    return NextResponse.redirect(new URL('/login', request.url))
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
