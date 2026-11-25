import type * as Y from 'yjs'
import { generateTitleProsemirrorJson, jsonToFragment } from '@/server/collaboration/codec'
import { AppError } from '@/server/collaboration/errors'
import { CollaborationConnection, type CollaborationDocument } from '@/server/collaboration/hocuspocus'
import { liveLog } from '@/server/collaboration/logger'
import { TitleUpdateManager, type TitleSaver } from '@/server/collaboration/title-update-manager'
import { extractTextFromHTML } from '@/server/collaboration/title-utils'

const TITLE_MIGRATION_ORIGIN = 'title-migration'

/**
 * Keeps the `title` field of the Yjs document and the page name in step (Plane `TitleSyncExtension`).
 * One instance serves one document, which is one Durable Object.
 */
export class TitleSyncExtension {
  private manager: TitleUpdateManager | null = null
  private observed: { fragment: Y.XmlFragment; observer: (events: Y.YEvent<Y.XmlFragment>[]) => void } | null = null

  constructor(
    private readonly save: TitleSaver,
    private readonly fetchName: () => Promise<string | null>
  ) {}

  /** PD-2087: documents saved before the title field existed get it from the page name. */
  async onLoadDocument(document: CollaborationDocument): Promise<void> {
    try {
      if (!document.isEmpty('title')) return
      const title = await this.fetchName()
      if (title == null) return
      document.doc.transact(() => jsonToFragment(document.doc.getXmlFragment('title'), generateTitleProsemirrorJson(title)), TITLE_MIGRATION_ORIGIN)
    } catch (error) {
      liveLog('title_load_failed', { documentName: document.name, message: AppError.from(error).message }, 'error')
    }
  }

  /** PD-2088: start observing the title field. */
  afterLoadDocument(document: CollaborationDocument): void {
    this.manager = new TitleUpdateManager(document.name, this.save)
    const fragment = document.doc.getXmlFragment('title')
    const observer = this.handleTitleChange.bind(this, document.name, fragment)
    fragment.observeDeep(observer)
    this.observed = { fragment, observer }
  }

  /**
   * PD-2089, PD-2090: a title edit is saved with the credentials of whoever made it. Plane's branch that notifies a
   * parent page never ran (the observer data never held a parent id), so it is not ported. A change that did not come
   * from a client connection has no credentials and is not saved.
   */
  private handleTitleChange(documentName: string, fragment: Y.XmlFragment, events: Y.YEvent<Y.XmlFragment>[]): void {
    const title = extractTextFromHTML(fragment.toJSON())
    const origin: unknown = events[0]?.transaction.origin
    if (origin instanceof CollaborationConnection) this.manager?.scheduleUpdate(title, origin.context)
    else if (origin !== TITLE_MIGRATION_ORIGIN) liveLog('title_not_saved', { documentName, reason: 'unrecognised transaction origin' }, 'warn')
  }

  /** PD-2091: save the pending title before the document is unloaded. */
  async beforeUnloadDocument(): Promise<void> {
    await this.manager?.forceSave()
  }

  /** PD-2092: remove the observer and cancel what is still pending. */
  afterUnloadDocument(): void {
    if (this.observed) {
      try {
        this.observed.fragment.unobserveDeep(this.observed.observer)
      } catch (error) {
        liveLog('title_unobserve_failed', { message: String(error) }, 'error')
      }
      this.observed = null
    }
    this.manager?.cancel()
    this.manager = null
  }
}
