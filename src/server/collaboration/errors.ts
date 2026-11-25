import { ServiceError } from '@/server/common/errors'

/** Port of Plane Live `AppError`: one error shape for service, abort and unknown failures (PD-2142). */
export class AppError extends Error {
  statusCode?: number
  code?: string
  context?: Record<string, unknown>

  constructor(message: string, data: { statusCode?: number; code?: string; context?: Record<string, unknown> } = {}) {
    super(message)
    this.name = 'AppError'
    Object.assign(this, data)
  }

  /** Normalize any thrown value. An `AppError` is returned unchanged, like Plane's constructor shortcut. */
  static from(error: unknown, data: { code?: string; context?: Record<string, unknown> } = {}): AppError {
    if (error instanceof AppError) return error
    if (typeof error === 'string') return new AppError(error, data)
    if (error instanceof ServiceError)
      return new AppError(error.message, { statusCode: error.status, code: error.code, ...data })
    if (error instanceof Error && error.name === 'AbortError') return new AppError(error.message, { code: 'ABORT_ERROR' })
    if (error instanceof Error) return new AppError(error.message, { code: data.code ?? error.name, context: data.context })
    return new AppError('Unknown error occurred', data)
  }
}
