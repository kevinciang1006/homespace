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
