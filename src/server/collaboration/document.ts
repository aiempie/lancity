import { and, eq, inArray, isNull } from 'drizzle-orm'
import { fileAssets, pageLogs } from '@/db/schema/content'
import { profiles } from '@/db/schema/identity'
import { user } from '@/db/schema/auth'
import { workspaces } from '@/db/schema/workspace'
import { assetUrl } from '@/server/asset/model-rules'
import { AppError } from '@/server/collaboration/errors'
import { convertHtmlDocumentToAllFormats } from '@/server/collaboration/codec'
import { getPage, getPagesDescription, updatePage, updatePagesDescription } from '@/server/page/service'
import type { Actor } from '@/types/auth/schema'
import type { PageDescriptionBody } from '@/types/content/p2-page-schema'
import { convertDocumentBodySchema, type LiveDocumentType } from '@/types/content/p4-live-schema'
import type { LancityDb } from '@/types/database/schema'

/** Who a document service call acts for. The user is the connection that made the change (Plane forwards its cookie). */
export type PageDocumentContext = { userId: number; workspaceSlug: string; projectId: number }

export type TDocumentPayload = {
  description_binary: string
  description_html: string
  description_json: unknown
}

export type TUserMention = { id: string; display_name: string; avatar_url?: string }

/**
 * PD-2258 to PD-2287: Plane's `APIService`, `PageCoreService`, `ProjectPageService` and `PageService` called Django over
 * HTTP with the user's cookie. Here they call the page services directly with the same user as actor, so the
 * permission rules of the page API apply to every read and write.
 */
export class PageDocumentService {
  private readonly actor: Actor

  constructor(
    private readonly db: LancityDb,
    private readonly context: PageDocumentContext
  ) {
    this.actor = { userId: context.userId }
  }

  /** PD-2272 */
  async fetchDetails(pageId: number): Promise<{ name: string | null; description_html: string | null }> {
    const page = (await getPage(this.db, this.actor, this.context.workspaceSlug, this.context.projectId, pageId)) as unknown as {
      name?: string | null
      descriptionHtml?: string | null
    }
    return { name: page.name ?? null, description_html: page.descriptionHtml ?? null }
  }

  /** PD-2273 */
  async fetchDescriptionBinary(pageId: number): Promise<Uint8Array> {
    return getPagesDescription(this.db, this.actor, this.context.workspaceSlug, this.context.projectId, pageId)
  }

  /** PD-2274 to PD-2278: update the title. An aborted call is dropped before it writes. */
  async updatePageProperties(pageId: number, params: { data: { name: string }; abortSignal?: AbortSignal }): Promise<void> {
    if (params.abortSignal?.aborted) throw new AppError('Aborted', { code: 'ABORT_ERROR' })
    try {
      await updatePage(this.db, this.actor, this.context.workspaceSlug, this.context.projectId, pageId, params.data)
    } catch (error) {
      throw AppError.from(error, { context: { operation: 'updatePageProperties', pageId } })
    }
  }

  /** PD-2279 */
  async updateDescriptionBinary(pageId: number, data: TDocumentPayload): Promise<void> {
    try {
      await updatePagesDescription(this.db, this.actor, this.context.workspaceSlug, this.context.projectId, pageId, {
        descriptionBinary: data.description_binary,
        descriptionHtml: data.description_html,
        descriptionJson: data.description_json as PageDescriptionBody['descriptionJson']
      })
    } catch (error) {
      throw AppError.from(error, { context: { operation: 'updateDescriptionBinary', pageId } })
    }
  }

  /**
   * PD-2280: users mentioned in the page. The page logs hold the mention ids that `page.transaction` extracted; users are
   * resolved to a display name and avatar. `mention_type=user_mention` is the only type Live asks for.
   */
  async fetchUserMentions(pageId: number): Promise<TUserMention[]> {
    const logs = await this.db
      .select({ id: pageLogs.entityIdentifier })
      .from(pageLogs)
      .where(and(eq(pageLogs.pageId, pageId), eq(pageLogs.entityName, 'user_mention'), isNull(pageLogs.deletedAt)))
    const ids = [...new Set(logs.map(log => log.id).filter((id): id is number => id !== null))]
    if (!ids.length) return []
    const rows = await this.db
      .select({ id: user.id, name: user.name, firstName: profiles.firstName, lastName: profiles.lastName, image: user.image })
      .from(user)
      .leftJoin(profiles, eq(profiles.userId, user.id))
      .where(inArray(user.id, ids))
    return rows.map(row => ({
      id: String(row.id),
      display_name: [row.firstName, row.lastName].filter(Boolean).join(' ') || row.name,
      ...(row.image ? { avatar_url: row.image } : {})
    }))
  }

  /** PD-2281, PD-2282: the API path that serves an image asset (Plane followed a 302 to a presigned URL). */
  async resolveImageAssetUrl(workspaceSlug: string, assetId: number): Promise<string | null> {
    const [asset] = await this.db
      .select({ id: fileAssets.id, entityType: fileAssets.entityType, projectId: fileAssets.projectId, issueId: fileAssets.issueId })
      .from(fileAssets)
      .innerJoin(workspaces, eq(workspaces.id, fileAssets.workspaceId))
      .where(and(eq(fileAssets.id, assetId), eq(workspaces.slug, workspaceSlug), isNull(fileAssets.deletedAt)))
      .limit(1)
    return asset ? assetUrl(asset, workspaceSlug) : null
  }

  /** PD-2283, PD-2284: resolve many assets at once. Unresolved ids are left out. */
  async resolveImageAssetUrls(workspaceSlug: string, assetIds: number[]): Promise<Map<number, string>> {
    const urlMap = new Map<number, string>()
    const results = await Promise.allSettled(assetIds.map(async id => ({ id, url: await this.resolveImageAssetUrl(workspaceSlug, id) })))
    for (const result of results) if (result.status === 'fulfilled' && result.value.url) urlMap.set(result.value.id, result.value.url)
    return urlMap
  }
}

/** PD-2286: only project pages are served (Plane `getPageService` rejects other document types). */
export function getPageService(documentType: LiveDocumentType | string, db: LancityDb, context: PageDocumentContext) {
  if (documentType !== 'project_page') throw new AppError(`Invalid document type: ${documentType}`, { code: 'INVALID_DOCUMENT_TYPE' })
  return new PageDocumentService(db, context)
}

/**
 * PD-2046 to PD-2049: `POST /live/convert-document/`. Validates the body (PD-2049), then converts the HTML to the JSON and
 * the binary state. Validation errors are returned in Plane's `{ message, context.validationErrors }` shape.
 */
export function convertDocument(body: unknown): { status: 200; body: { description_json: unknown; description_binary: string } } | { status: 400; body: unknown } {
  const parsed = convertDocumentBodySchema.safeParse(body)
  if (!parsed.success)
    return {
      status: 400,
      body: {
        message: 'Validation error',
        context: { validationErrors: parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })) }
      }
    }
  const { description_json, description_binary } = convertHtmlDocumentToAllFormats(parsed.data.description_html)
  return { status: 200, body: { description_json, description_binary } }
}
