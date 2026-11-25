import { liveLog } from '@/server/collaboration/logger'

/** PD-2093: mutable state of one debounced operation. */
export interface DebounceState {
  lastArgs: unknown[] | null
  timerId: ReturnType<typeof setTimeout> | null
  lastCallTime: number | undefined
  lastExecutionTime: number
  inProgress: boolean
  abortController: AbortController | null
}

export const createDebounceState = (): DebounceState => ({
  lastArgs: null,
  timerId: null,
  lastCallTime: undefined,
  lastExecutionTime: 0,
  inProgress: false,
  abortController: null
})

export interface DebounceOptions {
  /** Wait time in milliseconds. */
  wait: number
  /** Prefix for log lines. */
  logPrefix?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- callers pass their own argument list plus the abort signal
type DebouncedFunction = (...args: any[]) => Promise<void>

/** Port of Plane `DebounceManager`: trailing-edge debounce that aborts an in-flight run when new input arrives. */
export class DebounceManager {
  private state = createDebounceState()
  private wait: number
  private logPrefix: string

  constructor(options: DebounceOptions) {
    this.wait = options.wait
    this.logPrefix = options.logPrefix || ''
  }

  /** PD-2095: remember the latest arguments and (re)start the trailing timer. */
  schedule(func: DebouncedFunction, ...args: unknown[]): void {
    this.state.lastArgs = args
    this.state.lastCallTime = Date.now()
    if (this.state.timerId) clearTimeout(this.state.timerId)
    this.state.timerId = setTimeout(() => this.timerExpired(func), this.wait)
  }

  /** PD-2099 */
  private timerExpired(func: DebouncedFunction): void {
    const time = Date.now()
    if (this.shouldInvoke(time)) {
      this.executeFunction(func, time)
      return
    }
    this.state.timerId = setTimeout(() => this.timerExpired(func), this.remainingWait(time))
  }

  /** PD-2101 */
  private executeFunction(func: DebouncedFunction, time: number): void {
    this.state.timerId = null
    this.state.lastExecutionTime = time
    this.performFunction(func).catch(error => {
      liveLog('debounce_execute_failed', { prefix: this.logPrefix, message: String(error) }, 'error')
    })
  }

  /** PD-2103: run with the latest arguments, aborting an operation that is still in progress. */
  private async performFunction(func: DebouncedFunction): Promise<void> {
    const args = this.state.lastArgs
    if (!args) return
    const currentArgs = [...args]
    await this.abortOngoingOperation()
    this.state.inProgress = true
    this.state.abortController = new AbortController()
    try {
      await func(...currentArgs, this.state.abortController.signal)
      if (this.state.lastArgs && this.arraysEqual(this.state.lastArgs, currentArgs)) {
        this.state.lastArgs = null
        if (this.state.timerId) {
          clearTimeout(this.state.timerId)
          this.state.timerId = null
        }
      } else if (this.state.lastArgs && !this.state.timerId) {
        this.state.timerId = setTimeout(() => this.timerExpired(func), this.wait)
      }
    } catch (error) {
      if (!(error instanceof Error && (error.name === 'AbortError' || (error as { code?: string }).code === 'ABORT_ERROR'))) {
        liveLog('debounce_operation_failed', { prefix: this.logPrefix, message: String(error) }, 'error')
        // Keep a timer running so a failed run is retried.
        if (!this.state.timerId && this.state.lastArgs)
          this.state.timerId = setTimeout(() => this.timerExpired(func), this.wait)
      }
    } finally {
      this.state.inProgress = false
      this.state.abortController = null
    }
  }

  /** PD-2106 */
  private async abortOngoingOperation(): Promise<void> {
    if (this.state.inProgress && this.state.abortController) {
      this.state.abortController.abort()
      // Give the abort a moment to propagate, then force the state if it did not reset.
      await new Promise(resolve => setTimeout(resolve, 20))
      this.state.inProgress = false
      this.state.abortController = null
    }
  }

  /** PD-2108 */
  private shouldInvoke(time: number): boolean {
    return this.state.lastCallTime === undefined || time - this.state.lastCallTime >= this.wait
  }

  /** PD-2109 */
  private remainingWait(time: number): number {
    return Math.max(0, this.wait - (time - (this.state.lastCallTime || 0)))
  }

  /** PD-2110: run the pending call now. */
  async flush(func: DebouncedFunction): Promise<void> {
    if (this.state.timerId) {
      clearTimeout(this.state.timerId)
      this.state.timerId = null
    }
    this.state.lastCallTime = undefined
    if (this.state.lastArgs) await this.performFunction(func)
  }

  /** PD-2111: drop pending work and abort the running operation. */
  cancel(): void {
    if (this.state.timerId) {
      clearTimeout(this.state.timerId)
      this.state.timerId = null
    }
    this.state.lastCallTime = undefined
    if (this.state.inProgress && this.state.abortController) {
      this.state.abortController.abort()
      this.state.inProgress = false
      this.state.abortController = null
    }
    this.state.lastArgs = null
  }

  /** PD-2112 */
  private arraysEqual(a: unknown[], b: unknown[]): boolean {
    return a.length === b.length && a.every((value, index) => value === b[index])
  }
}
