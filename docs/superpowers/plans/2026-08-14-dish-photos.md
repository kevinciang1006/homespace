# Dish Photos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every dish a clean protein-derived placeholder plus a real client-compressed photo upload to Supabase Storage, shown wherever dishes render.

**Architecture:** A new `DishImage` component (protein-hued placeholder or the photo) replaces `DishThumb` everywhere. A pure `lib/meals/images.ts` holds the protein palette (`proteinStyle`, unit-tested) and a canvas `compressImage`. A `PhotoUploadButton` compresses in-browser and uploads directly to the public `dish-images` bucket with the anon key, then PATCHes `recipe_image_url`.

**Tech Stack:** Next.js 16.2.4 (App Router), TypeScript (strict), Tailwind v4, Supabase JS (anon, `lib/supabase.ts`), lucide-react, Vitest.

## Global Constraints

- **Read the bundled Next.js docs** (`node_modules/next/dist/docs/`) before route/page edits.
- **Supabase:** shared `supabase` client from `@/lib/supabase`. Anon key. Storage bucket `dish-images` (public read); browser uploads rely on anon insert/update policies (Task 2).
- **Path alias** `@/…`; **dates** local; **design system** stone/orange/DM Serif Display/rounded-xl; **mobile-first**.
- **lucide-react** icons confirmed available: `Fish, Drumstick, Ham, Beef, Shrimp, Egg, Salad, UtensilsCrossed, Camera, Loader2, ImagePlus`.
- **`dishes` PATCH route already allows `recipe_image_url`** (`app/api/meals/dishes/[id]/route.ts`).

---

## File Structure

**Create:**
- `migrations/2026-08-14-dish-images-storage.sql` — bucket + storage policies.
- `lib/meals/images.ts` — `proteinStyle`, `compressImage`.
- `lib/meals/images.test.ts` — `proteinStyle` tests.
- `components/meals/DishImage.tsx` — placeholder/photo tile.
- `components/meals/PhotoUploadButton.tsx` — compress + upload control.

**Modify:**
- `lib/meals/types.ts` — add `protein` to `MealPlan.dishes`.
- `app/meals/page.tsx`, `app/api/meals/week/route.ts`, `app/api/meals/reroll/route.ts`, `app/api/meals/generate/route.ts` — add `protein` to the dish join.
- `components/meals/PlanClient.tsx` — `DishThumb`→`DishImage`; hero photo prompt/upload.
- `components/meals/DishesClient.tsx` — `DishThumb`→`DishImage` (row thumb).
- `components/meals/DishEditorPanel.tsx` — `DishThumb`→`DishImage`; add `PhotoUploadButton`.

**Delete:**
- `components/meals/DishThumb.tsx`.

---

## Task 1: Checkpoint the in-progress layer, then branch

**Files:** none authored — git hygiene so this feature builds on a clean base.

- [ ] **Step 1: Verify the current tree is green**

Run: `npm test` then `npm run build` (sandbox-disabled if the bundler needs a port).
Expected: tests pass; build succeeds. If it fails from the uncommitted layer, STOP and report — do not commit a broken tree.

- [ ] **Step 2: Commit the uncommitted recipe/editor layer as one checkpoint on main**

```bash
git add -A -- app/meals/dish components/meals/RecipeClient.tsx components/meals/DishEditorPanel.tsx \
  components/meals/MealsBottomNav.tsx scripts \
  components/meals/DishesClient.tsx components/meals/MealsTabs.tsx components/meals/ShoppingListClient.tsx \
  app/meals/layout.tsx app/api/meals/dishes app/api/meals/shopping/generate/route.ts \
  lib/meals/shopping.ts lib/meals/shopping.test.ts
git commit -m "chore(meals): checkpoint in-progress recipe/editor layer"
git status --short   # confirm only unrelated files (settings.local, logo.png, *.svg, worktrees) remain
```
(Do NOT `git add .` blindly — leave `.claude/`, `logo.png`, and the stray SVG out.)

- [ ] **Step 3: Branch for this feature**

```bash
git checkout -b feat/dish-photos
```

---

## Task 2: Storage bucket + policies

**Files:**
- Create: `migrations/2026-08-14-dish-images-storage.sql`

**Interfaces:** none (infra). Produces a `dish-images` bucket that accepts anon uploads and serves public reads.

- [ ] **Step 1: Load the supabase skill**

Invoke the `supabase` skill to confirm the exact `storage.objects` policy syntax before writing the SQL.

- [ ] **Step 2: Write the migration SQL**

```sql
-- migrations/2026-08-14-dish-images-storage.sql
-- Public dish photo bucket + browser (anon) upload policies.

insert into storage.buckets (id, name, public)
values ('dish-images', 'dish-images', true)
on conflict (id) do update set public = true;

-- Public read (public buckets serve reads, but make it explicit).
drop policy if exists "dish-images read" on storage.objects;
create policy "dish-images read" on storage.objects
  for select using (bucket_id = 'dish-images');

-- Anon + authenticated may upload and replace (upsert) within this bucket only.
drop policy if exists "dish-images insert" on storage.objects;
create policy "dish-images insert" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'dish-images');

drop policy if exists "dish-images update" on storage.objects;
create policy "dish-images update" on storage.objects
  for update to anon, authenticated
  using (bucket_id = 'dish-images')
  with check (bucket_id = 'dish-images');
```

- [ ] **Step 3: Verify uploads actually work (or instruct the user to run the SQL)**

Write a throwaway probe (run from the project dir so it resolves `@supabase/supabase-js`):
```js
// _probe.mjs  (delete after)
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
const blob = new Blob([new Uint8Array([137,80,78,71])], { type: 'image/jpeg' })
const up = await sb.storage.from('dish-images').upload('__probe.jpg', blob, { upsert: true, contentType: 'image/jpeg' })
console.log('upload:', up.error?.message ?? 'OK')
console.log('publicUrl:', sb.storage.from('dish-images').getPublicUrl('__probe.jpg').data.publicUrl)
await sb.storage.from('dish-images').remove(['__probe.jpg'])
```
Run: `cp _probe.mjs /tmp && node _probe.mjs; rm -f _probe.mjs` (or run in place, then delete).
Expected: `upload: OK`. **If it prints an RLS error**, the policies aren't applied — tell the user to run `migrations/2026-08-14-dish-images-storage.sql` in the Supabase SQL editor (Dashboard → SQL), then re-run the probe. Do not proceed to Task 5's live upload test until this prints OK.

- [ ] **Step 4: Commit**

```bash
git add migrations/2026-08-14-dish-images-storage.sql
git commit -m "feat(meals): add dish-images storage bucket policies"
```

---

## Task 3: images.ts — protein palette + compression

**Files:**
- Create: `lib/meals/images.ts`, `lib/meals/images.test.ts`

**Interfaces:**
- Produces: `proteinStyle(protein: string): { gradient: string; Icon: LucideIcon; label: string }`;
  `compressImage(file: File, maxDim?: number, quality?: number): Promise<Blob>`.

- [ ] **Step 1: Write the failing proteinStyle test**

```ts
// lib/meals/images.test.ts
import { describe, it, expect } from 'vitest'
import { proteinStyle } from './images'

describe('proteinStyle', () => {
  it('maps each known protein to a gradient + icon', () => {
    for (const p of ['fish','chicken','duck','pork','beef','shrimp','crab','squid','egg','tofu_tempe','none','mixed']) {
      const s = proteinStyle(p)
      expect(s.gradient).toMatch(/from-.+ to-.+/)
      expect(s.Icon).toBeTruthy()
      expect(typeof s.label).toBe('string')
    }
  })
  it('falls back to the green/none style for unknown or empty protein', () => {
    expect(proteinStyle('unicorn').gradient).toBe(proteinStyle('none').gradient)
    expect(proteinStyle('').gradient).toBe(proteinStyle('none').gradient)
  })
  it('gives distinct hues to fish vs beef', () => {
    expect(proteinStyle('fish').gradient).not.toBe(proteinStyle('beef').gradient)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- images`
Expected: FAIL — cannot find `./images`.

- [ ] **Step 3: Implement images.ts**

```ts
// lib/meals/images.ts
import { Fish, Drumstick, Ham, Beef, Shrimp, Egg, Salad, UtensilsCrossed, type LucideIcon } from 'lucide-react'

type Style = { gradient: string; Icon: LucideIcon; label: string }

const NONE: Style = { gradient: 'from-green-100 to-lime-100', Icon: Salad, label: 'Veg' }

const PROTEIN_STYLE: Record<string, Style> = {
  fish: { gradient: 'from-sky-100 to-slate-200', Icon: Fish, label: 'Fish' },
  chicken: { gradient: 'from-amber-100 to-orange-100', Icon: Drumstick, label: 'Chicken' },
  duck: { gradient: 'from-amber-100 to-yellow-100', Icon: Drumstick, label: 'Duck' },
  pork: { gradient: 'from-rose-100 to-pink-100', Icon: Ham, label: 'Pork' },
  beef: { gradient: 'from-red-100 to-orange-200', Icon: Beef, label: 'Beef' },
  shrimp: { gradient: 'from-orange-100 to-rose-100', Icon: Shrimp, label: 'Shrimp' },
  crab: { gradient: 'from-orange-100 to-red-100', Icon: Shrimp, label: 'Crab' },
  squid: { gradient: 'from-slate-100 to-slate-200', Icon: Fish, label: 'Squid' },
  egg: { gradient: 'from-yellow-100 to-amber-100', Icon: Egg, label: 'Egg' },
  tofu_tempe: { gradient: 'from-green-100 to-emerald-100', Icon: Salad, label: 'Tofu/Tempe' },
  none: NONE,
  mixed: { gradient: 'from-stone-100 to-stone-200', Icon: UtensilsCrossed, label: 'Mixed' },
}

export function proteinStyle(protein: string): Style {
  return PROTEIN_STYLE[(protein ?? '').trim().toLowerCase()] ?? NONE
}

// Downscale a picked image so the longer side <= maxDim, re-encode as JPEG.
// Browser-only (uses canvas); never called in the node test env.
export async function compressImage(file: File, maxDim = 1200, quality = 0.8): Promise<Blob> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result as string)
    fr.onerror = () => reject(new Error('Could not read file'))
    fr.readAsDataURL(file)
  })
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image()
    im.onload = () => resolve(im)
    im.onerror = () => reject(new Error('Could not decode image'))
    im.src = dataUrl
  })
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
  const w = Math.round(img.width * scale)
  const h = Math.round(img.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, w, h)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not encode image'))), 'image/jpeg', quality)
  })
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- images`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/meals/images.ts lib/meals/images.test.ts
git commit -m "feat(meals): add protein palette and client image compression"
```

---

## Task 4: DishImage component, migrate usages, add protein to joins

**Files:**
- Create: `components/meals/DishImage.tsx`
- Modify: `lib/meals/types.ts`, `app/meals/page.tsx`, `app/api/meals/week/route.ts`, `app/api/meals/reroll/route.ts`, `app/api/meals/generate/route.ts`, `components/meals/PlanClient.tsx`, `components/meals/DishesClient.tsx`, `components/meals/DishEditorPanel.tsx`
- Delete: `components/meals/DishThumb.tsx`

**Interfaces:**
- Produces: `DishImage` with props `{ imageUrl: string | null; protein: string; name?: string; className?: string; rounded?: string; iconSize?: number; showName?: boolean }`.

- [ ] **Step 1: Create DishImage**

```tsx
// components/meals/DishImage.tsx
import { proteinStyle } from '@/lib/meals/images'

export default function DishImage({
  imageUrl, protein, name, className = '', rounded = 'rounded-lg', iconSize = 20, showName = false,
}: {
  imageUrl: string | null
  protein: string
  name?: string
  className?: string
  rounded?: string
  iconSize?: number
  showName?: boolean
}) {
  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={imageUrl} alt={name ?? ''} loading="lazy" className={`object-cover ${rounded} ${className}`} />
  }
  const { gradient, Icon } = proteinStyle(protein)
  return (
    <div className={`bg-gradient-to-br ${gradient} flex flex-col items-center justify-center gap-1 text-stone-500/80 overflow-hidden ${rounded} ${className}`}>
      <Icon size={iconSize} strokeWidth={1.75} className="shrink-0" />
      {showName && name && (
        <span className="px-2 text-center leading-tight text-stone-600 font-medium" style={{ fontFamily: 'DM Serif Display, serif' }}>{name}</span>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add `protein` to the dish join everywhere**

In each of these, add `, protein` inside the `dishes(...)` join:
- `app/meals/page.tsx:18`, `app/api/meals/week/route.ts:11`, `app/api/meals/generate/route.ts:50` — change `recipe_image_url)` → `recipe_image_url, protein)`.
- `app/api/meals/reroll/route.ts:7` — `const SELECT = '*, dishes(tier, spicy, richness, provides_soup, recipe_image_url, protein)'`.

In `lib/meals/types.ts`, extend `MealPlan.dishes`:
```ts
  dishes?: { tier: Tier; spicy: boolean; richness: Richness; provides_soup: boolean; recipe_image_url: string | null; protein: string } | null
```

- [ ] **Step 3: Migrate DishesClient row thumbnail**

In `components/meals/DishesClient.tsx`: change the import `import DishThumb from './DishThumb'` → `import DishImage from './DishImage'`, and the usage:
```tsx
          <DishImage imageUrl={dish.recipe_image_url} protein={dish.protein} name={dish.name}
            className="w-7 h-7 shrink-0" rounded="rounded-md" iconSize={14} />
```

- [ ] **Step 4: Migrate DishEditorPanel preview**

In `components/meals/DishEditorPanel.tsx`: swap the import to `DishImage` and the preview:
```tsx
              <DishImage imageUrl={imageUrl.trim() || null} protein={dish.protein} name={dish.name}
                className="w-14 h-14 shrink-0" rounded="rounded-xl" iconSize={22} />
```

- [ ] **Step 5: Migrate PlanClient (hero large + support small)**

In `components/meals/PlanClient.tsx`: replace `import DishThumb from './DishThumb'` with `import DishImage from './DishImage'`.
- In `MainHero`, replace the `DishThumb` with:
```tsx
        <DishImage imageUrl={row.dishes?.recipe_image_url ?? null} protein={row.dishes?.protein ?? 'none'} name={row.dish_name ?? undefined}
          className="w-full aspect-video" rounded="rounded-none" iconSize={34} showName={!row.dishes?.recipe_image_url} />
```
- In `SupportChip`, replace the `DishThumb` with:
```tsx
        <DishImage imageUrl={row.dishes?.recipe_image_url ?? null} protein={row.dishes?.protein ?? 'none'} name={row.dish_name ?? undefined}
          className="w-full h-14" rounded="rounded-none" iconSize={18} />
```

- [ ] **Step 6: Delete DishThumb**

```bash
git rm components/meals/DishThumb.tsx
```
Then confirm nothing still imports it: `grep -rn "DishThumb" app components lib` → no matches.

- [ ] **Step 7: Typecheck + build**

Run: `npm run build` (sandbox-disabled if needed).
Expected: compiles; no references to `DishThumb`; `protein` present on joins.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(meals): replace DishThumb with protein-aware DishImage"
```

---

## Task 5: PhotoUploadButton + wire into editor and hero

**Files:**
- Create: `components/meals/PhotoUploadButton.tsx`
- Modify: `components/meals/DishEditorPanel.tsx`, `components/meals/PlanClient.tsx`

**Interfaces:**
- Produces: `PhotoUploadButton` with props `{ dishId: string; onUploaded: (url: string) => void; label?: string; className?: string; variant?: 'button' | 'overlay' }`.

- [ ] **Step 1: Create PhotoUploadButton**

```tsx
// components/meals/PhotoUploadButton.tsx
'use client'
import { useRef, useState } from 'react'
import { Camera, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { compressImage } from '@/lib/meals/images'

export default function PhotoUploadButton({
  dishId, onUploaded, label = 'Add photo', className = '', variant = 'button',
}: {
  dishId: string
  onUploaded: (url: string) => void
  label?: string
  className?: string
  variant?: 'button' | 'overlay'
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    setBusy(true); setError(null)
    try {
      const blob = await compressImage(file)
      const path = `${dishId}.jpg`
      const { error: upErr } = await supabase.storage.from('dish-images')
        .upload(path, blob, { upsert: true, contentType: 'image/jpeg' })
      if (upErr) throw upErr
      const publicUrl = supabase.storage.from('dish-images').getPublicUrl(path).data.publicUrl
      const url = `${publicUrl}?v=${Date.now()}`
      const res = await fetch(`/api/meals/dishes/${dishId}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recipe_image_url: url }),
      })
      if (!res.ok) throw new Error('Could not save photo URL')
      onUploaded(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const trigger = () => inputRef.current?.click()

  return (
    <>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
      {variant === 'overlay' ? (
        <button type="button" onClick={trigger} disabled={busy}
          className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-white/85 backdrop-blur text-stone-700 hover:bg-white transition-colors ${className}`}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />}
          {busy ? 'Uploading…' : label}
        </button>
      ) : (
        <button type="button" onClick={trigger} disabled={busy}
          className={`flex items-center gap-1.5 text-sm text-orange-600 hover:text-orange-700 disabled:opacity-60 ${className}`}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
          {busy ? 'Uploading…' : label}
        </button>
      )}
      {error && <span className="text-xs text-red-500 ml-2">{error}</span>}
    </>
  )
}
```

- [ ] **Step 2: Wire into the editor panel**

In `components/meals/DishEditorPanel.tsx`, import the button and add it inside the photo `section` (below the URL input). It updates the local preview + persists via its own PATCH:
```tsx
import PhotoUploadButton from './PhotoUploadButton'
// …inside the photo <section>, after the flex row with the DishImage + input:
            <div className="mt-2">
              <PhotoUploadButton dishId={dish.id}
                label={imageUrl ? 'Change photo' : 'Add photo'}
                onUploaded={url => setImageUrl(url)} />
            </div>
```
(The button already PATCHes `recipe_image_url`; `onUploaded` only syncs the panel's local preview state — no second PATCH.)

- [ ] **Step 3: Wire into the plan hero**

In `components/meals/PlanClient.tsx` `MainHero`, add an upload affordance. Import `PhotoUploadButton`. After the controls `<div>` (lock/shuffle), add:
```tsx
      <div className="absolute bottom-1.5 left-1.5 z-10">
        <PhotoUploadButton dishId={row.dish_id ?? ''} variant="overlay"
          label={row.dishes?.recipe_image_url ? 'Change photo' : '📷 add photo'}
          onUploaded={url => onReplaceCell({ ...row, dishes: { ...(row.dishes ?? { tier: 'everyday', spicy: false, richness: 'medium', provides_soup: false, protein: 'none' }), recipe_image_url: url } as MealPlan['dishes'] })} />
      </div>
```
Guard: only render it when `row.dish_id` exists (skip for empty cells). Wrap in `{row.dish_id && ( … )}`.
Note the `Tier`/`Richness` literals must satisfy the `MealPlan.dishes` type; import types if needed (already imported `MealPlan`, `Tier`). If TS complains about the fallback object shape, build it from the existing `row.dishes` first and only override `recipe_image_url`.

- [ ] **Step 4: Manual verification (dev server)**

Start dev; open `/meals`. With a session cookie / logged in:
- Placeholder hues differ by protein across hero, support chips, and `/meals/dishes` rows and the editor.
- On a photo-less hero, the "📷 add photo" overlay shows; picking an image uploads, and the hero swaps to the photo without reload.
- Open a dish in the editor (Dishes tab) → "Add photo" uploads; the preview + row thumbnail update; the URL field reflects the new URL.
- Re-upload replaces the image (same path, cache-buster refreshes it).
- Rejecting/failing shows an inline error.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(meals): add camera-capable photo upload to editor and plan hero"
```

---

## Task 6: Verification + build

- [ ] **Step 1: Unit tests** — `npm test`; expected all green (images + engine + shopping + dates).
- [ ] **Step 2: Build** — `npm run build`; no type errors; `/meals`, `/meals/dishes`, `/meals/dish/[id]` present.
- [ ] **Step 3: End-to-end pass** — placeholders correct everywhere; upload from editor + hero; photo appears in all three sizes; re-upload replaces; error path; mobile camera capture triggers (`capture="environment"`).
- [ ] **Step 4: Commit any fixes**
```bash
git add -A
git commit -m "fix(meals): resolve build/type issues from dish photos verification"
```

---

## Self-Review Notes (for the planner, not a task)

- **Spec coverage:** storage bucket+policies (T2), protein placeholder DishImage used at 3 sizes (T4), upload flow w/ compression + camera + upsert + URL save + progress/error (T3/T5), hero "add photo" prompt (T5), tests (T3). ✅
- **DishThumb→DishImage:** all 3 usages migrated (PlanClient hero+support, DishesClient row, DishEditorPanel preview) before the file is deleted (T4 Steps 3–6); grep guard prevents a dangling import.
- **protein wiring:** added to all 4 dish joins + `MealPlan.dishes` type so the hero/support placeholders get a hue (T4 Step 2).
- **Progress caveat:** indeterminate "Uploading…" (supabase-js has no byte-progress) — the single accepted deviation, called out in the spec.
- **Type consistency:** `PhotoUploadButton` owns the PATCH; `onUploaded(url)` only lets callers sync UI (editor sets local preview state, hero does an optimistic `onReplaceCell`). No caller double-PATCHes.
