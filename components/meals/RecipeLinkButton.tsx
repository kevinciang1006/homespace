'use client'
import { useState } from 'react'
import { Link2, Plus } from 'lucide-react'
import { detectSource, type RecipeLink } from '@/lib/meals/recipeLinks'
import { useDropdown } from '@/components/useDropdown'
import DropdownBackdrop from '@/components/DropdownBackdrop'

// Self-persisting, like PhotoUploadButton: the caller only needs to sync its
// own local state via onSaved — this button owns the PATCH to the dish.
export default function RecipeLinkButton({ dishId, links, onSaved, iconSize = 11 }: {
  dishId: string; links: RecipeLink[]; onSaved: (next: RecipeLink[]) => void; iconSize?: number
}) {
  const { open, openDropdown, closeDropdown } = useDropdown()
  const [adding, setAdding] = useState(false)
  const [url, setUrl] = useState('')

  async function save(next: RecipeLink[]) {
    onSaved(next)
    await fetch(`/api/meals/dishes/${dishId}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recipe_links: next }),
    })
  }
  function add() {
    const u = url.trim(); if (!u) return
    save([...links, { url: u, source: detectSource(u) }]); setUrl(''); setAdding(false); closeDropdown()
  }
  function click() {
    if (links.length === 1) { window.open(links[0].url, '_blank', 'noopener'); return }
    if (open) closeDropdown(); else openDropdown()
  }
  return (
    <div className="relative">
      <button onClick={click} aria-label="Recipe links"
        className={`p-0.5 rounded bg-white/85 backdrop-blur ${links.length ? 'text-orange-600' : 'text-stone-400 hover:text-stone-700'}`}>
        <Link2 size={iconSize} />
      </button>
      {open && (
        <>
          <DropdownBackdrop onClose={closeDropdown} />
          <div className="absolute z-50 right-0 top-full mt-1 w-44 bg-white border border-stone-200 rounded-xl shadow-lg p-1">
            {links.map((l, i) => (
              <a key={i} href={l.url} target="_blank" rel="noopener noreferrer"
                className="block px-2 py-1 rounded-lg hover:bg-stone-50 text-stone-700 text-xs truncate">{l.title || l.url}</a>
            ))}
            {adding
              ? <div className="flex gap-1 p-1">
                  <input autoFocus value={url} onChange={e => setUrl(e.target.value)} placeholder="Paste URL"
                    className="flex-1 min-w-0 border border-stone-200 rounded px-1.5 py-1 text-xs" />
                  <button onClick={add} className="px-2 rounded bg-orange-600 text-white text-xs">Add</button>
                </div>
              : <button onClick={() => setAdding(true)} className="w-full flex items-center gap-1 px-2 py-1 rounded-lg text-orange-700 text-xs hover:bg-orange-50"><Plus size={11} /> recipe</button>}
          </div>
        </>
      )}
    </div>
  )
}
