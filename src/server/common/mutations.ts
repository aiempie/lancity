import { and, eq, isNull, type SQL } from 'drizzle-orm'
import type { AnySQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'

/** Table with Lancity's soft delete column. */
export type SoftDeletableTable = SQLiteTable & { id: AnySQLiteColumn; deletedAt: AnySQLiteColumn }

/**
 * Audit columns for a write (Plane `BaseModel.save` + `AuditModel`): `createdAt` and `updatedAt` come from
 * the column defaults (`auditTimestamps`); the actor columns are set here.
 */
export function auditFields(actor: Actor | null | undefined, operation: 'insert' | 'update'): { createdById?: number; updatedById: number | null } {
  const userId = actor?.userId ?? null
  return operation === 'insert' ? { createdById: userId ?? undefined, updatedById: userId } : { updatedById: userId }
}

/** Plane `SoftDeletionManager.get_queryset`: condition that hides soft-deleted rows. */
export function activeRows(table: Pick<SoftDeletableTable, 'deletedAt'>): SQL {
  return isNull(table.deletedAt)
}

/**
 * Plane `SoftDeletionQuerySet.delete`: mark matching rows deleted (soft, default) or remove them (hard).
 * Related rows are handled by the caller or by `onSoftDeleted` (Plane queues `soft_delete_related_objects`).
 */
export async function deleteRows(db: LancityDb, table: SoftDeletableTable, where: SQL | undefined, soft = true): Promise<void> {
  if (soft) await db.update(table).set({ deletedAt: new Date() } as never).where(and(activeRows(table), where))
  else await db.delete(table).where(where)
}

/**
 * Plane `SoftDeleteModel.delete`: soft delete one record by id, then run the follow-up hook (cascade of
 * related soft deletes, normally an enqueued job). `soft: false` removes the row.
 */
export async function deleteRecord(
  db: LancityDb,
  table: SoftDeletableTable,
  id: number,
  options: { soft?: boolean; onSoftDeleted?: (id: number) => Promise<void> | void } = {}
): Promise<void> {
  const { soft = true, onSoftDeleted } = options
  await deleteRows(db, table, eq(table.id, id), soft)
  if (soft) await onSoftDeleted?.(id)
}

/**
 * Plane `ChangeTrackerMixin`: remember the values a record had when it was loaded and report what changed.
 * Track only `trackedFields` when given, otherwise every key of the record.
 *
 * ```ts
 * const tracker = new ChangeTracker(row, ['name', 'stateId'])
 * Object.assign(row, input)
 * tracker.hasChanged('name') // compare against the loaded value
 * await save(row)
 * tracker.commit(row) // changes are now relative to the saved state
 * ```
 */
export class ChangeTracker<T extends Record<string, unknown>> {
  private original: Record<string, unknown> = {}

  constructor(
    record: T,
    private readonly trackedFields?: readonly (keyof T & string)[]
  ) {
    this.track(record)
  }

  /** Plane `_track_fields`: snapshot the tracked values (deferred fields are simply absent from the record). */
  track(record: T): void {
    this.original = {}
    for (const field of this.trackedFields ?? Object.keys(record)) {
      if (field in record) this.original[field] = structuredClone(record[field])
    }
  }

  /** Plane `has_changed`: false for fields that are not tracked. */
  hasChanged(record: T, field: string): boolean {
    return field in this.original && !sameValue(this.original[field], record[field])
  }

  /** Plane `changed_fields`. */
  changedFields(record: T): string[] {
    return Object.entries(this.original)
      .filter(([field, value]) => !sameValue(value, record[field]))
      .map(([field]) => field)
  }

  /** Plane `old_values`. */
  get oldValues(): Readonly<Record<string, unknown>> {
    return this.original
  }

  /**
   * Plane `save` + `_reset_tracked_fields`: return the fields changed since the last snapshot (Plane keeps
   * them in `_changes_on_save`) and re-snapshot so the next call compares against the saved state.
   */
  commit(record: T): string[] {
    const changed = this.changedFields(record)
    this.track(record)
    return changed
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) return JSON.stringify(a) === JSON.stringify(b)
  return a === b
}
