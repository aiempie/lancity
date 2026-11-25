import { and, eq, inArray, isNull } from 'drizzle-orm'
import { user } from '@/db/schema/auth'
import { estimates } from '@/db/schema/planning'
import { expandRelations, pickFields } from '@/server/common/serializers'
import { OffsetPaginator, paginate } from '@/server/common/pagination'
import { toDistribution, toModuleDetailRecord, toModuleRecord, toModuleResponseApi } from '@/server/module/presenters'
import {
  countModules,
  countModuleSubIssues,
  moduleOrderBy,
  queryModuleBurndown,
  queryModuleDistribution,
  queryModuleLink,
  queryModules,
  type ModuleQueryOptions,
  type ModuleRow,
  type ModuleScope
} from '@/server/module/queries'
import { requestedExpand, requestedFields } from '@/server/module/serializers'
import type { LancityDb } from '@/types/database/schema'
import type { ModuleListQuery } from '@/types/planning/p2-module-schema'

/** True when the project estimates with points (Plane `Project.objects.filter(estimate__type="points")`). */
export async function projectUsesPoints(db: LancityDb, estimateId: number | null) {
  if (!estimateId) return false
  const [row] = await db
    .select({ type: estimates.type })
    .from(estimates)
    .where(and(eq(estimates.id, estimateId), isNull(estimates.deletedAt)))
    .limit(1)
  return row?.type === 'points'
}

/**
 * The module detail of `ModuleViewSet.retrieve` and `ModuleArchiveUnarchiveEndpoint.get` (PD-0669, PD-0661): the
 * module with its links, sub issue count, `distribution` and, for point estimates, `estimateDistribution`.
 * The completion chart needs both dates; the live detail also needs at least one issue.
 */
export async function buildModuleDetail(
  db: LancityDb,
  scope: ModuleScope,
  row: ModuleRow,
  options: { points: boolean; chartNeedsIssues: boolean }
) {
  const record = toModuleRecord(row)
  const [links, subIssues, issueDistribution] = await Promise.all([
    queryModuleLink(db, scope, record.id),
    countModuleSubIssues(db, scope, record.id),
    queryModuleDistribution(db, scope, record.id, 'issues')
  ])
  const chart = (type: 'issues' | 'points') => queryModuleBurndown(db, scope, record.id, record, type)
  const hasDates = Boolean(record.startDate && record.targetDate)
  const issueChart = hasDates && (!options.chartNeedsIssues || record.totalIssues > 0) ? await chart('issues') : {}
  const detail = {
    ...toModuleDetailRecord(row, links, subIssues),
    distribution: {
      assignees: toDistribution(issueDistribution.assignees),
      labels: toDistribution(issueDistribution.labels),
      completionChart: issueChart
    },
    estimateDistribution: {} as Record<string, unknown>
  }
  if (options.points) {
    const points = await queryModuleDistribution(db, scope, record.id, 'points')
    detail.estimateDistribution = {
      assignees: toDistribution(points.assignees),
      labels: toDistribution(points.labels),
      ...(hasDates ? { completionChart: await chart('points') } : {})
    }
  }
  return detail
}

async function loadUsers(db: LancityDb, ids: number[]) {
  if (!ids.length) return new Map<number, Record<string, unknown>>()
  const rows = await db
    .select({ id: user.id, name: user.name, username: user.username, image: user.image })
    .from(user)
    .where(inArray(user.id, ids.slice(0, 90)))
  return new Map(rows.map(row => [row.id, row as Record<string, unknown>]))
}

/**
 * `ModuleSerializer(fields=..., expand=...)` of the external API (PD-0038): the DTO plus `members`, restricted to
 * `fields` and extended with `expand` (`lead`, `members`; other names resolve through the registered expansions).
 */
export async function shapeModuleApi(db: LancityDb, row: ModuleRow, query: Pick<ModuleListQuery, 'fields' | 'expand'>) {
  const record = toModuleResponseApi(toModuleRecord(row))
  const fields = requestedFields(query)
  const expand = requestedExpand(query)
  const base = pickFields(record as Record<string, unknown>, fields)
  if (!expand) return base
  const users = await loadUsers(db, [
    ...(record.leadId ? [record.leadId] : []),
    ...(expand.includes('members') ? record.memberIds : [])
  ])
  const instance = {
    ...record,
    lead: record.leadId ? (users.get(record.leadId) ?? null) : null,
    members: record.memberIds.map(id => users.get(id)).filter(Boolean)
  }
  return expandRelations(base, instance, expand)
}

/** `BasePaginator.paginate` over the module queryset: `cursor`, `per_page` and `order_by` come from the query string. */
export function paginateModules(
  db: LancityDb,
  scope: ModuleScope,
  query: ModuleListQuery,
  options: ModuleQueryOptions,
  shape: (row: ModuleRow) => unknown | Promise<unknown>
) {
  const paginator = new OffsetPaginator<ModuleRow>({
    fetch: (offset, limit) =>
      queryModules(db, scope, { ...options, orderBy: moduleOrderBy(query.order_by), limit, offset }),
    count: () => countModules(db, scope, options),
    orderBy: query.order_by
  })
  return paginate(query, {
    paginator,
    controller: results => Promise.all((results as ModuleRow[]).map(shape))
  })
}
