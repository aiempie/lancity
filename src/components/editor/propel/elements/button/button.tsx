'use client'

import type { ComponentProps } from 'react'
import { Button as LancityButton } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Propel's styled button element, rebuilt on the Lancity `Button` (src/components/ui/button.tsx).
// The Propel variant and size names stay so the editor call sites do not change.
export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'ghost' | 'danger' | 'danger-outline'
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'
export type ButtonStretch = 'auto' | 'full'

type LancityButtonProps = ComponentProps<typeof LancityButton>

export const lancityButtonVariant: Record<ButtonVariant, NonNullable<LancityButtonProps['variant']>> = {
  primary: 'default',
  secondary: 'secondary',
  tertiary: 'outline',
  ghost: 'ghost',
  danger: 'destructive',
  'danger-outline': 'destructive'
}

const lancityButtonSize: Record<ButtonSize, NonNullable<LancityButtonProps['size']>> = {
  xs: 'xs',
  sm: 'sm',
  md: 'default',
  lg: 'lg'
}

/** Glyph size read by the Propel icon slot (`--node-size`), per Propel control size. */
export const controlGlyphSize: Record<ButtonSize, string> = {
  xs: '[--node-size:var(--control-glyph-xs)]',
  sm: '[--node-size:var(--control-glyph-sm)]',
  md: '[--node-size:var(--control-glyph-md)]',
  lg: '[--node-size:var(--control-glyph-lg)]'
}

export type ButtonProps = Omit<LancityButtonProps, 'variant' | 'size' | 'className' | 'style'> & {
  variant: ButtonVariant
  size: ButtonSize
  stretch?: ButtonStretch
}

export function Button({ variant, size, stretch = 'auto', ...props }: ButtonProps) {
  return (
    <LancityButton
      variant={lancityButtonVariant[variant]}
      size={lancityButtonSize[size]}
      className={cn(controlGlyphSize[size], stretch === 'full' ? 'w-full' : '')}
      {...props}
    />
  )
}

export type ButtonLabelProps = Omit<ComponentProps<'span'>, 'className' | 'style'>

/** The button's text label. */
export function ButtonLabel(props: ButtonLabelProps) {
  return <span {...props} />
}
