import { coverImageUrlProject } from '@/server/project/model-rules'

type ProjectRow = {
  id: number
  coverImage: string | null
  coverImageAssetId: number | null
  intakeView: boolean
}

/** PD-0357 `ProjectListSerializer.get_members`: active member user ids. */
export function getMembersProjectList(members: number[] | undefined) {
  return members ?? []
}

/** PD-0358 `get_next_work_item_sequence`: the sequence that the next work item receives (`max + 1`, or 1). */
export function getNextWorkItemSequenceProjectList(maxSequence: number | null | undefined) {
  return maxSequence ? maxSequence + 1 : 1
}

/** Project DTO: the row plus `cover_image_url`, the `inbox_view` alias of `intake_view` and member ids. */
export function presentProject<T extends ProjectRow>(row: T, slug: string, members?: number[]) {
  return {
    ...row,
    coverImageUrl: coverImageUrlProject(row, slug),
    inboxView: row.intakeView,
    members: getMembersProjectList(members)
  }
}

/** Fields of Plane `ProjectLiteSerializer`. */
export function presentProjectLite(
  row: { id: number; identifier: string; name: string; coverImage: string | null; coverImageAssetId: number | null; logoProps: unknown; description: string },
  slug: string
) {
  return {
    id: row.id,
    identifier: row.identifier,
    name: row.name,
    coverImage: row.coverImage,
    coverImageUrl: coverImageUrlProject(row, slug),
    logoProps: row.logoProps,
    description: row.description
  }
}

/** Keep only the requested top-level fields (`?fields=a,b`). Empty input keeps everything. */
export function pickFields<T extends Record<string, unknown>>(row: T, fields: string[]) {
  if (!fields.length) return row
  return Object.fromEntries(Object.entries(row).filter(([key]) => fields.includes(key))) as Partial<T>
}

/** PD-1469 `Project.__str__`. */
export const formatProject = (project: { name: string }, workspace: { name: string }) => `${project.name} <${workspace.name}>`
/** PD-1473 `ProjectMemberInvite.__str__`. */
export const formatProjectMemberInvite = (invite: { email: string; accepted: boolean }, project: { name: string }) =>
  `${project.name} ${invite.email} ${invite.accepted}`
/** PD-1475 `ProjectMember.__str__`. */
export const formatProjectMember = (member: { email: string }, project: { name: string }) => `${member.email} <${project.name}>`
/** PD-1478 `ProjectDeployBoard.__str__`. */
export const formatProjectDeployBoard = (board: { anchor: string }, project: { name: string }) => `${board.anchor} <${project.name}>`
/** PD-1479 `ProjectUserProperty.__str__`. */
export const formatProjectUserProperty = (userName: string) => userName
