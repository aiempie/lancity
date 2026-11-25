/** An expected application failure that can safely be exposed to API clients. */
export class ServiceError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ServiceError'
    this.status = status
    this.code = code
    this.details = details
  }
}

/** Plane's `ObjectDoesNotExist` response. */
export function notFoundError(message = 'The required object does not exist.', code = 'NOT_FOUND'): ServiceError {
  return new ServiceError(404, code, message)
}

/** Plane's permission denied response. */
export function forbiddenError(message = "You don't have the required permissions."): ServiceError {
  return new ServiceError(403, 'FORBIDDEN', message)
}

/** Plane's DRF `ParseError`: malformed pagination, filter or body input. */
export function parseError(message: string, details?: unknown): ServiceError {
  return new ServiceError(400, 'PARSE_ERROR', message, details)
}

/** True when a D1/SQLite failure is a constraint violation (Django `IntegrityError`). Walks the `cause` chain. */
export function isIntegrityError(error: unknown): boolean {
  for (let current = error, depth = 0; current instanceof Error && depth < 5; depth++) {
    if (/(UNIQUE|FOREIGN KEY|NOT NULL|CHECK|PRIMARY KEY) constraint failed|SQLITE_CONSTRAINT/i.test(current.message)) return true
    current = current.cause
  }
  return false
}
