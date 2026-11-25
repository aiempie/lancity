import { and, eq, inArray, isNull } from 'drizzle-orm'
import { pageLogs, pages } from '@/db/schema/content'
import type { InfraEnv } from '@/server/common/env'
import { decodeEntities } from '@/server/page/html-processor'
import type { LancityDb } from '@/types/database/schema'
import { type PageTransactionJob } from '@/types/content/p2-page-schema'

type Mention = Record<string, string | null>
type ComponentName = keyof typeof COMPONENT_MAP
export type ComponentEntities = Record<string, Mention[]>
export type EntityDetails = { entityName: string | null; entityType: string | null; entityIdentifier: string | null }

/** Editor components that Plane tracks in `page_logs`. */
const COMPONENT_MAP = {
  'mention-component': {
    attributes: ['id', 'entity_identifier', 'entity_name', 'entity_type'],
    extract: (m: Mention): EntityDetails => ({
      entityName: m.entity_name,
      entityType: null,
      entityIdentifier: m.entity_identifier
    })
  },
  'image-component': {
    attributes: ['id', 'src'],
    extract: (m: Mention): EntityDetails => ({ entityName: 'image', entityType: null, entityIdentifier: m.src })
  }
}

const TAG = /<([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g
const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

/** PD-1212: collect every tracked component in one pass. Missing attributes are null. */
export function extractAllComponents(descriptionHtml: string | null | undefined): ComponentEntities {
  const results: ComponentEntities = Object.fromEntries(Object.keys(COMPONENT_MAP).map(name => [name, []]))
  if (!descriptionHtml) return results
  try {
    for (const tag of descriptionHtml.matchAll(TAG)) {
      const name = tag[1].toLowerCase()
      if (!Object.hasOwn(COMPONENT_MAP, name)) continue
      const present = new Map<string, string>()
      for (const attribute of tag[2].matchAll(ATTRIBUTE))
        present.set(attribute[1].toLowerCase(), decodeEntities(attribute[2] ?? attribute[3] ?? attribute[4] ?? ''))
      results[name].push(
        Object.fromEntries(COMPONENT_MAP[name as ComponentName].attributes.map(key => [key, present.get(key) ?? null]))
      )
    }
    return results
  } catch {
    return Object.fromEntries(Object.keys(COMPONENT_MAP).map(name => [name, []]))
  }
}

/** PD-1213: normalize component attributes into entity name, type and identifier. */
export function getEntityDetails(component: string, mention: Mention): EntityDetails {
  const config = COMPONENT_MAP[component as ComponentName]
  return config ? config.extract(mention) : { entityName: null, entityType: null, entityIdentifier: null }
}

/**
 * Decide which log rows to add and which transactions to remove (body of `page_transaction`).
 * A mention already logged is skipped only when the page has logs; ids that left the HTML are deleted.
 */
export function planPageTransactions(input: {
  oldIds: ReadonlySet<string>
  next: ComponentEntities
  hasExistingLogs: boolean
}) {
  const newIds = new Set<string>()
  const inserts: (EntityDetails & { transaction: string })[] = []
  for (const [component, mentions] of Object.entries(input.next)) {
    for (const mention of mentions) {
      const id = mention.id
      if (!id) continue
      newIds.add(id)
      if (input.oldIds.has(id) && input.hasExistingLogs) continue
      if (!inserts.some(item => item.transaction === id))
        inserts.push({ transaction: id, ...getEntityDetails(component, mention) })
    }
  }
  return { inserts, deletedIds: [...input.oldIds].filter(id => !newIds.has(id)) }
}

function identifierNumber(value: string | null): number | null {
  return value !== null && /^\d{1,15}$/.test(value) ? Number(value) : null
}

/** Sync `page_logs` with the components of the stored description. Safe to run twice (idempotent). */
export async function syncPageTransactions(db: LancityDb, pageId: number): Promise<void> {
  const [page] = await db
    .select({ workspaceId: pages.workspaceId, descriptionHtml: pages.descriptionHtml })
    .from(pages)
    .where(and(eq(pages.id, pageId), isNull(pages.deletedAt)))
  if (!page) return
  const existing = await db
    .select({ transaction: pageLogs.transaction })
    .from(pageLogs)
    .where(eq(pageLogs.pageId, pageId))
  const plan = planPageTransactions({
    oldIds: new Set(existing.map(row => row.transaction)),
    next: extractAllComponents(page.descriptionHtml),
    hasExistingLogs: existing.length > 0
  })
  // D1 allows 100 bound parameters per statement, so write in small chunks.
  for (let i = 0; i < plan.inserts.length; i += 8)
    await db
      .insert(pageLogs)
      .values(
        plan.inserts.slice(i, i + 8).map(item => ({
          transaction: item.transaction,
          pageId,
          workspaceId: page.workspaceId,
          entityName: (item.entityName ?? '').slice(0, 30),
          entityType: item.entityType,
          entityIdentifier: identifierNumber(item.entityIdentifier)
        }))
      )
      .onConflictDoNothing()
  for (let i = 0; i < plan.deletedIds.length; i += 80)
    await db
      .delete(pageLogs)
      .where(and(eq(pageLogs.pageId, pageId), inArray(pageLogs.transaction, plan.deletedIds.slice(i, i + 80))))
}

/** PD-1214: `page_transaction` job. Plane swallows errors; the Queue retries them here. */
export async function pageTransaction(env: InfraEnv, payload: PageTransactionJob): Promise<void> {
  const { getDb } = await import('@/db/client') // lazy: `cloudflare:workers` is unavailable in Node tests
  await syncPageTransactions(getDb(env.DB), payload.pageId)
}
