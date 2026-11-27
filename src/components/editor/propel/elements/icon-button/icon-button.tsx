'use client'

import type { ComponentProps } from 'react'
import { Button as LancityButton } from '@/components/ui/button'
import { controlGlyphSize, lancityButtonVariant, type ButtonVariant } from '../button/button'

// Propel's square icon-only button box, rebuilt on the Lancity `Button` icon sizes.
export type IconButtonVariant = ButtonVariant
export type IconButtonSize = 'xs' | 'sm' | 'md' | 'lg'

type LancityButtonProps = ComponentProps<typeof LancityButton>

const lancityIconSize: Record<IconButtonSize, NonNullable<LancityButtonProps['size']>> = {
  xs: 'icon-xs',
  sm: 'icon-sm',
  md: 'icon',
  lg: 'icon-lg'
}

export type IconButtonProps = Omit<LancityButtonProps, 'variant' | 'size' | 'className' | 'style'> & {
  variant: IconButtonVariant
  size: IconButtonSize
}

export function IconButton({ variant, size, ...props }: IconButtonProps) {
  return (
    <LancityButton
      variant={lancityButtonVariant[variant]}
      size={lancityIconSize[size]}
      className={controlGlyphSize[size]}
      {...props}
    />
  )
}
