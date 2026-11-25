import { DebounceManager } from '@/server/collaboration/debounce'
import { AppError } from '@/server/collaboration/errors'
import { liveLog } from '@/server/collaboration/logger'
import type { LiveConnectionContext } from '@/types/content/p4-live-schema'

/** Saves a title with the credentials of the connection that changed it. */
export type TitleSaver = (title: string, context: LiveConnectionContext, signal?: AbortSignal) => Promise<void>

/** Port of Plane `TitleUpdateManager`: debounced page title saves (PD-2113 to PD-2117). */
export class TitleUpdateManager {
  private debounceManager: DebounceManager
  private lastTitle: string | null = null
  private lastContext: LiveConnectionContext | null = null

  constructor(
    private readonly documentName: string,
    private readonly save: TitleSaver,
    wait = 5000
  ) {
    this.debounceManager = new DebounceManager({ wait, logPrefix: `TitleManager[${documentName.substring(0, 8)}]` })
  }

  /** PD-2114: schedule a debounced save, made with the context of the connection that changed the title. */
  scheduleUpdate(title: string, context: LiveConnectionContext): void {
    this.lastTitle = title
    this.lastContext = context
    this.debounceManager.schedule(this.updateTitle, title, context)
  }

  /** PD-2115: runs from the debounce manager. Failures are logged and not retried until the next change. */
  private updateTitle = async (title: string, context: LiveConnectionContext, signal?: AbortSignal): Promise<void> => {
    try {
      await this.save(title, context, signal)
      if (this.lastTitle === title) this.lastTitle = null
    } catch (error) {
      const appError = AppError.from(error, { context: { operation: 'updateTitle', documentName: this.documentName } })
      if (appError.code === 'ABORT_ERROR') throw appError
      liveLog('title_update_failed', { documentName: this.documentName, message: appError.message }, 'error')
    }
  }

  /** PD-2116: save the pending title now. */
  async forceSave(): Promise<void> {
    if (!this.lastTitle || !this.lastContext) return
    await this.debounceManager.flush(this.updateTitle)
  }

  /** PD-2117 */
  cancel(): void {
    this.debounceManager.cancel()
    this.lastTitle = null
  }
}
