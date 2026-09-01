'use client'
import { usePathname } from 'next/navigation'
import VoiceFab from './VoiceFab'

// Present everywhere except /login — mounted once from the root layout so
// it survives navigation between sections instead of remounting (and
// losing its in-memory conversation) on every page change.
export default function AssistantGate() {
  const pathname = usePathname()
  if (pathname === '/login') return null
  return <VoiceFab />
}
