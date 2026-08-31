'use client'
import Portal from './Portal'

// Invisible, full-viewport, portaled to <body> — sits behind the dropdown
// panel (panel needs z-50+ to render above it) so a tap anywhere outside
// the panel closes it. Pair with useDropdown(): render this alongside the
// panel whenever `open` is true, with onClose={closeDropdown}.
export default function DropdownBackdrop({ onClose }: { onClose: () => void }) {
  return (
    <Portal>
      <div className="fixed inset-0 z-40" onClick={onClose} />
    </Portal>
  )
}
