import { useState } from 'react'
import type { EditorRefApi, TAIMenuProps } from '@/components/editor'
import { Button } from '@/components/ui/button'

// Test harness: an AI menu with fake answers, so the AI handle can be tested without an LLM provider. Labels are
// fixed English test strings.

export type LocalAITask = 'summarize' | 'rewrite'

const TASK_LABELS: Record<LocalAITask, string> = { summarize: 'Summarize', rewrite: 'Rewrite' }

/** Deterministic stand-in for the LLM answer (document content, not UI text). */
export function fakeAIAnswer(task: LocalAITask, selectedText: string) {
  const text = selectedText.replace(/\s+/g, ' ').trim()
  if (task === 'summarize') return `TL;DR: ${text.split(' ').slice(0, 6).join(' ')}…`
  return (
    text
      .replace(/\bvery\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim() || text
  )
}

export function LocalAIMenu({
  editorRef,
  isOpen,
  onClose
}: TAIMenuProps & { editorRef: React.RefObject<EditorRefApi | null> }) {
  const [answer, setAnswer] = useState<string | null>(null)
  const [missingSelection, setMissingSelection] = useState(false)
  if (!isOpen) return null

  const run = (task: LocalAITask) => {
    const html = editorRef.current?.getSelectedText()
    const text = html ? (new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '') : ''
    setMissingSelection(!text)
    setAnswer(text ? fakeAIAnswer(task, text) : null)
  }
  const insert = (insertOnNextLine: boolean) => {
    if (!answer) return
    editorRef.current?.insertText(answer, insertOnNextLine)
    setAnswer(null)
    onClose()
  }

  return (
    <div
      role='dialog'
      aria-label={'AI (fake answers)'}
      className='w-72 space-y-2 rounded-lg border bg-popover p-3 shadow-md'
    >
      <p className='text-xs font-semibold text-muted-foreground'>{'AI (fake answers)'}</p>
      <div className='flex gap-2'>
        {(['summarize', 'rewrite'] as const).map(task => (
          <Button key={task} type='button' size='sm' variant='secondary' onClick={() => run(task)}>
            {TASK_LABELS[task]}
          </Button>
        ))}
      </div>
      {missingSelection && <p className='text-xs text-muted-foreground'>Pick a block with the AI handle first.</p>}
      {answer && (
        <>
          <p data-testid='ai-answer' className='rounded-md bg-muted p-2 text-sm'>
            {answer}
          </p>
          <div className='flex gap-2'>
            <Button type='button' size='sm' onClick={() => insert(true)}>
              Insert below
            </Button>
            <Button type='button' size='sm' variant='secondary' onClick={() => insert(false)}>
              Replace
            </Button>
            <Button type='button' size='sm' variant='ghost' onClick={onClose}>
              Close
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
