import { PdfTimeoutError } from '@/server/pdf/errors'

/**
 * Promise based replacements for Plane's Effect helpers (`effect-utils.ts`). Effect is not used in Lancity:
 * errors are plain exceptions and `ServiceError` carries the HTTP status.
 */

/** One JSON line, like `logJson`; not imported from env.ts so the helpers stay usable outside the Worker runtime. */
const logWarning = (label: string, data: Record<string, unknown>) =>
  console.warn(JSON.stringify({ level: 'warn', label, ...data }))

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/** PD-2290: reject with a `PdfTimeoutError` after `timeoutMs`. The timer is always cleared. */
async function withTimeout<A>(operation: string, timeoutMs: number, run: () => Promise<A>): Promise<A> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new PdfTimeoutError(`Operation "${operation}" timed out after ${timeoutMs}ms`, operation)),
      timeoutMs
    )
  })
  try {
    return await Promise.race([run(), timeout])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * PD-2288 `withTimeoutAndRetry`: timeout per attempt, then retry with exponential backoff (200 ms, 400 ms, ...)
 * up to `maxRetries` extra attempts (PD-2289, PD-2291). Defaults match Plane: 5 s and 2 retries.
 * Client errors (anything with a `status` below 500) are not retried.
 */
export async function withTimeoutAndRetry<A>(
  operation: string,
  run: () => Promise<A>,
  { timeoutMs = 5000, maxRetries = 2 }: { timeoutMs?: number; maxRetries?: number } = {}
): Promise<A> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await withTimeout(operation, timeoutMs, run)
    } catch (error) {
      const status = (error as { status?: number }).status
      if (attempt >= maxRetries || (typeof status === 'number' && status < 500)) throw error
      logWarning('PDF_EXPORT: Retrying operation', { operation, attempt: attempt + 1, error: String(error) })
      await sleep(200 * 2 ** attempt)
    }
  }
}

/** PD-2292 `recoverWithDefault` (PD-2293 to PD-2295): log the failure and return `fallback`. */
export async function recoverWithDefault<A>(run: () => Promise<A>, fallback: A): Promise<A> {
  try {
    return await run()
  } catch (error) {
    logWarning('PDF_EXPORT: Operation failed, using fallback', { error: String(error) })
    return fallback
  }
}

/** PD-2296 `tryAsync`: run `run` and map any thrown value with `onError`. */
export async function tryAsync<A, E extends Error>(run: () => Promise<A>, onError: (cause: unknown) => E): Promise<A> {
  try {
    return await run()
  } catch (error) {
    throw onError(error)
  }
}
