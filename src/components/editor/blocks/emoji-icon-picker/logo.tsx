// types
import type { Logo as LogoType } from '@/types/editor/schema'
// local imports
import { getEmojiSize, stringToEmoji } from './helper'
import { LUCIDE_ICONS_LIST } from './lucide-icons'

export type LogoProps = {
  logo?: LogoType
  size?: number
  type?: 'lucide'
}

export function Logo({ logo, size = 16, type = 'lucide' }: LogoProps) {
  // Reusable loading skeleton
  const loadingSkeleton = <span style={{ height: size, width: size }} className='rounded-sm bg-layer-1' />

  // Early returns for loading/empty states
  if (!logo || !logo.in_use) return loadingSkeleton

  const { in_use, emoji, icon } = logo
  const value = in_use === 'emoji' ? emoji?.value : icon?.name

  if (!value) return loadingSkeleton

  // Emoji rendering
  if (in_use === 'emoji') {
    return (
      <span
        className='flex items-center justify-center'
        style={{
          fontSize: `${getEmojiSize(size)}rem`,
          lineHeight: `${getEmojiSize(size)}rem`,
          height: size,
          width: size
        }}
      >
        {stringToEmoji(emoji?.value || '')}
      </span>
    )
  }

  // Icon rendering
  if (in_use === 'icon') {
    const color = icon?.color

    // Lucide icon
    if (type === 'lucide') {
      const lucideIcon = LUCIDE_ICONS_LIST.find(item => item.name === value)
      if (!lucideIcon) return null

      const LucideIconElement = lucideIcon.element
      return <LucideIconElement style={{ color, height: size, width: size }} />
    }
  }

  return null
}
