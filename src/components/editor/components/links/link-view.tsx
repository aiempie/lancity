import type { Editor } from '@tiptap/react'
import type { CSSProperties } from 'react'
import { useEffect, useState } from 'react'
// components
import { LinkEditView, LinkPreview } from '@/components/editor/components/links'

export type LinkViews = 'LinkPreview' | 'LinkEditView'

export type LinkViewProps = {
  view?: LinkViews
  editor: Editor
  from: number
  to: number
  url: string
  text?: string
  closeLinkView: () => void
}

export function LinkView(props: LinkViewProps & { style: CSSProperties }) {
  const [currentView, setCurrentView] = useState<LinkViews>(props.view ?? 'LinkPreview')
  const [prevFrom, setPrevFrom] = useState(props.from)

  const switchView = (view: LinkViews) => {
    setCurrentView(view)
  }

  useEffect(() => {
    if (props.from !== prevFrom) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Plane syncs local state from editor state in this effect
      setCurrentView('LinkPreview')
      setPrevFrom(props.from)
    }
  }, [prevFrom, props.from])

  return (
    <>
      {currentView === 'LinkPreview' && <LinkPreview viewProps={props} switchView={switchView} />}
      {currentView === 'LinkEditView' && <LinkEditView viewProps={props} switchView={switchView} />}
    </>
  )
}
