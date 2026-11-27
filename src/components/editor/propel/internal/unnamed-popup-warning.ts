import * as React from 'react'

// A dialog-like popup (Base UI's Dialog and Popover popups both render `role="dialog"`) needs an
// accessible name, or a screen reader announces it as just "dialog" (WCAG 4.1.2). Base UI names the
// popup automatically when it contains a `DialogTitle` / `PopoverTitle`, by pointing
// `aria-labelledby` at it; otherwise the caller passes `aria-label` or `aria-labelledby`.
//
// Requiring a name in the types would break every untitled caller at once, so this warns in
// development instead. The check rides on the styled render element (`render={<DialogPopup
// ref={check} />}`), which Base UI merges with the caller's own `ref`, so the caller's ref is never
// touched. A title can mount late (Suspense, a lazy child, data still loading), so the name is
// re-checked a few times over about a second before warning. Each unnamed popup element warns once.
// Production builds skip the check entirely.

const RECHECK_MS = [0, 250, 1000]
const warned = new WeakSet<Element>()

/** Text an element contributes as a label: its own `aria-label`, an image's `alt`, or its text. */
function labelText(element: Element): string {
  const own = element.getAttribute('aria-label')?.trim()
  if (own) return own
  if (element instanceof HTMLImageElement) return element.alt.trim()
  const parts = [element.textContent ?? '']
  for (const child of element.querySelectorAll('[aria-label], img[alt]')) {
    parts.push(child.getAttribute('aria-label') ?? child.getAttribute('alt') ?? '')
  }
  return parts.join(' ').trim()
}

/** A simplified accessible-name check: enough to tell "has a name" from "has none". */
export function hasAccessibleName(popup: HTMLElement): boolean {
  if (popup.getAttribute('aria-label')?.trim()) return true
  const ids = popup.getAttribute('aria-labelledby')?.split(/\s+/).filter(Boolean) ?? []
  for (const id of ids) {
    const target = popup.ownerDocument.getElementById(id)
    if (target && labelText(target)) return true
  }
  return Boolean(popup.getAttribute('title')?.trim())
}

/**
 * A stable callback ref for the styled popup element. In development it reports the popup when it
 * still has no accessible name about a second after it opens.
 */
export function useUnnamedPopupWarning(component: string): React.RefCallback<HTMLElement> {
  return React.useCallback(
    (popup: HTMLElement) => {
      if (process.env.NODE_ENV === 'production') return undefined
      const timers = RECHECK_MS.map((delay, index) =>
        setTimeout(() => {
          if (!popup.isConnected || warned.has(popup)) return
          if (hasAccessibleName(popup)) {
            timers.forEach(clearTimeout)
            return
          }
          if (index < RECHECK_MS.length - 1) return
          warned.add(popup)
          console.error(
            `${component}: this popup has no accessible name, so screen readers announce it only ` +
              `as "dialog". Add a ${component.replace('Content', 'Title')}, or pass \`aria-label\` ` +
              'or `aria-labelledby`.',
            popup
          )
        }, delay)
      )
      return () => timers.forEach(clearTimeout)
    },
    [component]
  )
}
