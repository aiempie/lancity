export type ApiTokenRow = {
  id: number
  label: string
  description: string
  userType: number
  userId: number
  workspaceId: number | null
  expiredAt: Date | null
  isActive: boolean
  lastUsed: Date | null
  createdAt: Date
  updatedAt: Date
}

/** Plane `APITokenReadSerializer.get_is_active`: a token without expiry is active, otherwise until `expiredAt`. */
export function getIsActiveApiTokenRead(expiredAt: Date | null, now = new Date()): boolean {
  return expiredAt === null || now < expiredAt
}

/**
 * `APITokenReadSerializer`: every column except the token. `isActive` is computed from the expiry, the stored
 * flag is ignored exactly like in Plane. Pass `token` only when the token was just created.
 */
export function toApiTokenResponse(row: ApiTokenRow, options: { token?: string; now?: Date } = {}) {
  return {
    id: row.id,
    label: row.label,
    description: row.description,
    userType: row.userType,
    userId: row.userId,
    workspaceId: row.workspaceId,
    expiredAt: row.expiredAt,
    lastUsed: row.lastUsed,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    isActive: getIsActiveApiTokenRead(row.expiredAt, options.now),
    ...(options.token === undefined ? {} : { token: options.token })
  }
}

/** Plane `APIToken.__str__`. */
export const formatApiToken = (token: { userId: number }) => String(token.userId)

/** Plane `APIActivityLog.__str__`. */
export const formatApiActivityLog = (log: { tokenIdentifier: string }) => log.tokenIdentifier

/** Plane `GithubRepository.__str__`. */
export const formatGithubRepository = (repository: { name: string }) => repository.name

/** Plane `GithubRepositorySync.__str__`. */
export const formatGithubRepositorySync = (sync: { repositoryName: string; projectName: string }) =>
  `${sync.repositoryName} <${sync.projectName}>`

/** Plane `GithubIssueSync.__str__`. */
export const formatGithubIssueSync = (sync: { repositoryName: string; projectName: string; issueName: string }) =>
  `${sync.repositoryName}-${sync.projectName}-${sync.issueName}`

/** Plane `GithubCommentSync.__str__`. */
export const formatGithubCommentSync = (sync: { commentId: number }) => String(sync.commentId)

/** Plane `SlackProjectSync.__str__`. */
export const formatSlackProjectSync = (sync: { projectName: string }) => sync.projectName
