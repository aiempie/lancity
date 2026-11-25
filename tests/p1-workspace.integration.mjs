// Needs the workspace routers mounted (see docs/plane-demo-porting/handoff/p1-workspace.md).
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

const base = new URL(process.env.LANCITY_TEST_URL ?? 'http://localhost:4198')
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))
assert.ok(process.env.LANCITY_TEST_D1)
const run = randomUUID().replaceAll('-', '').slice(0, 12)
const api = '/api/v1'

function request(path, { cookie, method = 'GET', body, ip } = {}) {
  const headers = new Headers()
  if (cookie) headers.set('cookie', cookie)
  if (ip) headers.set('cf-connecting-ip', ip)
  if (method !== 'GET') headers.set('origin', base.origin)
  if (body !== undefined) headers.set('content-type', 'application/json')
  return fetch(new URL(path, base), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual'
  })
}
async function json(response, status) {
  assert.equal(response.status, status, `${response.url} ${await response.clone().text()}`)
  return response.json()
}
async function signUp(suffix, ip) {
  const username = `p1${run}${suffix}`
  const email = `${username}@example.com`
  const response = await request('/api/auth/sign-up/email', {
    method: 'POST',
    ip,
    body: { username, email, name: suffix, password: 'isolated-test-password' }
  })
  const { user } = await json(response, 200)
  return {
    id: Number(user.id),
    email,
    cookie: response.headers
      .getSetCookie()
      .map(value => value.split(';', 1)[0])
      .join('; ')
  }
}
async function waitFor(check, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    const value = check()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  return undefined
}

test('workspace CRUD, filters, seed and slug reuse after deletion', async () => {
  const db = new DatabaseSync(process.env.LANCITY_TEST_D1, { timeout: 5_000 })
  try {
    const owner = await signUp('crud', '198.18.231.1')
    const slug = `crud-${run}`
    const created = await json(
      await request(`${api}/workspaces`, { ...owner, method: 'POST', body: { name: 'Crud Space', slug, seed: true } }),
      201
    )
    assert.equal(created.totalMembers, 1)
    assert.equal(created.role, 20)
    const seeded = await waitFor(() =>
      db.prepare('SELECT id, cycle_view FROM projects WHERE workspace_id = ? AND deleted_at IS NULL').get(created.id)
    )
    assert.ok(seeded, 'seed job created the sample project')
    assert.equal(seeded.cycle_view, 1)
    assert.ok(db.prepare('SELECT count(*) AS n FROM states WHERE project_id = ?').get(seeded.id).n >= 5)

    const filtered = await json(await request(`${api}/workspaces?search=crud%20sp`, owner), 200)
    assert.equal(filtered.length, 1)
    assert.equal(filtered[0].totalMembers, 1)
    assert.deepEqual(await json(await request(`${api}/workspaces?search=zzzzzz${run}`, owner), 200), [])
    const flat = await json(await request(`${api}/users/me/workspaces?fields=slug,role`, owner), 200)
    assert.deepEqual(flat[0], { slug, role: 20 })

    const put = await json(
      await request(`${api}/workspaces/${slug}`, { ...owner, method: 'PUT', body: { name: 'Crud Renamed' } }),
      200
    )
    assert.equal(put.name, 'Crud Renamed')

    assert.equal((await request(`${api}/workspaces/${slug}`, { ...owner, method: 'DELETE' })).status, 204)
    assert.equal((await request(`${api}/workspaces/${slug}`, owner)).status, 404)
    const row = db.prepare('SELECT slug, deleted_at FROM workspaces WHERE id = ?').get(created.id)
    assert.ok(row.deleted_at)
    assert.match(row.slug, new RegExp(`^${slug}__\\d+$`))
    assert.deepEqual(await json(await request(`${api}/workspace-slug-check?slug=${slug}`, owner), 200), {
      status: true
    })
  } finally {
    db.close()
  }
})

test('members: lite directory, own membership, view props, leave guards and themes', async () => {
  const db = new DatabaseSync(process.env.LANCITY_TEST_D1, { timeout: 5_000 })
  try {
    const owner = await signUp('members', '198.18.231.2')
    const member = await signUp('member2', '198.18.231.3')
    const slug = `members-${run}`
    const workspace = await json(
      await request(`${api}/workspaces`, { ...owner, method: 'POST', body: { name: 'Members', slug } }),
      201
    )
    db.prepare('INSERT INTO workspace_members (workspace_id, member_id, role) VALUES (?, ?, 15)').run(
      workspace.id,
      member.id
    )
    const path = `${api}/workspaces/${slug}`
    const list = await json(await request(`${path}/members`, owner), 200)
    assert.equal(list.length, 2)
    assert.ok(list.every(item => item.member.display_name && item.member.email))
    assert.equal((await json(await request(`${path}/members?search=member2`, owner), 200)).length, 1)
    const lite = await json(await request(`${path}/members-lite?per_page=1`, owner), 200)
    assert.equal(lite.results.length, 1)
    assert.equal(lite.total_results, 2)
    assert.equal(lite.next_page_results, true)
    const one = await json(await request(`${path}/members/${list[0].id}`, owner), 200)
    assert.equal(one.id, list[0].id)

    const me = await json(await request(`${path}/workspace-members/me`, member), 200)
    assert.equal(me.role, 15)
    assert.equal(me.draftIssueCount, 0)
    assert.equal(
      (
        await request(`${path}/workspace-views`, {
          ...member,
          method: 'POST',
          body: { view_props: { layout: 'kanban' } }
        })
      ).status,
      204
    )
    assert.equal(
      JSON.parse(
        db
          .prepare('SELECT view_props FROM workspace_members WHERE workspace_id = ? AND member_id = ?')
          .get(workspace.id, member.id).view_props
      ).layout,
      'kanban'
    )
    assert.deepEqual(await json(await request(`${path}/project-members`, member), 200), {})

    const theme = await json(
      await request(`${path}/workspace-themes`, {
        ...member,
        method: 'POST',
        body: { name: 'Dark', colors: { a: '#000' } }
      }),
      201
    )
    assert.equal(
      (await request(`${path}/workspace-themes`, { ...member, method: 'POST', body: { name: 'Dark' } })).status,
      409
    )
    assert.equal(
      (
        await json(
          await request(`${path}/workspace-themes/${theme.id}`, {
            ...member,
            method: 'PATCH',
            body: { name: 'Night' }
          }),
          200
        )
      ).name,
      'Night'
    )
    assert.equal((await json(await request(`${path}/workspace-themes`, owner), 200)).length, 1)
    assert.equal((await request(`${path}/workspace-themes/${theme.id}`, { ...member, method: 'DELETE' })).status, 204)
    assert.equal((await request(`${path}/workspace-themes/${theme.id}`, owner)).status, 404)

    assert.equal((await request(`${path}/members/leave`, { ...owner, method: 'POST' })).status, 400)
    assert.equal((await request(`${path}/members/leave`, { ...member, method: 'POST' })).status, 204)
    assert.equal(
      db
        .prepare('SELECT is_active FROM workspace_members WHERE workspace_id = ? AND member_id = ?')
        .get(workspace.id, member.id).is_active,
      0
    )
    assert.equal((await request(path, member)).status, 404)
  } finally {
    db.close()
  }
})

test('bulk invitations, token join and accepting several invitations', async () => {
  const db = new DatabaseSync(process.env.LANCITY_TEST_D1, { timeout: 5_000 })
  try {
    const owner = await signUp('inviter', '198.18.231.4')
    const first = await signUp('guest1', '198.18.231.5')
    const second = await signUp('guest2', '198.18.231.6')
    const slug = `bulk-${run}`
    const workspace = await json(
      await request(`${api}/workspaces`, { ...owner, method: 'POST', body: { name: 'Bulk', slug } }),
      201
    )
    const invitations = `${api}/workspaces/${slug}/invitations`
    assert.equal((await request(invitations, { ...owner, method: 'POST', body: { emails: [] } })).status, 400)
    assert.equal(
      (await request(invitations, { ...owner, method: 'POST', body: { emails: [{ email: owner.email, role: 5 }] } }))
        .status,
      400
    )
    assert.deepEqual(
      await json(
        await request(invitations, {
          ...owner,
          method: 'POST',
          body: {
            emails: [
              { email: first.email, role: 15 },
              { email: second.email.toUpperCase(), role: 5 },
              { email: first.email, role: 15 }
            ]
          }
        }),
        200
      ),
      { message: 'Emails sent successfully' }
    )
    // Re-sending is ignored for addresses that are already invited.
    await json(
      await request(invitations, { ...owner, method: 'POST', body: { emails: [{ email: first.email }] } }),
      200
    )
    const list = await json(await request(invitations, owner), 200)
    assert.equal(list.length, 2)
    assert.ok(list.every(item => !('token' in item)))
    assert.equal(
      (
        await request(invitations, {
          ...owner,
          method: 'POST',
          body: { emails: [{ email: 'x@example.com', role: 20 }] }
        })
      ).status,
      200
    )

    db.prepare('UPDATE user SET email_verified = 1 WHERE id IN (?, ?)').run(first.id, second.id)
    const row = db
      .prepare('SELECT id, token FROM workspace_member_invites WHERE workspace_id = ? AND lower(email) = ?')
      .get(workspace.id, first.email)
    const join = `${invitations}/${row.id}/join`
    assert.equal((await request(join)).status, 400, 'token query is required')
    assert.equal((await request(`${join}?token=wrong`)).status, 403)
    const publicInvite = await json(await request(`${join}?token=${row.token}`), 200)
    assert.equal(publicInvite.workspace.slug, slug)
    assert.equal(publicInvite.token, undefined)
    assert.equal(
      (await request(join, { ...first, method: 'POST', body: { token: 'wrong', accepted: true } })).status,
      403
    )
    assert.equal(
      (await request(join, { ...second, method: 'POST', body: { token: row.token, accepted: true } })).status,
      403
    )
    assert.equal((await request(join, { method: 'POST', body: { token: row.token, accepted: true } })).status, 401)
    assert.deepEqual(
      await json(await request(join, { ...first, method: 'POST', body: { token: row.token, accepted: true } }), 200),
      {
        message: 'Workspace Invitation Accepted'
      }
    )
    assert.equal(
      db
        .prepare('SELECT role FROM workspace_members WHERE workspace_id = ? AND member_id = ?')
        .get(workspace.id, first.id).role,
      15
    )
    assert.equal(
      db.prepare('SELECT last_workspace_id FROM profiles WHERE user_id = ?').get(first.id)?.last_workspace_id ??
        workspace.id,
      workspace.id
    )
    assert.equal(
      (await request(join, { ...first, method: 'POST', body: { token: row.token, accepted: true } })).status,
      400
    )

    const mine = await json(await request(`${api}/users/me/workspaces/invitations`, second), 200)
    assert.equal(mine.length, 1)
    assert.equal(
      (
        await request(`${api}/users/me/workspaces/invitations`, {
          ...second,
          method: 'POST',
          body: { invitations: [mine[0].id] }
        })
      ).status,
      204
    )
    assert.equal(
      db
        .prepare('SELECT role FROM workspace_members WHERE workspace_id = ? AND member_id = ?')
        .get(workspace.id, second.id).role,
      5
    )
  } finally {
    db.close()
  }
})

test('home widgets, recent visits, user properties and profile statistics', async () => {
  const db = new DatabaseSync(process.env.LANCITY_TEST_D1, { timeout: 5_000 })
  try {
    const owner = await signUp('home', '198.18.231.7')
    const slug = `home-${run}`
    const workspace = await json(
      await request(`${api}/workspaces`, { ...owner, method: 'POST', body: { name: 'Home', slug } }),
      201
    )
    const project = await json(
      await request(`${api}/workspaces/${slug}/projects`, {
        ...owner,
        method: 'POST',
        body: { name: 'Home Project', identifier: 'HOME' }
      }),
      201
    )
    const path = `${api}/workspaces/${slug}`
    const widgets = await json(await request(`${path}/home-preferences`, owner), 200)
    assert.deepEqual(widgets.map(item => item.key).sort(), ['my_stickies', 'quick_links', 'recents'])
    const patched = await json(
      await request(`${path}/home-preferences/recents`, { ...owner, method: 'PATCH', body: { is_enabled: false } }),
      200
    )
    assert.equal(patched.is_enabled, false)
    assert.equal(
      (
        await request(`${path}/home-preferences/new_at_plane`, {
          ...owner,
          method: 'PATCH',
          body: { is_enabled: false }
        })
      ).status,
      400
    )

    assert.equal(
      (
        await request(`${path}/recent-visits`, {
          ...owner,
          method: 'POST',
          body: { entity_name: 'project', entity_identifier: project.id }
        })
      ).status,
      200
    )
    await request(`${path}/recent-visits`, {
      ...owner,
      method: 'POST',
      body: { entity_name: 'project', entity_identifier: project.id }
    })
    const visits = await json(await request(`${path}/recent-visits?entity_name=project`, owner), 200)
    assert.equal(visits.length, 1)
    assert.equal(visits[0].entity_data.identifier, 'HOME')
    assert.equal(
      (
        await request(`${path}/recent-visits`, {
          ...owner,
          method: 'POST',
          body: { entity_name: 'project', entity_identifier: 999999 }
        })
      ).status,
      404
    )

    const properties = await json(await request(`${path}/user-properties`, owner), 200)
    assert.equal(properties.navigationControlPreference, 'ACCORDION')
    assert.equal(
      (
        await json(
          await request(`${path}/user-properties`, {
            ...owner,
            method: 'PATCH',
            body: { navigation_project_limit: 3 }
          }),
          200
        )
      ).navigationProjectLimit,
      3
    )

    const profile = await json(await request(`${path}/user-profile/${owner.id}`, owner), 200)
    assert.equal(profile.user_data.email, owner.email)
    assert.equal(profile.project_data.length, 1)
    const stats = await json(await request(`${path}/user-stats/${owner.id}`, owner), 200)
    assert.equal(stats.assigned_issues, 0)
    assert.deepEqual(stats.present_cycles, [])
    const issues = await json(await request(`${path}/user-issues/${owner.id}?per_page=5&group_by=priority`, owner), 200)
    assert.equal(issues.total_results, 0)
    assert.equal(issues.grouped_by, 'priority')
    const activity = await json(await request(`${path}/user-activity/${owner.id}`, owner), 200)
    assert.equal(activity.total_results, 0)
    const dashboard = await json(await request(`${api}/users/me/workspaces/${slug}/dashboard`, owner), 200)
    assert.equal(dashboard.assigned_issues_count, 0)
    assert.ok(Array.isArray(dashboard.overdue_issues))
    assert.ok(Array.isArray(await json(await request(`${api}/users/me/workspaces/${slug}/activity-graph`, owner), 200)))
    assert.ok(
      Array.isArray(
        await json(await request(`${api}/users/me/workspaces/${slug}/issues-completed-graph?month=2`, owner), 200)
      )
    )
    const last = await json(await request(`${api}/users/last-visited-workspace`, owner), 200)
    assert.ok('workspace_details' in last)

    const exportPath = `${path}/user-activity/${owner.id}/export`
    assert.equal((await request(exportPath, { ...owner, method: 'POST', body: {} })).status, 400)
    const csv = await request(exportPath, { ...owner, method: 'POST', body: { date: '2026-01-01' } })
    assert.equal(csv.status, 200)
    assert.match(csv.headers.get('content-type') ?? '', /text\/csv/)
    assert.match(await csv.text(), /^"Actor name","Issue ID","Project"/)
    assert.ok(workspace.id)
  } finally {
    db.close()
  }
})
