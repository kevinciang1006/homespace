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
