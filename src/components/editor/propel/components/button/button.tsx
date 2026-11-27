'use client'

import type * as React from 'react'
import { LoadingOutline } from '@/components/editor/icons'
import { Button as ButtonElement, ButtonLabel, type ButtonProps as ButtonElementProps } from '../../elements/button'
import { Spinner } from '../../internal/spinner'

export type ButtonProps = Omit<ButtonElementProps, 'children'> & {
  /** Icon rendered beside the label (inline-start by default), e.g. `<Icon icon={Plus} />`. */
  icon?: React.ReactNode
  /**
   * Which side of the label the icon sits on. The `loading` spinner takes the same slot.
   *
   * @default "start"
   */
  iconPosition?: 'start' | 'end'
  /** Visible button label. */
  label: string
  /** Shows a spinner in the icon slot, sets `aria-busy`, and makes the button non-interactive. */
  loading?: boolean
  /** Hard, non-focusable native disabled state (`loading` stays focusable instead). */
  disabled?: boolean
  /**
   * The button's form behavior.
   *
   * @default "button"
   */
  type?: 'submit' | 'reset' | 'button'
}

/**
 * The ready-made `Button` of Propel on the Lancity button: lays out an optional `icon` beside the label and swaps it
 * for the `loading` spinner in the same slot.
 */
export function Button({
  icon,
  iconPosition = 'start',
  loading = false,
  disabled,
  type = 'button',
  label,
  ...props
}: ButtonProps) {
  const iconSlot =
    icon != null && loading ? (
      <Spinner>
        <LoadingOutline />
      </Spinner>
    ) : (
      (icon ?? (
        <Spinner active={loading}>
          <LoadingOutline />
        </Spinner>
      ))
    )
  return (
    <ButtonElement
      {...props}
      type={type}
      disabled={disabled || loading}
      focusableWhenDisabled={loading ? true : undefined}
      aria-busy={loading ? true : undefined}
    >
      {iconPosition === 'start' ? iconSlot : null}
      <ButtonLabel>{label}</ButtonLabel>
      {iconPosition === 'end' ? iconSlot : null}
    </ButtonElement>
  )
}
