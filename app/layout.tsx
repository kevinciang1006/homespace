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
      <body>
        {children}
        <AssistantGate />
      </body>
    </html>
  )
}
