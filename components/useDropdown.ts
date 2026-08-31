import { useEffect, useRef, useState } from 'react'

// At most one dropdown/popover open across the whole app at a time —
// opening a new one closes whichever was already open, instead of letting
// them stack up. Pair with <DropdownBackdrop> (rendered alongside the panel
// while `open`) so a tap anywhere outside it closes it too, matching the
// rest of Homespace's Portal-based sheets (DishEditorPanel, CookLogSheet,
// PlanSidebar's drawer) instead of a bare CSS dropdown that never closes on
// its own.
let activeClose: (() => void) | null = null

export function useDropdown() {
  const [open, setOpen] = useState(false)
  // Stable identity for this instance's own closer — used to tell "the
  // currently active one" apart from "one that's opening right now".
  const closeRef = useRef(() => setOpen(false))

  function openDropdown() {
    if (activeClose && activeClose !== closeRef.current) activeClose()
    activeClose = closeRef.current
    setOpen(true)
  }
  function closeDropdown() {
    if (activeClose === closeRef.current) activeClose = null
    setOpen(false)
  }
  // Unmounting while open (e.g. the row it belongs to disappears) shouldn't
  // leave a dangling reference that blocks the next dropdown from opening.
  useEffect(() => () => { if (activeClose === closeRef.current) activeClose = null }, [])

  return { open, openDropdown, closeDropdown }
}
