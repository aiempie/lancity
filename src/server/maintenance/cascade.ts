import { is, sql } from 'drizzle-orm'
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core'
import * as schema from '@/db/schema'
import type { LancityDb } from '@/types/database/schema'

/** A single-column foreign key `child.column -> parent.id`, with the Django `on_delete` it maps to. */
export type CascadeEdge = {
  child: string
  column: string
  parent: string
  onDelete: 'cascade' | 'set null' | 'other'
  nullable: boolean
}

export type TableMeta = { name: string; softDelete: boolean }

export const q = (name: string) => `"${name.replaceAll('"', '""')}"`

/** Number of rows a D1 or SQLite write touched. */
export function changes(result: unknown): number {
  const r = result as { meta?: { changes?: number }; changes?: number } | null | undefined
  return r?.meta?.changes ?? r?.changes ?? 0
}

let cached: { tables: Map<string, TableMeta>; edges: CascadeEdge[] } | undefined

/**
 * Relations of the Drizzle schema, the equivalent of Django `_meta.get_fields()` used by `soft_delete_related_objects`.
 * Composite keys (`project_id, workspace_id`) only restate a relation that has its own single-column key, so they are skipped.
 */
export function cascadeGraph() {
  if (cached) return cached
  const tables = new Map<string, TableMeta>()
  const edges: CascadeEdge[] = []
  const configs = Object.values(schema)
    .filter((value): value is (typeof schema)[keyof typeof schema] & SQLiteTable => is(value, SQLiteTable))
    .map(table => getTableConfig(table))
  for (const config of configs)
    tables.set(config.name, { name: config.name, softDelete: config.columns.some(c => c.name === 'deleted_at') })
  for (const config of configs)
    for (const fk of config.foreignKeys) {
      const ref = fk.reference()
      if (ref.columns.length !== 1) continue
      const action = fk.onDelete
      edges.push({
        child: config.name,
        column: ref.columns[0].name,
        parent: getTableConfig(ref.foreignTable).name,
        onDelete: action === 'cascade' ? 'cascade' : action === 'set null' ? 'set null' : 'other',
        nullable: !ref.columns[0].notNull
      })
    }
  cached = { tables, edges }
  return cached
}

/**
 * Persist each discovered row by job and process its outgoing edges atomically. A failed batch leaves the
 * current node pending, so a redelivery resumes the exact frontier and the original deletion timestamp.
 */
export async function softDeleteRelatedObjects(
  db: LancityDb,
  tableName: string,
  id: number,
  at: Date = new Date(),
  jobKey = `cascade:${tableName}:${id}`,
  options: { batchBudget?: number } = {}
): Promise<{ levels: number; rows: number; continuation?: number }> {
  const { tables, edges } = cascadeGraph()
  if (!tables.get(tableName)?.softDelete || !Number.isSafeInteger(id)) return { levels: 0, rows: 0 }
  const root = q(tableName)
  const init = [
    db.run(sql`insert into cascade_jobs (job_key, root_table, root_id, deletion_stamp)
      select ${jobKey}, ${tableName}, ${id}, coalesce(deleted_at, ${at.getTime()}) from ${sql.raw(root)} where id = ${id}
      on conflict(job_key) do nothing`),
    db.run(sql`update ${sql.raw(root)} set deleted_at = (select deletion_stamp from cascade_jobs where job_key = ${jobKey})
      where id = ${id} and deleted_at is null and exists (select 1 from cascade_jobs where job_key = ${jobKey})
        and not exists (select 1 from cascade_nodes n join cascade_jobs j on j.id = n.job_id where j.job_key = ${jobKey})`),
    db.run(sql`insert into cascade_nodes (job_id, table_name, row_id)
      select id, ${tableName}, ${id} from cascade_jobs where job_key = ${jobKey}
      on conflict(job_id, table_name, row_id) do nothing`)
  ]
  const initial = await db.batch(init as unknown as Parameters<typeof db.batch>[0])
  let rows = changes(initial[1])
  let levels = 0
  const [job] = await db.all<{ id: number; deletion_stamp: number }>(sql`select id, deletion_stamp from cascade_jobs where job_key = ${jobKey}`)
  if (!job) return { levels, rows }
  // Two D1 queries per group, plus initialization and continuation publishing, stay below the free-plan
  // request limit for a single job. One group can cover many rows without consuming bound parameters per row.
  const budget = Math.max(1, Math.min(options.batchBudget ?? 15, 15))
  let continuation: number | undefined
  for (let batch = 0; batch < budget; batch++) {
    const nodes = await db.all<{ id: number; table_name: string; row_id: number }>(sql`
      select id, table_name, row_id from cascade_nodes
      where job_id = ${job.id} and processed = 0 and table_name = (
        select table_name from cascade_nodes where job_id = ${job.id} and processed = 0 order by id limit 1
      ) order by id limit 100`)
    if (!nodes.length) return { levels, rows }
    const selected = JSON.stringify(nodes.map(node => node.id))
    // Recheck pending state inside the write batch in case a concurrent delivery has processed these nodes.
    const parents = sql`select row_id from cascade_nodes where job_id = ${job.id} and processed = 0
      and id in (select value from json_each(${selected}))`
    const relevant = edges.filter(edge => edge.parent === nodes[0].table_name && edge.onDelete !== 'other')
    const statements: ReturnType<LancityDb['run']>[] = []
    for (const edge of relevant) {
      if (edge.onDelete !== 'cascade' || !tables.get(edge.child)?.softDelete) continue
      statements.push(db.run(sql`insert into cascade_nodes (job_id, table_name, row_id)
        select ${job.id}, ${edge.child}, id from ${sql.raw(q(edge.child))}
        where ${sql.raw(q(edge.column))} in (${parents}) and deleted_at is null
        on conflict(job_id, table_name, row_id) do nothing`))
    }
    const updateOffset = statements.length
    for (const edge of [...relevant].sort((a, b) => Number(a.onDelete === 'set null') - Number(b.onDelete === 'set null'))) {
      if (edge.onDelete === 'set null' && edge.nullable) {
        statements.push(db.run(sql`update ${sql.raw(q(edge.child))} set ${sql.raw(q(edge.column))} = null
          where ${sql.raw(q(edge.column))} in (${parents})`))
      } else if (edge.onDelete === 'cascade' && tables.get(edge.child)?.softDelete) {
        statements.push(db.run(sql`update ${sql.raw(q(edge.child))} set deleted_at = ${job.deletion_stamp}
          where ${sql.raw(q(edge.column))} in (${parents}) and deleted_at is null
            and id in (select row_id from cascade_nodes where job_id = ${job.id} and table_name = ${edge.child})`))
      }
    }
    statements.push(db.run(sql`update cascade_nodes set processed = 1 where job_id = ${job.id} and processed = 0
      and id in (select value from json_each(${selected}))`))
    const result = await db.batch(statements as unknown as Parameters<typeof db.batch>[0])
    for (const item of result.slice(updateOffset, -1)) rows += changes(item)
    continuation = nodes[0].id
    levels++
  }
  return { levels, rows, continuation }

}

/** Plane `restore_related_objects` is an empty function (its task decorator is commented out); kept as a no-op. */
export function restoreRelatedObjects(): void {}
