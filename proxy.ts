import { NextRequest, NextResponse } from 'next/server'

// Auth is OFF by default (temporary — see AGENTS.md / recent request). Set
// AUTH_ENABLED=true to re-enforce the login requirement; the login code
// itself is untouched, just not enforced while this is unset/false.
const AUTH_ENABLED = process.env.AUTH_ENABLED === 'true'

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  const isPublic = pathname === '/login' || pathname.startsWith('/api/auth/') || pathname.startsWith('/api/wa/cron')
  if (!AUTH_ENABLED || isPublic) return NextResponse.next()

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
