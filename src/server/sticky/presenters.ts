import type { stickies } from '@/db/schema/notification'

type StickyRow = typeof stickies.$inferSelect

/** Plane `StickySerializer` (`fields = "__all__"`): every column in snake_case, binary content as base64. */
export function presentSticky(row: StickyRow) {
  let binary: string | null = null
  if (row.descriptionBinary) {
    let text = ''
    for (const byte of new Uint8Array(row.descriptionBinary)) text += String.fromCharCode(byte)
    binary = btoa(text)
  }
  return {
    id: row.id,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    created_by: row.createdById,
    updated_by: row.updatedById,
    deleted_at: row.deletedAt,
    name: row.name,
    description: row.description,
    description_html: row.descriptionHtml,
    description_stripped: row.descriptionStripped,
    description_binary: binary,
    logo_props: row.logoProps,
    color: row.color,
    background_color: row.backgroundColor,
    workspace: row.workspaceId,
    owner: row.ownerId,
    sort_order: row.sortOrder
  }
}

/** `Sticky.__str__` (PD-1491): `str(self.name)`, so a missing name prints as "None". */
export function formatSticky(name: string | null | undefined): string {
  return String(name ?? 'None')
}
