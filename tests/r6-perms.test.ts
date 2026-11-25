import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { getDb } from '../src/db/client'
import { createLocalD1 } from '../scripts/maintenance/d1-shim'
import { createProjectBulkAsset } from '../src/server/asset/v2'
import { getCycleIssue } from '../src/server/cycle/issue'
import { listArchivedCycles } from '../src/server/cycle/archive'
import { retrieveCycle } from '../src/server/cycle/service'
import { createProjectJoin } from '../src/server/project/invite'
import { listProjectMembers } from '../src/server/project/member'
import { createWorkspaceInvitation, createWorkspaceInvitations } from '../src/server/workspace/invite'
import { leaveWorkspaceMember, removeWorkspaceMember } from '../src/server/workspace/member'
import { listWorkspaces } from '../src/server/workspace/service'
import { deleteWorkspace } from '../src/server/workspace/service'

// Users: 1 owner/admin, 2 second admin, 3 member, 4 guest, 5 bot (member), 6 unverified invitee.
function openDb() {
  const raw = new DatabaseSync(':memory:')
  for (const name of ['0000_auth.sql', '0001_plane_domain.sql', '0002_issue_relation_workspace_scope.sql', '0003_backend_extensions.sql'])
    raw.exec(readFileSync(`drizzle/${name}`, 'utf8'))
  raw.exec(`PRAGMA foreign_keys = ON;
    INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES
      (1, 'Owner', 'owner@example.com', 1, 1, 1), (2, 'Admin2', 'admin2@example.com', 1, 1, 1),
      (3, 'Member', 'member@example.com', 1, 1, 1), (4, 'Guest', 'guest@example.com', 1, 1, 1),
      (5, 'Bot', 'bot@example.com', 1, 1, 1), (6, 'Invitee', 'invitee@example.com', 0, 1, 1);
    INSERT INTO user_security (user_id, is_bot) VALUES (1, 0), (2, 0), (3, 0), (4, 0), (5, 1), (6, 0)
      ON CONFLICT (user_id) DO UPDATE SET is_bot = excluded.is_bot;
    INSERT INTO workspaces (id, name, slug, owner_id) VALUES (1, 'Workspace', 'ws', 1);
    INSERT INTO workspace_members (workspace_id, member_id, role) VALUES (1, 1, 20), (1, 2, 20), (1, 3, 15), (1, 4, 5), (1, 5, 15), (1, 6, 15);
    INSERT INTO projects (id, name, identifier, workspace_id, network) VALUES (1, 'First', 'FIRST', 1, 2), (2, 'Solo', 'SOLO', 1, 2);
    INSERT INTO project_members (workspace_id, project_id, member_id, role) VALUES
      (1, 1, 1, 20), (1, 1, 2, 20), (1, 1, 3, 15), (1, 1, 4, 5), (1, 1, 5, 15),
      (1, 2, 3, 20);`)
  const db = getDb(createLocalD1(raw))
  return { raw, db }
}
const as = (userId: number) => ({ userId })
const rejects = (code: string) => (error: unknown) => (error as { code?: string }).code === code

test('a workspace member can invite, but not above their own role (Plane WorkSpaceAdminPermission)', async () => {
  const { db } = openDb()
  const created = await createWorkspaceInvitations(db, as(3), 'ws', { emails: [{ email: 'new@example.com', role: 15 }] })
  assert.equal(created.length, 1)
  await assert.rejects(
    createWorkspaceInvitations(db, as(3), 'ws', { emails: [{ email: 'boss@example.com', role: 20 }] }),
    rejects('FORBIDDEN')
  )
  const single = await createWorkspaceInvitation(db, as(3), 'ws', { email: 'single@example.com', role: 5 } as never)
  assert.equal(single.role, 5)
  await assert.rejects(createWorkspaceInvitations(db, as(4), 'ws', { emails: [{ email: 'g@example.com', role: 5 }] }), rejects('FORBIDDEN'))
})

test('any workspace admin can delete the workspace, a member cannot', async () => {
  const { db, raw } = openDb()
  await assert.rejects(deleteWorkspace(db, as(3), 'ws'), rejects('FORBIDDEN'))
  await deleteWorkspace(db, as(2), 'ws')
  assert.ok((raw.prepare('select deleted_at from workspaces where id = 1').get() as { deleted_at: number }).deleted_at)
})

test('guests cannot retrieve cycles, read the cycle archive or a cycle issue; members can', async () => {
  const { db } = openDb()
  await assert.rejects(retrieveCycle(db, as(4), 'ws', 1, 1), rejects('FORBIDDEN'))
  await assert.rejects(listArchivedCycles(db, as(4), 'ws', 1), rejects('FORBIDDEN'))
  await assert.rejects(getCycleIssue(db, as(4), 'ws', 1, 1, 1), rejects('FORBIDDEN'))
  assert.deepEqual(await listArchivedCycles(db, as(3), 'ws', 1), [])
  await assert.rejects(retrieveCycle(db, as(3), 'ws', 1, 99), rejects('CYCLE_NOT_FOUND'))
})

test('joining a project by invitation needs a verified e-mail', async () => {
  const { db, raw } = openDb()
  raw.exec(`INSERT INTO project_member_invites (id, email, token, role, workspace_id, project_id) VALUES (1, 'invitee@example.com', 'tok', 15, 1, 1)`)
  await assert.rejects(createProjectJoin(db, as(6), 'ws', 1, 1, { token: 'tok', accepted: true }), rejects('EMAIL_NOT_VERIFIED'))
  assert.equal((raw.prepare('select responded_at from project_member_invites where id = 1').get() as { responded_at: unknown }).responded_at, null)
  // A decline of the same invitation by a verified user reaches the write path.
  raw.exec('UPDATE user SET email_verified = 1 WHERE id = 6')
  const result = await createProjectJoin(db, as(6), 'ws', 1, 1, { token: 'tok', accepted: false })
  assert.equal(result.message, 'Project Invitation was not accepted')
})

test('accepting a project invitation joins the project in one batch (db.run with parameters)', async () => {
  const { db, raw } = openDb()
  raw.exec(`UPDATE user SET email_verified = 1 WHERE id = 6;
    INSERT INTO project_member_invites (id, email, token, role, workspace_id, project_id) VALUES (1, 'invitee@example.com', 'tok', 15, 1, 1)`)
  await createProjectJoin(db, as(6), 'ws', 1, 1, { token: 'tok', accepted: true })
  const member = raw.prepare('select role, is_active as active from project_members where project_id = 1 and member_id = 6 and deleted_at is null').get() as { role: number; active: number }
  assert.deepEqual({ ...member }, { role: 15, active: 1 })
  const invite = raw.prepare('select responded_at as r from project_member_invites where id = 1').get() as { r: unknown }
  assert.ok(invite.r)
  await assert.rejects(createProjectJoin(db, as(6), 'ws', 1, 1, { token: 'tok', accepted: true }), rejects('ALREADY_RESPONDED'))
})

test('a project cover bulk call never turns an attachment into the cover', async () => {
  const { db, raw } = openDb()
  raw.exec(`INSERT INTO file_assets (id, asset, workspace_id, created_by_id, entity_type, created_at) VALUES
    (1, 'k/attachment', 1, 1, 'ISSUE_ATTACHMENT', 1000), (2, 'k/cover', 1, 1, 'PROJECT_COVER', 2000)`)
  await createProjectBulkAsset(db, as(1), 'ws', 1, 1, { asset_ids: [1, 2] })
  const project = raw.prepare('select cover_image_asset_id as c from projects where id = 1').get() as { c: number }
  assert.equal(project.c, 2)
  const attachment = raw.prepare('select project_id as p from file_assets where id = 1').get() as { p: number | null }
  assert.equal(attachment.p, null)
})

test('bots are left out of member counts and lists', async () => {
  const { db } = openDb()
  const [row] = await listWorkspaces(db, as(1))
  assert.equal(row.totalMembers, 5)
  const members = await listProjectMembers(db, as(1), 'ws', 1)
  assert.equal(members.some(member => member.memberId === 5), false)
})

test('last-admin rules follow Plane: only an admin who is the sole project member is blocked', async () => {
  const { db, raw } = openDb()
  // User 3 is the only member of project 2 (admin there), so removal and leave are refused.
  await assert.rejects(removeWorkspaceMember(db, as(1), 'ws', 3), rejects('SOLE_PROJECT_ADMIN'))
  await assert.rejects(leaveWorkspaceMember(db, as(3), 'ws'), rejects('SOLE_PROJECT_ADMIN'))
  // User 2 shares project 1 with another admin and is no sole member: Plane allows removal.
  raw.exec('UPDATE project_members SET role = 15 WHERE project_id = 1 AND member_id IN (1, 3)')
  await removeWorkspaceMember(db, as(1), 'ws', 2)
  assert.equal((raw.prepare('select is_active as a from workspace_members where member_id = 2').get() as { a: number }).a, 0)
})
