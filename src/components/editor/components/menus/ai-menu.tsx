import { autoUpdate, computePosition, flip, shift } from '@floating-ui/dom'
import type { Editor } from '@tiptap/core'
import { useCallback, useEffect, useRef, useState } from 'react'
// plane utils
import { cn } from '@/lib/utils'
// types
import type { TAIHandler } from '@/components/editor/types'

type Props = {
  /** Lancity: the editor whose side menu holds the AI handle. */
  editor: Editor
  menu: TAIHandler['menu']
}

export function AIFeaturesMenu(props: Props) {
  const { editor, menu } = props
  // states
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  // refs
  const menuRef = useRef<HTMLDivElement>(null)
  const isPopupVisible = !!anchor

  const hidePopup = useCallback(() => setAnchor(null), [])

  // keep the menu below the AI handle while it is open
  useEffect(() => {
    const menuElement = menuRef.current
    if (!anchor || !menuElement) return

    const cleanup = autoUpdate(anchor, menuElement, () => {
      computePosition(anchor, menuElement, {
        placement: 'bottom-start',
        strategy: 'fixed',
        middleware: [flip(), shift()]
      })
        .then(({ x, y }) => Object.assign(menuElement.style, { left: `${x}px`, top: `${y}px` }))
        .catch(error => console.error('An error occurred while positioning the AI menu:', error))
    })
    menuElement.focus()

    return cleanup
  }, [anchor])

  useEffect(() => {
    const handleClickAIHandle = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      // Lancity: only the handle of this editor (the side menu sits next to its content). With two editors on one
      // page, a click on one handle opened the AI menu of both.
      const isOwnHandle = target.matches('#ai-handle') && Boolean(editor.view.dom.parentElement?.contains(target))
      if (isOwnHandle || menuRef.current?.contains(e.target as Node)) {
        e.preventDefault()

        if (!isPopupVisible) setAnchor(target)
        return
      }

      hidePopup()
      return
    }

    document.addEventListener('click', handleClickAIHandle)
    document.addEventListener('contextmenu', handleClickAIHandle)
    document.addEventListener('keydown', hidePopup)

    return () => {
      document.removeEventListener('click', handleClickAIHandle)
      document.removeEventListener('contextmenu', handleClickAIHandle)
      document.removeEventListener('keydown', hidePopup)
    }
  }, [editor, hidePopup, isPopupVisible])

  return (
    <div
      className={cn('pointer-events-none fixed inset-0 z-10 size-full opacity-0 transition-opacity', {
        'pointer-events-auto opacity-100': isPopupVisible
      })}
    >
      <div ref={menuRef} tabIndex={-1} className='fixed z-10 w-max outline-none'>
        {menu?.({
          isOpen: isPopupVisible,
          onClose: hidePopup
        })}
      </div>
    </div>
  )
}
