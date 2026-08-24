'use client'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

// Renders children directly into document.body instead of wherever the
// caller happens to sit in the component tree.
//
// Why this matters: a positioned ancestor with an explicit z-index (e.g. an
// `absolute z-10` icon-row wrapper) creates its own CSS stacking context,
// which caps every descendant — even a `fixed z-50` dialog — to that
// ancestor's rank. A full-screen dialog nested inside one of those wrappers
// can then end up visually BELOW some unrelated `z-10`/`z-20` chip
// elsewhere on the page, because the whole subtree is confined to rank 10
// regardless of the dialog's own z-index. Portaling to <body> sidesteps
// this class of bug entirely: the dialog always renders in the root
// stacking context, so its own z-index is what actually decides the order.
//
// (Mounts client-side only, after hydration, since document isn't
// available during SSR.)
export default function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  if (!mounted) return null
  return createPortal(children, document.body)
}
