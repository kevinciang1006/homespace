'use client'
import { useEffect } from 'react'
import Portal from './Portal'

// Bottom toast with an Undo action, auto-dismissing after `durationMs`.
// Generic — used wherever a destructive action (delete a meal card, delete
// a shopping-list item) wants a brief grace period rather than a blocking
// confirm() dialog. bottom-20 on mobile clears MealsBottomNav's fixed bar;
// sm:bottom-6 since that bar is sm:hidden.
export default function UndoSnackbar({ message, onUndo, onExpire, durationMs = 5000 }: {
  message: string
  onUndo: () => void
  onExpire: () => void
  durationMs?: number
}) {
  useEffect(() => {
    const t = setTimeout(onExpire, durationMs)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message])

  return (
    <Portal>
      <div className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-[60] bg-stone-900 text-white text-sm rounded-full pl-4 pr-1.5 py-1.5 flex items-center gap-3 shadow-lg max-w-[90vw]">
        <span className="truncate">{message}</span>
        <button onClick={onUndo} className="shrink-0 font-semibold text-orange-300 hover:text-orange-200 px-3 py-1.5 rounded-full hover:bg-white/10">
          Undo
        </button>
      </div>
    </Portal>
  )
}
