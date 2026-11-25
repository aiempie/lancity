import { eq, sql } from 'drizzle-orm'
import { SQLiteAsyncDialect } from 'drizzle-orm/sqlite-core'
import { user } from '@/db/schema/auth'
import { ServiceError } from '@/server/common/errors'
import type { Actor } from '@/types/auth/schema'
import type { LancityDb } from '@/types/database/schema'

const dialect = new SQLiteAsyncDialect()

/** Redeem accepted invitations belonging to the authenticated, verified email address atomically. */
export async function processWorkspaceProjectInvitations(db: LancityDb, actor: Actor) {
  const [account] = await db
    .select({ email: user.email, emailVerified: user.emailVerified })
    .from(user)
    .where(eq(user.id, actor.userId))
  if (!account) throw new ServiceError(401, 'UNAUTHORIZED', 'Authentication required')
  if (!account.emailVerified) return
  const email = account.email
  const statements = [
    sql`insert into workspace_members (workspace_id, member_id, role, created_by_id)
      select i.workspace_id, ${actor.userId}, i.role, i.created_by_id from workspace_member_invites i
      join workspaces w on w.id = i.workspace_id and w.deleted_at is null
      where i.email = ${email} and i.accepted = 1 and i.deleted_at is null
      on conflict do nothing`,
    sql`insert into workspace_members (workspace_id, member_id, role, created_by_id)
      select i.workspace_id, ${actor.userId}, case when i.role in (5, 15) then i.role else 15 end, i.created_by_id
      from project_member_invites i join workspaces w on w.id = i.workspace_id and w.deleted_at is null
      join projects p on p.id = i.project_id and p.workspace_id = i.workspace_id and p.deleted_at is null
      where i.email = ${email} and i.accepted = 1 and i.deleted_at is null
      on conflict do nothing`,
    sql`insert into project_members (workspace_id, project_id, member_id, role, created_by_id)
      select i.workspace_id, i.project_id, ${actor.userId}, min(m.role, i.role, 15), i.created_by_id
      from project_member_invites i join workspaces w on w.id = i.workspace_id and w.deleted_at is null
      join projects p on p.id = i.project_id and p.workspace_id = i.workspace_id and p.deleted_at is null
      join workspace_members m on m.workspace_id = i.workspace_id and m.member_id = ${actor.userId} and m.is_active = 1 and m.deleted_at is null
      where i.email = ${email} and i.accepted = 1 and i.deleted_at is null
      on conflict do nothing`,
    sql`delete from workspace_member_invites where email = ${email} and accepted = 1 and deleted_at is null
      and exists (select 1 from workspace_members m join workspaces w on w.id = m.workspace_id
        where m.workspace_id = workspace_member_invites.workspace_id and m.member_id = ${actor.userId} and m.is_active = 1 and m.deleted_at is null and w.deleted_at is null)`,
    sql`delete from project_member_invites where email = ${email} and accepted = 1 and deleted_at is null
      and exists (select 1 from project_members m join projects p on p.id = m.project_id and p.workspace_id = m.workspace_id
        join workspaces w on w.id = m.workspace_id
        where m.project_id = project_member_invites.project_id and m.workspace_id = project_member_invites.workspace_id
        and m.member_id = ${actor.userId} and m.is_active = 1 and m.deleted_at is null and p.deleted_at is null and w.deleted_at is null)`
  ]
  await db.$client.batch(
    statements.map(query => {
      const { sql: statement, params } = dialect.sqlToQuery(query)
      return db.$client.prepare(statement).bind(...params)
    })
  )
}
