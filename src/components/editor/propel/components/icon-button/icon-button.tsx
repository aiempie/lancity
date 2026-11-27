'use client'

import type * as React from 'react'
import { LoadingOutline } from '@/components/editor/icons'
import {
  IconButton as IconButtonElement,
  type IconButtonProps as IconButtonElementProps
} from '../../elements/icon-button'
import { Spinner } from '../../internal/spinner'
import { Tooltip } from '../tooltip'

export type IconButtonProps = Omit<IconButtonElementProps, 'children'> & {
  /** The single icon element to render, usually `<Icon icon={...} />`. The accessible name comes from `aria-label`. */
  icon: React.ReactNode
  /** Required: icon-only buttons have no visible text, so they must be labeled. */
  'aria-label': string
  /**
   * Show the accessible label in a tooltip on hover or focus. Set false when a caller supplies its own tooltip.
   *
   * @default true
   */
  showTooltip?: boolean
  /** Shows a spinner in place of the icon, sets `aria-busy`, and makes the button non-interactive. */
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
 * The ready-made icon-only button of Propel on the Lancity button. An `aria-label` is required for the accessible
 * name and appears in a tooltip by default.
 */
export function IconButton({
  'aria-label': ariaLabel,
  showTooltip = true,
  icon,
  loading = false,
  disabled,
  type = 'button',
  ...props
}: IconButtonProps) {
  const button = (
    <IconButtonElement
      {...props}
      aria-label={ariaLabel}
      type={type}
      disabled={disabled || loading}
      focusableWhenDisabled={loading ? true : undefined}
      aria-busy={loading ? true : undefined}
    >
      {loading ? (
        <Spinner>
          <LoadingOutline />
        </Spinner>
      ) : (
        icon
      )}
    </IconButtonElement>
  )

  return (
    <Tooltip
      label={ariaLabel}
      disabled={!showTooltip}
      onOpenChange={(_, details) => {
        // Escape dismisses the tooltip and must still reach a containing dialog or menu.
        if (details.reason === 'escape-key') details.allowPropagation()
      }}
    >
      {button}
    </Tooltip>
  )
}
