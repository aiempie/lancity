import { AsyncLocalStorage } from 'node:async_hooks'
import { createMiddleware } from 'hono/factory'

/**
 * Request scoped read replica flag (Plane `utils/core/request_scope.py`, `ReadReplicaRoutingMiddleware` and
 * `ReadReplicaRouter`). D1 has a single binding: this flag is the opt-in signal for code that opens a D1
 * Sessions API (read replication) connection. Writes and unmarked reads always use the primary.
 */
type Scope = { useReadReplica: boolean }
const scope = new AsyncLocalStorage<Scope>()

const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Plane `set_use_read_replica`. No effect outside `readReplicaRouting`. */
export function setUseReadReplica(useReplica: boolean): void {
  const store = scope.getStore()
  if (store) store.useReadReplica = Boolean(useReplica)
}

/** Plane `should_use_read_replica`: false unless the request opted in. */
export function shouldUseReadReplica(): boolean {
  return scope.getStore()?.useReadReplica ?? false
}

/** Plane `clear_read_replica_context`. */
export function clearReadReplicaContext(): void {
  const store = scope.getStore()
  if (store) store.useReadReplica = false
}

/** Plane `ReadReplicaRouter.db_for_read/db_for_write`: writes always go to the primary. */
export function routeDatabase(operation: 'read' | 'write'): 'primary' | 'replica' {
  return operation === 'read' && shouldUseReadReplica() ? 'replica' : 'primary'
}

/**
 * Plane `ReadReplicaRoutingMiddleware.__call__`: open a scope per request, force the primary for writes
 * and always clear the flag afterwards. Mount once at the top of the API.
 */
export const readReplicaRouting = createMiddleware(async (c, next) => {
  await scope.run({ useReadReplica: false }, async () => {
    if (!READ_ONLY_METHODS.has(c.req.method.toUpperCase())) setUseReadReplica(false)
    try {
      await next()
    } finally {
      clearReadReplicaContext()
    }
  })
})

/** Plane `use_read_replica = True` on a view (`process_view`): attach to read-only routes that may use a replica. */
export const useReadReplica = createMiddleware(async (c, next) => {
  if (READ_ONLY_METHODS.has(c.req.method.toUpperCase())) setUseReadReplica(true)
  await next()
})
