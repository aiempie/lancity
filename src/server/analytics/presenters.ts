import type { analyticViews } from '@/db/schema/notification'

type AnalyticViewRow = typeof analyticViews.$inferSelect

/** PD-1367 `AnalyticView.__str__`: `name <workspace name>`, for logs and display labels. */
export const formatAnalytic = (view: { name: string }, workspace: { name: string }): string =>
  `${view.name} <${workspace.name}>`

/** The analytic view as the API returns it (Plane `AnalyticViewSerializer` with every field). */
export function presentAnalyticView(row: AnalyticViewRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    query: row.query,
    queryDict: row.queryDict,
    workspaceId: row.workspaceId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdById: row.createdById,
    updatedById: row.updatedById
  }
}
