import type { Metadata } from 'next'
import './globals.css'
import AssistantGate from '@/components/assistant/AssistantGate'

export const metadata: Metadata = {
  title: 'Homespace',
  description: 'Your family super app',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* suppressHydrationWarning: browser extensions (e.g. ColorZilla's
          cz-shortcut-listen) inject attributes onto <body> before React
          hydrates — a real mismatch, but not one caused by our code, and
          Next.js's own recommended fix for exactly this class of warning. */}
      <body suppressHydrationWarning>
        {children}
        <AssistantGate />
      </body>
    </html>
  )
}
