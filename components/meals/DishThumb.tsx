import type { Slot } from '@/lib/meals/types'

const SLOT_EMOJI: Record<Slot, string> = {
  utama: '🍛', kuah: '🍲', pelengkap: '🍤', sayuran: '🥬', desert: '🍮',
}
const SLOT_GRADIENT: Record<Slot, string> = {
  utama: 'from-orange-100 to-amber-100',
  kuah: 'from-amber-100 to-yellow-100',
  pelengkap: 'from-rose-100 to-orange-100',
  sayuran: 'from-green-100 to-emerald-100',
  desert: 'from-pink-100 to-rose-100',
}

// Dish photo with a slot-based gradient + emoji fallback when no recipe_image_url is set.
// Sizing is passed in via `className` (e.g. "w-11 h-11" or "w-full h-40").
export default function DishThumb({
  imageUrl, slot, name, className = '', rounded = 'rounded-lg', emojiClass = 'text-xl',
}: {
  imageUrl: string | null
  slot: Slot
  name?: string
  className?: string
  rounded?: string
  emojiClass?: string
}) {
  if (imageUrl) {
    // Plain <img> is intentional: the app doesn't use next/image and these are
    // arbitrary remote URLs we don't want to enumerate in next.config.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={imageUrl} alt={name ?? ''} loading="lazy" className={`object-cover ${rounded} ${className}`} />
  }
  return (
    <div
      className={`bg-gradient-to-br ${SLOT_GRADIENT[slot]} flex items-center justify-center ${rounded} ${className}`}
      aria-hidden="true"
    >
      <span className={emojiClass}>{SLOT_EMOJI[slot]}</span>
    </div>
  )
}
