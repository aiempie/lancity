import { useEditorTranslations } from '@/components/editor/i18n'
import type { Editor } from '@tiptap/core'

import { useCallback, useId, useRef, useState } from 'react'
import { DeleteOutline, LinkOutline, TickOutline } from '@/components/editor/icons'
// plane imports
import { Icon } from '@/components/editor/propel/components/icon'
import { IconButton } from '@/components/editor/propel/components/icon-button'
import { Input, InputGroup } from '@/components/editor/propel/components/input'
import { PopoverPopup } from '@/components/editor/propel/elements/popover'
import { ToolbarMenuTriggerButton, ToolbarMenuTriggerLabel } from '@/components/editor/propel/elements/toolbar'
// constants
import { CORE_EXTENSIONS } from '@/components/editor/constants/extension'
// helpers
import { isValidHttpUrl } from '@/components/editor/helpers/common'
import { setLinkEditor, unsetLinkEditor } from '@/components/editor/helpers/editor-commands'
import { FloatingMenuRoot } from '../floating-menu/root'
import { useFloatingMenu } from '../floating-menu/use-floating-menu'

type Props = {
  editor: Editor
}

export function BubbleMenuLinkSelector(props: Props) {
  const { editor } = props
  const t = useEditorTranslations()
  const errorId = useId()
  // states
  const [error, setError] = useState(false)
  // floating ui
  const { options, getReferenceProps, getFloatingProps } = useFloatingMenu({})
  const { context } = options
  // refs
  const inputRef = useRef<HTMLInputElement>(null)

  const handleLinkSubmit = useCallback(() => {
    const input = inputRef.current
    if (!input) return
    const url = input.value
    if (!url) return
    const { isValid, url: validatedUrl } = isValidHttpUrl(url)
    if (isValid) {
      setLinkEditor(editor, validatedUrl)
      context.onOpenChange(false)
      setError(false)
    } else {
      setError(true)
    }
  }, [editor, inputRef, context])

  return (
    <FloatingMenuRoot
      classNames={{
        buttonContainer: 'h-full'
      }}
      renderButton={buttonProps => (
        <ToolbarMenuTriggerButton {...buttonProps} size='sm' data-popup-open={context.open ? '' : undefined} />
      )}
      getFloatingProps={getFloatingProps}
      getReferenceProps={getReferenceProps}
      menuButton={
        <span className={editor.isActive(CORE_EXTENSIONS.CUSTOM_LINK) ? 'contents text-fg-primary' : 'contents'}>
          <ToolbarMenuTriggerLabel>{t('link.label')}</ToolbarMenuTriggerLabel>
          <Icon icon={LinkOutline} />
        </span>
      }
      options={options}
    >
      <PopoverPopup variant='rich' render={<section className='mt-1' />}>
        <InputGroup size='md'>
          <Icon icon={LinkOutline} tint='secondary' />
          <Input
            size='md'
            ref={inputRef}
            type='url'
            aria-label={t('link.url')}
            aria-invalid={error || undefined}
            aria-describedby={error ? errorId : undefined}
            data-invalid={error ? '' : undefined}
            placeholder={t('link.placeholder')}
            onClick={e => e.stopPropagation()}
            defaultValue={editor.getAttributes('link').href || ''}
            onKeyDown={e => {
              setError(false)
              if (e.key === 'Enter') {
                e.preventDefault()
                handleLinkSubmit()
              }
            }}
            onFocus={() => setError(false)}
            autoFocus
          />
          {editor.getAttributes('link').href ? (
            <IconButton
              type='button'
              variant='ghost'
              size='sm'
              aria-label={t('link.remove')}
              showTooltip={false}
              icon={<Icon icon={DeleteOutline} tint='danger' />}
              onClick={e => {
                unsetLinkEditor(editor)
                e.stopPropagation()
                context.onOpenChange(false)
              }}
            />
          ) : (
            <IconButton
              type='button'
              variant='ghost'
              size='sm'
              aria-label={t('link.apply')}
              showTooltip={false}
              icon={<Icon icon={TickOutline} />}
              onClick={e => {
                e.stopPropagation()
                handleLinkSubmit()
              }}
            />
          )}
        </InputGroup>
        {error && (
          <p
            id={errorId}
            className='animate-in fade-in slide-in-from-top-0 pointer-events-none text-caption-sm-regular text-danger-primary'
          >
            {t('link.invalidUrl')}
          </p>
        )}
      </PopoverPopup>
    </FloatingMenuRoot>
  )
}
