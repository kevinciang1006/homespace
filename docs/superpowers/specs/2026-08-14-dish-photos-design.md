# Dish Photos — Design

**Date:** 2026-08-14
**Scope:** Add dish photos to the Meal Planner: a protein-derived generated placeholder now, plus a real
client-side-compressed photo upload to Supabase Storage. Replaces the existing `DishThumb` with a new
`DishImage` used everywhere dishes render.

## Pre-work: checkpoint the in-progress layer

The working tree has an uncommitted recipe/editor layer (recipe detail pages `app/meals/dish/[id]`,
`RecipeClient`, `DishEditorPanel`, `MealsBottomNav`, `scripts/seed-dishes.mjs` + `scripts/dish-seed.json`,
and modifications to `DishesClient`, `MealsTabs`, `ShoppingListClient`, `layout.tsx`, the dishes/shopping
routes, `shopping.ts`). Verify `npm test` + `npm run build` pass, then commit it as one checkpoint commit
on `main`, and branch `feat/dish-photos` from there. This feature builds on that layer.

## 1. Supabase Storage: `dish-images` bucket

The bucket already exists. `dishes.recipe_image_url` stores the public URL. For **direct browser upload with
the anon key** (auth is the `hs_session` cookie, not Supabase Auth, so the client acts as `anon`), deliver
`migrations/2026-08-14-dish-images-storage.sql` + dashboard steps ensuring:
- Bucket `dish-images` is **public read**.
- Storage RLS policies scoped to `bucket_id = 'dish-images'` allowing `anon` (and `authenticated`)
  **insert** and **update** (upsert) — and delete is optional. Read is public.

Load the `supabase` skill when authoring the policy SQL to get it exactly right (policies on
`storage.objects`).

Security note: this permits public writes to that one bucket — acceptable for a private family app; the
alternative (server route + service-role key) was declined to avoid adding `SUPABASE_SERVICE_ROLE_KEY`.

## 2. `DishImage` component (replaces `DishThumb`)

`components/meals/DishImage.tsx`:
- If `imageUrl` present → `<img src object-cover loading="lazy" className={rounded+size}>`.
- Else → a **protein-hued gradient tile**: `bg-gradient-to-br <protein gradient>`, a centered lucide icon,
  and (when `showName`) the dish name centered below. `aria-hidden` on pure-decorative variants.
- Props: `{ imageUrl: string | null; protein: string; name?: string; className?: string; rounded?: string;
  iconSize?: number; showName?: boolean }`.

`lib/meals/images.ts` → `proteinStyle(protein: string): { gradient: string; Icon: LucideIcon; label: string }`:

| protein | gradient | icon |
|---|---|---|
| fish | `from-sky-100 to-slate-200` | `Fish` |
| chicken | `from-amber-100 to-orange-100` | `Drumstick` |
| duck | `from-amber-100 to-yellow-100` | `Drumstick` |
| pork | `from-rose-100 to-pink-100` | `Ham` |
| beef | `from-red-100 to-orange-200` | `Beef` |
| shrimp | `from-orange-100 to-rose-100` | `Shrimp` |
| crab | `from-orange-100 to-red-100` | `Shrimp` |
| squid | `from-slate-100 to-slate-200` | `Fish` |
| egg | `from-yellow-100 to-amber-100` | `Egg` |
| tofu_tempe | `from-green-100 to-emerald-100` | `Salad` |
| none / (unknown) | `from-green-100 to-lime-100` | `Salad` |
| mixed | `from-stone-100 to-stone-200` | `UtensilsCrossed` |

(Use only lucide-react icons that exist; verify `Ham`, `Shrimp`, `Drumstick`, `Beef`, `Fish`, `Egg`,
`Salad` are exported in the installed version, else fall back to the closest existing icon.)

Migrate all `DishThumb` usages → `DishImage` and **delete `DishThumb.tsx`**:
- `PlanClient` `MainHero` (large) + `SupportChip` (small).
- `DishesClient` row thumbnail (tiny).
- `DishEditorPanel` preview.

**Wiring:** `MealPlan.dishes` lacks `protein`, so add `protein` to the dish join in the `generate`,
`reroll`, `week` routes and `app/meals/page.tsx`, and to the `MealPlan.dishes` type
(`{ tier, spicy, richness, provides_soup, recipe_image_url, protein }`).

## 3. Photo upload

`lib/meals/images.ts` → `compressImage(file: File, maxDim = 1200, quality = 0.8): Promise<Blob>`:
- Load into an `Image`/`createImageBitmap`, compute scale so the longer side ≤ `maxDim` (never upscale),
  draw onto a `<canvas>`, `canvas.toBlob(resolve, 'image/jpeg', quality)`. Reject on load error.

`components/meals/PhotoUploadButton.tsx` (client):
- Hidden `<input type="file" accept="image/*" capture="environment">` + a trigger (button/label — text via
  `label` prop). `capture="environment"` opens the rear camera on phones.
- Flow on pick: `compressImage` → `supabase.storage.from('dish-images').upload(\`\${dishId}.jpg\`, blob,
  { upsert: true, contentType: 'image/jpeg' })` → `supabase.storage.from('dish-images').getPublicUrl(...)`
  → PATCH `/api/meals/dishes/[id]` with `{ recipe_image_url: \`\${publicUrl}?v=\${Date.now()}\` }`
  (cache-buster so re-uploads refresh) → `onUploaded(url)`.
- States: `idle → uploading (disabled + spinner, "Uploading…") → idle | error (inline text)`.
- **Progress is indeterminate:** supabase-js `.upload` emits no byte-progress; compressed photos are small
  (~100–300 KB), so show a spinner, not a percentage. (Single accepted deviation from "show progress".)
- Props: `{ dishId: string; label?: string; onUploaded: (url: string) => void; className?: string;
  variant?: 'button' | 'overlay' }`.

Placement:
- **`DishEditorPanel`:** `PhotoUploadButton` beside the existing manual-URL field ("Add photo" /
  "Change photo"); on success set panel `imageUrl` state (PATCH already handled by the button).
- **`PlanClient` `MainHero`:** if the main has no `recipe_image_url`, a subtle **"📷 add photo"** overlay
  prompt on the placeholder; if it has one, a "Change photo" affordance among the hero controls. On success,
  optimistically set that row's `dishes.recipe_image_url` so the hero swaps to the photo immediately.

## 4. Testing

- `lib/meals/images.test.ts`: `proteinStyle` returns a defined `gradient` + `Icon` for every known protein
  and falls back to the green/`Salad` default for unknown/empty. (Pure; no canvas.)
- `compressImage` verified manually in-browser (canvas unavailable in the node test env).
- Full `npm test` + `npm run build` green.
- Manual: placeholders show correct hues at hero/support/editor sizes; upload from picker → photo appears
  wherever the dish renders; re-upload replaces; non-image / failure shows an inline error; mobile camera
  capture triggers.

## Non-goals (YAGNI)

- No image cropping/rotation UI (EXIF orientation handled by the browser's decode where it does; not corrected
  manually).
- No per-image CDN transforms; store one compressed JPEG per dish.
- No migration of Storage to a private bucket / signed URLs (public read by design).
- No changes to the recipe/editor layer beyond the DishThumb→DishImage swap and adding the upload control.
