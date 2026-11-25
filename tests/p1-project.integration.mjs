import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

const base = new URL(process.env.LANCITY_TEST_URL ?? 'http://localhost:4198')
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))
assert.ok(process.env.LANCITY_TEST_D1, 'Set LANCITY_TEST_D1 to the isolated Worker database')
const runId = randomUUID().replaceAll('-', '').slice(0, 12)
const ipSeed = parseInt(runId.slice(0, 4), 16)

async function request(path, { cookie, method = 'GET', body, ip } = {}) {
  const headers = new Headers({ origin: base.origin })
  if (cookie) headers.set('cookie', cookie)
  if (ip) headers.set('cf-connecting-ip', ip)
  if (body !== undefined) headers.set('content-type', 'application/json')
  return fetch(new URL(path, base), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
}

let ipCounter = 0
async function signup(suffix) {
  const username = `q${runId}${suffix}`
  const ip = `198.19.${(ipSeed >> 8) % 256}.${(ipSeed + ++ipCounter) % 256}`
  const res = await request('/api/auth/sign-up/email', {
    method: 'POST',
    ip,
    body: { name: suffix, username, email: `${username}@example.com`, password: 'isolated-test-password' }
  })
  assert.equal(res.status, 200)
  return {
    id: Number((await res.json()).user.id),
    ip,
    email: `${username}@example.com`,
    cookie: res.headers
      .getSetCookie()
      .map(value => value.split(';', 1)[0])
      .join('; ')
  }
}

const auth = user => ({ cookie: user.cookie, ip: user.ip })
const json = async (response, status) => {
  assert.equal(response.status, status, await response.clone().text())
  return response.status === 204 ? null : response.json()
}

test('project lifecycle, favorites, archive, deploy board, summary and preferences', async () => {
  const db = new DatabaseSync(process.env.LANCITY_TEST_D1, { timeout: 5_000 })
  try {
    const owner = await signup('owner')
    const member = await signup('member')
    const slug = `q${runId}`
    const workspace = await json(
      await request('/api/v1/workspaces', { ...auth(owner), method: 'POST', body: { name: `Lifecycle ${runId}`, slug } }),
      201
    )
    db.prepare('insert into workspace_members (workspace_id, member_id, role) values (?, ?, 15)').run(workspace.id, member.id)
    const path = `/api/v1/workspaces/${slug}/projects`

    // Create: defaults, admin membership, user property and a random logo.
    const project = await json(
      await request(path, { ...auth(owner), method: 'POST', body: { name: `Alpha ${runId}`, identifier: 'alp' } }),
      201
    )
    assert.equal(project.identifier, 'ALP')
    assert.equal(project.memberRole, 20)
    assert.equal(project.isFavorite, false)
    assert.equal(project.nextWorkItemSequence, 1)
    assert.equal(project.logoProps.in_use, 'icon')
    assert.deepEqual(project.members, [owner.id])
    assert.equal(
      db.prepare('select count(*) as count from project_user_properties where project_id = ? and user_id = ?').get(project.id, owner.id).count,
      1
    )
    assert.equal((await request(path, { ...auth(owner), method: 'POST', body: { name: `Alpha ${runId}`, identifier: 'ZZZ' } })).status, 409)
    assert.equal((await request(path, { ...auth(owner), method: 'POST', body: { name: 'Bad.Name', identifier: 'BAD' } })).status, 400)
    assert.equal(
      (await request(path, { ...auth(owner), method: 'POST', body: { name: `Lead ${runId}`, identifier: 'LD', projectLeadId: 999999999 } })).status,
      400
    )

    // Identifier check and release.
    const check = await json(await request(`/api/v1/workspaces/${slug}/project-identifiers?name=alp`, auth(owner)), 200)
    assert.equal(check.exists, 1)
    assert.equal(
      (await request(`/api/v1/workspaces/${slug}/project-identifiers`, { ...auth(owner), method: 'DELETE', body: { name: 'alp' } })).status,
      400
    )

    // Details list, fields filter and the paginated envelope.
    const details = await json(await request(`${path}/details?fields=id,name,isFavorite`, auth(owner)), 200)
    assert.deepEqual(Object.keys(details[0]).sort(), ['id', 'isFavorite', 'name'])
    const paged = await json(await request(`${path}/details?per_page=10&cursor=10:0:0`, auth(owner)), 200)
    assert.equal(paged.results.length, 1)
    assert.equal(paged.next_page_results, false)

    // Favorites.
    const favoritePath = `/api/v1/workspaces/${slug}/user-favorite-projects`
    await json(await request(favoritePath, { ...auth(owner), method: 'POST', body: { project: project.id } }), 204)
    await json(await request(favoritePath, { ...auth(owner), method: 'POST', body: { project: project.id } }), 204)
    assert.equal((await json(await request(favoritePath, auth(owner)), 200)).length, 1)
    assert.equal((await json(await request(`${path}/${project.id}`, auth(owner)), 200)).isFavorite, true)
    assert.equal((await request(favoritePath, { ...auth(member), method: 'POST', body: { project: project.id } })).status, 404)

    // Update: default state must belong to the project, intake view creates the default intake.
    assert.equal((await request(`${path}/${project.id}`, { ...auth(owner), method: 'PATCH', body: { defaultStateId: 999999999 } })).status, 400)
    const state = db.prepare('select id from states where project_id = ? and "default" = 1').get(project.id)
    const updated = await json(
      await request(`${path}/${project.id}`, {
        ...auth(owner),
        method: 'PATCH',
        body: { intakeView: true, defaultStateId: state.id, timezone: 'Asia/Ho_Chi_Minh' }
      }),
      200
    )
    assert.equal(updated.defaultStateId, state.id)
    assert.equal(updated.timezone, 'Asia/Ho_Chi_Minh')
    assert.equal(db.prepare('select count(*) as count from intakes where project_id = ? and is_default = 1').get(project.id).count, 1)
    await json(await request(`${path}/${project.id}`, { ...auth(owner), method: 'PATCH', body: { intakeView: true } }), 200)
    assert.equal(db.prepare('select count(*) as count from intakes where project_id = ? and is_default = 1').get(project.id).count, 1)

    // Deploy board: admin only, anchor is stable across repeated publishes.
    const boardPath = `${path}/${project.id}/project-deploy-boards`
    assert.deepEqual(await json(await request(boardPath, auth(owner)), 200), {})
    const board = await json(await request(boardPath, { ...auth(owner), method: 'POST', body: { isVotesEnabled: true } }), 200)
    assert.equal(board.isVotesEnabled, true)
    assert.equal(board.entityName, 'project')
    const again = await json(await request(boardPath, { ...auth(owner), method: 'POST', body: {} }), 200)
    assert.equal(again.anchor, board.anchor)
    assert.equal(again.id, board.id)
    assert.equal((await request(boardPath, { ...auth(owner), method: 'POST', body: { intakeId: 999999999 } })).status, 400)
    const patched = await json(
      await request(`${boardPath}/${board.id}`, { ...auth(owner), method: 'PATCH', body: { isCommentsEnabled: true } }),
      200
    )
    assert.equal(patched.isCommentsEnabled, true)
    assert.equal((await json(await request(`${path}/${project.id}`, auth(owner)), 200)).anchor, board.anchor)

    // Members: bulk add, role rules and own preferences.
    const membersPath = `${path}/${project.id}/members`
    const added = await json(
      await request(membersPath, { ...auth(owner), method: 'POST', body: { members: [{ memberId: member.id, role: 15 }] } }),
      201
    )
    assert.equal(added[0].role, 15)
    assert.equal(
      db.prepare('select count(*) as count from project_user_properties where project_id = ? and user_id = ?').get(project.id, member.id).count,
      1
    )
    assert.equal((await request(boardPath, { ...auth(member), method: 'POST', body: {} })).status, 403)
    const memberRow = db.prepare('select id from project_members where project_id = ? and member_id = ?').get(project.id, member.id)
    const detail = await json(await request(`${membersPath}/${memberRow.id}`, auth(owner)), 200)
    assert.equal(detail.preferences, undefined, 'personal fields are hidden from other members')
    assert.equal((await request(`${membersPath}/${memberRow.id}`, { ...auth(owner), method: 'PATCH', body: { preferences: { x: 1 } } })).status, 403)
    const mine = await json(await request(`${membersPath}/${memberRow.id}`, auth(member)), 200)
    assert.deepEqual(mine.preferences.navigation.default_tab, 'work_items')
    const prefPath = `${path}/${project.id}/preferences/member/${member.id}`
    const prefs = await json(await request(prefPath, { ...auth(member), method: 'PATCH', body: { pages: { block_display: false } } }), 200)
    assert.equal(prefs.preferences.pages.block_display, false)
    assert.equal(prefs.preferences.navigation.default_tab, 'work_items')
    assert.equal((await request(`${path}/${project.id}/preferences/member/${owner.id}`, auth(member))).status, 403)
    const me = await json(await request(`${path}/${project.id}/project-members/me`, auth(member)), 200)
    assert.equal(me.role, 15)
    const roles = await json(await request(`/api/v1/users/me/workspaces/${slug}/project-roles`, auth(member)), 200)
    assert.equal(roles[String(project.id)], 15)
    const lite = await json(await request(`${path}/${project.id}/project-members-lite?per_page=10&cursor=10:0:0`, auth(member)), 200)
    assert.equal(lite.total_count, 2)
    // A member cannot grant a role equal to or above their own, and the last admin cannot remove themselves.
    assert.equal((await request(`${membersPath}/${memberRow.id}`, { ...auth(member), method: 'PATCH', body: { role: 15 } })).status, 403)
    const ownerRow = db.prepare('select id from project_members where project_id = ? and member_id = ?').get(project.id, owner.id)
    // Plane rejects removing yourself through DELETE (use leave); the last-admin rule applies to leave only.
    assert.equal((await request(`${membersPath}/${ownerRow.id}`, { ...auth(owner), method: 'DELETE' })).status, 400)

    // Per-user view props.
    await json(
      await request(`${path}/${project.id}/project-views`, { ...auth(member), method: 'POST', body: { sortOrder: 5 } }),
      204
    )
    assert.equal(db.prepare('select sort_order from project_members where id = ?').get(memberRow.id).sort_order, 5)

    // Summary counts. Only workspace admins may read it.
    const summary = await json(await request(`${path}/${project.id}/summary?fields=members,states,issues`, auth(owner)), 200)
    assert.deepEqual(summary.counts, { members: 2, states: 6, issues: 0 })
    assert.equal((await request(`${path}/${project.id}/summary`, auth(member))).status, 403)

    // Archive removes favorites, blocks updates and can be undone.
    const archived = await json(await request(`${path}/${project.id}/archive`, { ...auth(owner), method: 'POST' }), 200)
    assert.ok(archived.archivedAt)
    assert.equal(db.prepare('select count(*) as count from user_favorites where project_id = ?').get(project.id).count, 0)
    assert.equal((await request(`${path}/${project.id}`, { ...auth(owner), method: 'PATCH', body: { name: `Nope ${runId}` } })).status, 400)
    assert.equal((await request(`${path}/${project.id}`, auth(owner))).status, 404)
    await json(await request(`${path}/${project.id}/archive`, { ...auth(owner), method: 'DELETE' }), 204)
    assert.equal((await request(`${path}/${project.id}`, auth(owner))).status, 200)

    // Delete: soft delete, boards removed, identifier released.
    assert.equal((await request(`${path}/${project.id}`, { ...auth(member), method: 'DELETE' })).status, 403)
    await json(await request(`${path}/${project.id}`, { ...auth(owner), method: 'DELETE' }), 204)
    assert.equal((await request(`${path}/${project.id}`, auth(owner))).status, 404)
    assert.ok(db.prepare('select deleted_at from projects where id = ?').get(project.id).deleted_at)
    assert.equal(db.prepare('select count(*) as count from deploy_boards where project_id = ? and deleted_at is null').get(project.id).count, 0)
    await json(await request(path, { ...auth(owner), method: 'POST', body: { name: `Beta ${runId}`, identifier: 'ALP' } }), 201)
  } finally {
    db.close()
  }
})

test('project invitations: invite, public lookup, accept, decline and self-join', async () => {
  const db = new DatabaseSync(process.env.LANCITY_TEST_D1, { timeout: 5_000 })
  try {
    const owner = await signup('inviter')
    const invited = await signup('invited')
    const declined = await signup('declined')
    const stranger = await signup('stranger')
    const slug = `i${runId}`
    const workspace = await json(
      await request('/api/v1/workspaces', { ...auth(owner), method: 'POST', body: { name: `Invites ${runId}`, slug } }),
      201
    )
    db.prepare('insert into workspace_members (workspace_id, member_id, role) values (?, ?, 15)').run(workspace.id, declined.id)
    const path = `/api/v1/workspaces/${slug}/projects`
    const project = await json(
      await request(path, { ...auth(owner), method: 'POST', body: { name: `Invite ${runId}`, identifier: 'INV' } }),
      201
    )
    const secret = await json(
      await request(path, { ...auth(owner), method: 'POST', body: { name: `Secret ${runId}`, identifier: 'SEC', network: 0 } }),
      201
    )
    const invitationsPath = `${path}/${project.id}/invitations`

    assert.equal((await request(invitationsPath, { ...auth(stranger), method: 'POST', body: { emails: [{ email: invited.email, role: 15 }] } })).status, 404)
    assert.equal((await request(invitationsPath, { ...auth(owner), method: 'POST', body: { emails: [] } })).status, 400)
    await json(
      await request(invitationsPath, {
        ...auth(owner),
        method: 'POST',
        body: { emails: [{ email: invited.email.toUpperCase(), role: 15 }, { email: declined.email, role: 15 }] }
      }),
      200
    )
    const listed = await json(await request(invitationsPath, auth(owner)), 200)
    assert.equal(listed.length, 2)
    assert.equal(listed[0].token, undefined, 'tokens are never listed')
    // Repeating the invitation refreshes the pending row.
    await json(await request(invitationsPath, { ...auth(owner), method: 'POST', body: { emails: [{ email: invited.email, role: 5 }] } }), 200)
    assert.equal((await json(await request(invitationsPath, auth(owner)), 200)).length, 2)

    const invite = db.prepare('select id, token, role from project_member_invites where project_id = ? and email = ?').get(project.id, invited.email)
    assert.equal(invite.role, 5)
    const joinPath = `${path}/${project.id}/join/${invite.id}`
    assert.equal((await request(joinPath)).status, 404, 'public lookup needs the token')
    const publicView = await json(await request(`${joinPath}?token=${invite.token}`), 200)
    assert.equal(publicView.email, undefined)
    assert.equal(publicView.token, undefined)
    assert.equal(publicView.project.identifier, 'INV')

    // Joining through an invitation needs a verified email.
    const unverified = await request(joinPath, { ...auth(invited), method: 'POST', body: { token: invite.token, accepted: true } })
    assert.equal(unverified.status, 403)
    assert.equal((await unverified.json()).error.code, 'EMAIL_NOT_VERIFIED')
    db.prepare('update user set email_verified = 1 where id in (?, ?)').run(invited.id, declined.id)

    assert.equal((await request(joinPath, { ...auth(invited), method: 'POST', body: { token: 'wrong', accepted: true } })).status, 403)
    assert.equal((await request(joinPath, { ...auth(stranger), method: 'POST', body: { token: invite.token, accepted: true } })).status, 403)
    assert.equal((await request(joinPath, { ...auth(invited), method: 'POST', body: { token: invite.token, accepted: 'yes' } })).status, 400)
    await json(await request(joinPath, { ...auth(invited), method: 'POST', body: { token: invite.token, accepted: true } }), 200)
    assert.equal((await request(joinPath, { ...auth(invited), method: 'POST', body: { token: invite.token, accepted: true } })).status, 400)
    const joined = db.prepare('select role, is_active from project_members where project_id = ? and member_id = ?').get(project.id, invited.id)
    assert.deepEqual({ ...joined }, { role: 5, is_active: 1 })
    assert.ok(db.prepare('select id from workspace_members where workspace_id = ? and member_id = ?').get(workspace.id, invited.id))
    assert.equal(
      db.prepare('select count(*) as count from project_user_properties where project_id = ? and user_id = ?').get(project.id, invited.id).count,
      1
    )

    const other = db.prepare('select id, token from project_member_invites where project_id = ? and email = ?').get(project.id, declined.email)
    await json(
      await request(`${path}/${project.id}/join/${other.id}`, { ...auth(declined), method: 'POST', body: { token: other.token, accepted: false } }),
      200
    )
    assert.equal(db.prepare('select count(*) as count from project_members where project_id = ? and member_id = ?').get(project.id, declined.id).count, 0)
    const mine = await json(await request(`/api/v1/users/me/workspaces/${slug}/projects/invitations`, auth(declined)), 200)
    assert.equal(mine.length, 1)
    assert.equal(mine[0].token, undefined)

    await json(await request(`${invitationsPath}/${other.id}`, { ...auth(owner), method: 'DELETE' }), 204)
    assert.equal((await request(`${invitationsPath}/${other.id}`, auth(owner))).status, 404)

    // Joining many projects at once: public ones only unless the caller is a workspace admin.
    const joinMany = `/api/v1/users/me/workspaces/${slug}/projects/invitations`
    assert.equal((await request(joinMany, { ...auth(declined), method: 'POST', body: { projectIds: [project.id, secret.id] } })).status, 403)
    await json(await request(joinMany, { ...auth(declined), method: 'POST', body: { projectIds: [project.id] } }), 201)
    assert.equal(db.prepare('select role from project_members where project_id = ? and member_id = ?').get(project.id, declined.id).role, 15)
    await json(await request(joinMany, { ...auth(declined), method: 'POST', body: { projectIds: [project.id] } }), 201)
    assert.equal(db.prepare('select count(*) as count from project_members where project_id = ? and member_id = ?').get(project.id, declined.id).count, 1)
  } finally {
    db.close()
  }
})
