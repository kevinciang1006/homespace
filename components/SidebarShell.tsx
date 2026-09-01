'use client'
import { useState } from 'react'
import { Menu, X } from 'lucide-react'
import Portal from './Portal'

// Shared shell for a page's left filter/action sidebar — ONE behavior
// reused across pages (Dishes' filters, the meal Plan page's actions) so
// they stay visually and behaviorally consistent instead of drifting:
//
// Desktop (sm:+): a real sticky column that reserves page width and stays
// visible while the page's own content scrolls past it — NOT an overlay.
// Mobile: no space to spare for a permanent column, so it collapses to a
// small hamburger trigger that opens the same content as a bottom-sheet
// drawer (Portal, dark backdrop, closes on backdrop click — the one place
// this still overlaps the page, same pattern as DishEditorPanel).
export default function SidebarShell({ title, mobileLabel, children }: {
  title: string
  mobileLabel?: string
  children: React.ReactNode
}) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <>
      {/* Mobile trigger — the desktop sidebar below is hidden entirely on
          mobile, so this is the only way in on a small screen. */}
      <button onClick={() => setMobileOpen(true)}
        className="sm:hidden flex items-center gap-1.5 border border-stone-200 text-stone-600 bg-white text-sm font-medium px-3 py-2 rounded-xl">
        <Menu size={15} /> {mobileLabel ?? title}
      </button>

      {mobileOpen && (
        <Portal>
          <div className="fixed inset-0 z-50 sm:hidden flex items-end">
            <div className="absolute inset-0 bg-black/25" onClick={() => setMobileOpen(false)} />
            <div className="relative bg-white w-full rounded-t-2xl max-h-[85vh] overflow-y-auto">
              <div className="sticky top-0 bg-white border-b border-stone-100 px-4 py-3 flex items-center justify-between">
                <span className="text-sm font-semibold text-stone-700">{title}</span>
                <button onClick={() => setMobileOpen(false)} className="p-1.5 rounded-lg text-stone-400 hover:bg-stone-100" aria-label="Close"><X size={18} /></button>
              </div>
              <div className="p-4">{children}</div>
            </div>
          </div>
        </Portal>
      )}

      {/* Desktop sticky sidebar — top-20 clears the app's own sticky page
          header (same offset used elsewhere for a sticky element under
          it); bounded own-height + overflow so a very long filter list
          scrolls itself instead of pushing past the viewport. */}
      <aside className="hidden sm:block w-64 shrink-0">
        <div className="bg-white border border-stone-200 rounded-2xl p-4 sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto">
          <div className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-3">{title}</div>
          {children}
        </div>
      </aside>
    </>
  )
}
