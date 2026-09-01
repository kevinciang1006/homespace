'use client'
import { useState } from 'react'
import Link from 'next/link'
import { X, Plus, Trash2, ChevronUp, ChevronDown, ExternalLink, Star } from 'lucide-react'
import { SLOT_LABELS, type Dish, type Slot } from '@/lib/meals/types'
import { QTY_UNITS } from '@/lib/meals/qty'
import {
  PROTEINS, TIERS, METHODS, SALTINESS, DIFFICULTY, FRUIT_CONTEXTS, CADENCES,
  PRODUCE_ROLES_BY_SLOT, PREP_TYPES, VEG_STYLES, DIFF_LEVEL, DIFF_COLOR, VISIBLE_SLOTS,
} from '@/lib/meals/dishFields'
import { detectSource, type RecipeLink } from '@/lib/meals/recipeLinks'
import DishImage from './DishImage'
import PhotoUploadButton from './PhotoUploadButton'
import DishIngredientsEditor from './DishIngredientsEditor'
import Portal from '@/components/Portal'

const SOURCE_EMOJI: Record<string, string> = { youtube: '▶️', instagram: '📸', tiktok: '🎵', web: '🔗' }

// A same-styled on/off switch — every boolean field below (active, spicy,
// garnish, dish helper, soup, self-sufficient) used to be its own bespoke
// toggle button in the table; one shared component instead of six copies.
function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className="w-full flex items-center justify-between gap-3 text-left">
      <span className="min-w-0">
        <span className="block text-sm text-stone-700">{label}</span>
        {hint && <span className="block text-xs text-stone-400 leading-snug">{hint}</span>}
      </span>
      <span className={`shrink-0 w-9 h-5 rounded-full transition-colors relative ${checked ? 'bg-orange-500' : 'bg-stone-200'}`}>
        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${checked ? 'left-4' : 'left-0.5'}`} />
      </span>
    </button>
  )
}

// Slide-over editor for a dish's photo, ingredients, and recipe steps.
// Structural edits (add/remove/reorder/category) persist immediately; free-text
// fields persist on blur — matching the app's inline-edit convention.
export default function DishEditorPanel({ dish, onClose, onPatch, onSynced }: {
  dish: Dish
  onClose: () => void
  onPatch: (id: string, fields: Partial<Dish>) => void
  // For fields PhotoUploadButton already persists itself — the caller only
  // needs to sync its own local state, not PATCH again. Defaults to a no-op.
  onSynced?: (id: string, fields: Partial<Dish>) => void
}) {
  const [name, setName] = useState(dish.name)
  const [imageUrl, setImageUrl] = useState(dish.recipe_image_url ?? '')
  const [steps, setSteps] = useState<string[]>(dish.recipe_steps ?? [])
  const [links, setLinks] = useState<RecipeLink[]>(dish.recipe_links ?? [])
  const [newUrl, setNewUrl] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [providesSoup, setProvidesSoup] = useState(dish.provides_soup)
  const [baseKey, setBaseKey] = useState(dish.base_key ?? '')
  const [qtyAmount, setQtyAmount] = useState(dish.qty_amount ?? '')
  const [qtyNote, setQtyNote] = useState(dish.qty_note ?? '')

  function saveName() {
    const trimmed = name.trim()
    if (trimmed && trimmed !== dish.name) onPatch(dish.id, { name: trimmed })
    else setName(dish.name)
  }
  function saveBaseKey() {
    const v = baseKey.trim() || null
    if (v !== dish.base_key) onPatch(dish.id, { base_key: v })
  }
  function saveQtyAmount() {
    const n = qtyAmount === '' ? null : Number(qtyAmount)
    if (n !== dish.qty_amount) onPatch(dish.id, { qty_amount: n === null || Number.isNaN(n) ? null : n })
  }
  function saveQtyNote() {
    const trimmed = qtyNote.trim()
    if (trimmed !== (dish.qty_note ?? '')) onPatch(dish.id, { qty_note: trimmed || null })
  }
  function saveSteps(next: string[]) { setSteps(next); onPatch(dish.id, { recipe_steps: next }) }
  function saveLinks(next: RecipeLink[]) { setLinks(next); onPatch(dish.id, { recipe_links: next }) }
  function addLink() {
    const url = newUrl.trim(); if (!url) return
    saveLinks([...links, { url, title: newTitle.trim() || undefined, source: detectSource(url) }])
    setNewUrl(''); setNewTitle('')
  }
  const removeLink = (i: number) => saveLinks(links.filter((_, idx) => idx !== i))

  const addStep = () => saveSteps([...steps, ''])
  const removeStep = (i: number) => saveSteps(steps.filter((_, idx) => idx !== i))
  const setStep = (i: number, val: string) => setSteps(list => list.map((s, idx) => (idx === i ? val : s)))
  const moveStep = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= steps.length) return
    const next = [...steps];[next[i], next[j]] = [next[j], next[i]]; saveSteps(next)
  }

  return (
    <Portal>
    <div className="fixed inset-0 z-50 flex items-end md:items-stretch md:justify-end">
      <div className="absolute inset-0 bg-black/25" onClick={onClose} />
      <div className="relative bg-white w-full md:w-[30rem] md:h-full rounded-t-2xl md:rounded-none max-h-[92vh] md:max-h-full overflow-y-auto">
        {/* header */}
        <div className="sticky top-0 bg-white border-b border-stone-100 px-5 py-3 flex items-center justify-between z-10">
          <div className="min-w-0 flex-1 mr-2">
            <div className="text-xs text-stone-400">Recipe & ingredients</div>
            <input value={name} onChange={e => setName(e.target.value)} onBlur={saveName}
              onKeyDown={e => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
              aria-label="Dish name"
              className="w-full text-stone-800 font-medium bg-transparent focus:outline-none focus:bg-stone-50 rounded px-0.5 -mx-0.5 truncate" />
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-stone-400 hover:bg-stone-100" aria-label="Close"><X size={18} /></button>
        </div>

        <div className="px-5 py-4 space-y-6">
          {/* image */}
          <section>
            <label className="block text-sm font-medium text-stone-600 mb-2">Photo URL</label>
            <div className="flex items-center gap-3">
              <DishImage imageUrl={imageUrl.trim() || null} protein={dish.protein} name={name}
                className="w-14 h-14 shrink-0" rounded="rounded-xl" iconSize={22} />
              <input value={imageUrl} onChange={e => setImageUrl(e.target.value)}
                onBlur={() => onPatch(dish.id, { recipe_image_url: imageUrl.trim() || null })}
                placeholder="https://…"
                className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-orange-300" />
            </div>
            <div className="mt-2">
              <PhotoUploadButton dishId={dish.id}
                label={imageUrl ? 'Change photo' : 'Add photo'}
                onUploaded={url => { setImageUrl(url); onSynced?.(dish.id, { recipe_image_url: url }) }} />
            </div>
          </section>

          {/* details — everything that used to be its own column in the
              Dishes table now lives here: the table stays a quick-scan
              view (name, group, protein, tier, active, rating), this panel
              is the single place that edits everything else (and
              duplicates the table's kept columns too, so this really is
              "edit everything" in one place). */}
          <section className="space-y-4">
            <h3 className="text-sm font-medium text-stone-600">Details</h3>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-stone-400 mb-1">Group</label>
                <select value={dish.slot} onChange={e => onPatch(dish.id, { slot: e.target.value as Slot })}
                  className="w-full px-2 py-1.5 rounded-lg border border-stone-200 text-sm text-stone-800 focus:outline-none focus:border-orange-300">
                  {VISIBLE_SLOTS.map(s => <option key={s} value={s}>{SLOT_LABELS[s]}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-stone-400 mb-1">Protein</label>
                <select value={dish.protein} onChange={e => onPatch(dish.id, { protein: e.target.value })}
                  className="w-full px-2 py-1.5 rounded-lg border border-stone-200 text-sm text-stone-800 focus:outline-none focus:border-orange-300">
                  {PROTEINS.map(p => <option key={p} value={p}>{p}</option>)}
                  {!PROTEINS.includes(dish.protein) && <option value={dish.protein}>{dish.protein}</option>}
                </select>
              </div>
              <div>
                <label className="block text-xs text-stone-400 mb-1">Tier</label>
                <select value={dish.tier} onChange={e => onPatch(dish.id, { tier: e.target.value as Dish['tier'] })}
                  className="w-full px-2 py-1.5 rounded-lg border border-stone-200 text-sm text-stone-800 focus:outline-none focus:border-orange-300">
                  {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-stone-400 mb-1">Method</label>
                <select value={dish.method ?? ''} onChange={e => onPatch(dish.id, { method: e.target.value || null })}
                  className="w-full px-2 py-1.5 rounded-lg border border-stone-200 text-sm text-stone-800 focus:outline-none focus:border-orange-300">
                  {METHODS.map(m => <option key={m} value={m}>{m || '—'}</option>)}
                  {dish.method && !METHODS.includes(dish.method) && <option value={dish.method}>{dish.method}</option>}
                </select>
              </div>
              <div>
                <label className="block text-xs text-stone-400 mb-1">Saltiness</label>
                <select value={dish.saltiness} onChange={e => onPatch(dish.id, { saltiness: e.target.value as Dish['saltiness'] })}
                  className="w-full px-2 py-1.5 rounded-lg border border-stone-200 text-sm text-stone-800 focus:outline-none focus:border-orange-300">
                  {SALTINESS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-stone-400 mb-1">Prep type</label>
                <select value={dish.prep_type ?? ''} onChange={e => onPatch(dish.id, { prep_type: e.target.value || null })}
                  className="w-full px-2 py-1.5 rounded-lg border border-stone-200 text-sm text-stone-800 focus:outline-none focus:border-orange-300">
                  {PREP_TYPES.map(p => <option key={p} value={p}>{p || '—'}</option>)}
                </select>
              </div>
            </div>

            <Toggle checked={dish.active} onChange={v => onPatch(dish.id, { active: v })}
              label="Active" hint="Whether this dish is in the auto-generation rotation." />

            <div>
              <label className="block text-xs text-stone-400 mb-1">Difficulty</label>
              <div className="flex items-center gap-1.5" role="group" aria-label="Difficulty">
                {DIFFICULTY.map((lvl, i) => (
                  <button key={lvl} onClick={() => onPatch(dish.id, { difficulty: lvl })} aria-label={lvl} title={lvl}
                    className={`w-4 h-4 rounded-full transition-colors ${
                      DIFF_LEVEL[dish.difficulty] >= i + 1 ? DIFF_COLOR[dish.difficulty] : 'bg-stone-200'}`} />
                ))}
                <span className="text-xs text-stone-400 ml-1 capitalize">{dish.difficulty}</span>
              </div>
            </div>

            <div>
              <label className="block text-xs text-stone-400 mb-1">Rating</label>
              <div className="flex gap-0.5">
                {[1, 2, 3, 4, 5].map(n => (
                  <button key={n} onClick={() => onPatch(dish.id, { rating: n })} aria-label={`Rate ${n}`}>
                    <Star size={18} className={n <= dish.rating ? 'fill-amber-400 text-amber-400' : 'text-stone-300'} />
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs text-stone-400 mb-1">Base key</label>
              <input value={baseKey} onChange={e => setBaseKey(e.target.value)} onBlur={saveBaseKey}
                placeholder="e.g. bakso, tahu…" title="Prevents duplicates on one plate — e.g. never a bakso soup + a bakso helper"
                className="w-full px-2.5 py-1.5 rounded-lg border border-stone-200 text-sm text-stone-800 focus:outline-none focus:border-orange-300" />
            </div>

            <div>
              <label className="block text-xs text-stone-400 mb-1">Quantity</label>
              <div className="flex items-center gap-1.5">
                <input type="number" min={0} step="any" value={qtyAmount}
                  onChange={e => setQtyAmount(e.target.value)} onBlur={saveQtyAmount}
                  placeholder="amt"
                  className="w-16 px-2 py-1.5 rounded-lg border border-stone-200 text-sm text-stone-800 focus:outline-none focus:border-orange-300" />
                <select value={dish.qty_unit ?? ''} onChange={e => onPatch(dish.id, { qty_unit: e.target.value || null })}
                  className="px-2 py-1.5 rounded-lg border border-stone-200 text-sm text-stone-800 focus:outline-none focus:border-orange-300">
                  <option value="">—</option>
                  {QTY_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
                <input value={qtyNote} onChange={e => setQtyNote(e.target.value)} onBlur={saveQtyNote}
                  placeholder="note"
                  className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border border-stone-200 text-sm text-stone-800 focus:outline-none focus:border-orange-300" />
              </div>
            </div>

            <Toggle checked={dish.spicy} onChange={v => onPatch(dish.id, { spicy: v })} label="Spicy" />
            <Toggle checked={dish.is_garnish} onChange={v => onPatch(dish.id, { is_garnish: v })} label="Garnish"
              hint="A side note, not an auto-planned dish (e.g. sambal, kerupuk)." />

            {/* fruit-slot specifics */}
            {dish.slot === 'fruit' && (
              <div>
                <label className="block text-xs text-stone-400 mb-1">Fruit context</label>
                <select value={dish.fruit_context ?? ''} onChange={e => onPatch(dish.id, { fruit_context: e.target.value || null })}
                  className="w-full px-2 py-1.5 rounded-lg border border-stone-200 text-sm text-stone-800 focus:outline-none focus:border-orange-300">
                  {FRUIT_CONTEXTS.map(c => <option key={c} value={c}>{c || '—'}</option>)}
                </select>
              </div>
            )}

            {/* fruit/dessert: cadence + produce role */}
            {(dish.slot === 'fruit' || dish.slot === 'desert') && (
              <>
                <div>
                  <label className="block text-xs text-stone-400 mb-1">Cadence</label>
                  <select value={dish.cadence ?? ''} onChange={e => onPatch(dish.id, { cadence: (e.target.value || null) as Dish['cadence'] })}
                    className="w-full px-2 py-1.5 rounded-lg border border-stone-200 text-sm text-stone-800 focus:outline-none focus:border-orange-300">
                    {CADENCES.map(c => <option key={c} value={c}>{c || '—'}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-stone-400 mb-1">Produce role</label>
                  <select value={dish.produce_role ?? ''} onChange={e => onPatch(dish.id, { produce_role: (e.target.value || null) as Dish['produce_role'] })}
                    className="w-full px-2 py-1.5 rounded-lg border border-stone-200 text-sm text-stone-800 focus:outline-none focus:border-orange-300">
                    {PRODUCE_ROLES_BY_SLOT[dish.slot].map(r => <option key={r} value={r}>{r || '—'}</option>)}
                  </select>
                </div>
              </>
            )}

            {/* sayuran/pelengkap: dish-helper toggle */}
            {(dish.slot === 'sayuran' || dish.slot === 'pelengkap') && (
              <Toggle checked={dish.is_dish_helper} onChange={v => onPatch(dish.id, { is_dish_helper: v })}
                label="Dish helper" hint="Fried, easy-to-make appetite helper (Tahu goreng, Bakwan, Telur dadar…)." />
            )}

            {/* sayuran: veg style */}
            {dish.slot === 'sayuran' && (
              <div>
                <label className="block text-xs text-stone-400 mb-1">Veg style</label>
                <select value={dish.veg_style ?? ''} onChange={e => onPatch(dish.id, { veg_style: (e.target.value || null) as Dish['veg_style'] })}
                  className="w-full px-2 py-1.5 rounded-lg border border-stone-200 text-sm text-stone-800 focus:outline-none focus:border-orange-300">
                  {VEG_STYLES.map(v => <option key={v} value={v}>{v || '—'}</option>)}
                </select>
              </div>
            )}

            {/* utama: provides its own soup + self-sufficient main */}
            {dish.slot === 'utama' && (
              <>
                <Toggle checked={providesSoup} onChange={v => { setProvidesSoup(v); onPatch(dish.id, { provides_soup: v }) }}
                  label="🥣 Provides its own soup" hint="A brothy main (tomyam, sup, sop…) — the day skips a separate soup and gets a 2nd vegetable instead." />
                <Toggle checked={dish.self_sufficient_main} onChange={v => onPatch(dish.id, { self_sufficient_main: v })}
                  label="Self-sufficient main" hint="Earns its own soup + veg with no dish-helper — never applies if this main also provides its own soup." />
              </>
            )}
          </section>

          {/* ingredients — normalized (dish_ingredients + ingredients tables) */}
          <DishIngredientsEditor dishId={dish.id} />

          {/* recipe steps */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-stone-600">Recipe steps</h3>
              <button onClick={addStep} className="flex items-center gap-1 text-sm text-orange-600 hover:text-orange-700"><Plus size={15} /> Add step</button>
            </div>
            {steps.length === 0 && <p className="text-sm text-stone-400">No steps yet.</p>}
            <div className="space-y-2">
              {steps.map((s, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <span className="mt-2 shrink-0 w-5 h-5 rounded-full bg-orange-100 text-orange-700 text-[11px] font-semibold flex items-center justify-center">{i + 1}</span>
                  <textarea value={s} onChange={e => setStep(i, e.target.value)} onBlur={() => saveSteps(steps)} rows={2}
                    placeholder="Describe this step…"
                    className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border border-stone-200 text-sm resize-none focus:outline-none focus:border-orange-300" />
                  <div className="flex flex-col shrink-0">
                    <button onClick={() => moveStep(i, -1)} disabled={i === 0} className="p-0.5 text-stone-300 hover:text-stone-600 disabled:opacity-30" aria-label="Move up"><ChevronUp size={14} /></button>
                    <button onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1} className="p-0.5 text-stone-300 hover:text-stone-600 disabled:opacity-30" aria-label="Move down"><ChevronDown size={14} /></button>
                  </div>
                  <button onClick={() => removeStep(i)} className="p-1 mt-1 text-stone-300 hover:text-red-500 shrink-0" aria-label="Remove step"><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
          </section>

          {/* recipe links */}
          <section>
            <h3 className="text-sm font-medium text-stone-600 mb-2">Recipe links</h3>
            {links.length === 0 && <p className="text-sm text-stone-400">No links yet.</p>}
            <div className="space-y-1.5">
              {links.map((l, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="shrink-0">{SOURCE_EMOJI[l.source]}</span>
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-orange-700 hover:underline truncate min-w-0 flex-1">{l.title || l.url}</a>
                  <button onClick={() => removeLink(i)} className="text-stone-300 hover:text-stone-600 shrink-0" aria-label="Remove link">✕</button>
                </div>
              ))}
            </div>
            <div className="mt-2 space-y-1.5">
              <input value={newUrl} onChange={e => setNewUrl(e.target.value)} placeholder="Paste a recipe URL (YouTube, IG, TikTok, web)"
                className="w-full border border-stone-200 rounded-lg px-2.5 py-1.5 text-sm" />
              <div className="flex gap-1.5">
                <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Title (optional)"
                  className="flex-1 border border-stone-200 rounded-lg px-2.5 py-1.5 text-sm" />
                <button onClick={addLink} className="px-3 py-1.5 rounded-lg bg-orange-600 text-white text-sm">Add</button>
              </div>
            </div>
          </section>

          <Link href={`/meals/dish/${dish.id}`} className="inline-flex items-center gap-1 text-sm text-orange-600 hover:text-orange-700">
            View recipe page <ExternalLink size={14} />
          </Link>
        </div>
      </div>
    </div>
    </Portal>
  )
}
