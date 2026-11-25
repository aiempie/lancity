import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

const base = new URL(process.env.LANCITY_TEST_URL ?? 'http://localhost:4198')
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))
assert.ok(process.env.LANCITY_TEST_D1)
const run = randomUUID().replaceAll('-', '').slice(0, 12)
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
  const username = `test${run}${suffix}`
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

// Views, favorites, workspace view issues and the three searches of the p3-view-search port.
// Needs the routes of docs/plane-demo-porting/handoff/p3-view-search.md mounted in the Worker under test.
test('project views: defaults, favorites, filters and retrieve', async () => {
  const owner = await signUp('owner', '198.18.224.1')
  const slug = `view-${run}`
  const workspace = await json(
    await request('/api/v1/workspaces', { ...owner, method: 'POST', body: { name: 'Views', slug } }),
    201
  )
  const project = await json(
    await request(`/api/v1/workspaces/${slug}/projects`, {
      ...owner,
      method: 'POST',
      body: { name: 'Views', identifier: 'VIEWS' }
    }),
    201
  )
  assert.ok(workspace.id)
  const workspaceView = await json(
    await request(`/api/v1/workspaces/${slug}/views`, {
      ...owner,
      method: 'POST',
      body: { name: 'Workspace view' }
    }),
    201
  )
  assert.equal(
    (
      await request(`/api/v1/workspaces/${slug}/views/${workspaceView.id}`, {
        ...owner,
        method: 'PUT',
        body: { name: 'Changed' }
      })
    ).status,
    405
  )
  assert.equal(
    (await json(await request(`/api/v1/workspaces/${slug}/views/${workspaceView.id}`, owner), 200)).name,
    'Workspace view'
  )
  const projectPath = `/api/v1/workspaces/${slug}/projects/${project.id}`
  const first = await json(
    await request(`${projectPath}/views`, {
      ...owner,
      method: 'POST',
      body: { name: 'Zeta', filters: { priority: ['high'], state: null } }
    }),
    201
  )
  assert.deepEqual(first.query, { priority: ['high'] })
  assert.equal(first.displayFilters.layout, 'list')
  assert.equal(first.displayProperties.key, true)
  const second = await json(
    await request(`${projectPath}/views`, { ...owner, method: 'POST', body: { name: 'Alpha' } }),
    201
  )
  assert.equal(
    (await request(`${projectPath}/views/${first.id}`, { ...owner, method: 'PUT', body: { name: 'Changed' } })).status,
    405
  )
  assert.equal((await json(await request(`${projectPath}/views/${first.id}`, owner), 200)).name, 'Zeta')
  assert.equal(second.sortOrder, first.sortOrder + 10000)
  assert.deepEqual(
    (await json(await request(`${projectPath}/views`, owner), 200)).map(item => item.name),
    ['Alpha', 'Zeta']
  )
  // Favorites sort first and the entry is idempotent.
  assert.equal(
    (await request(`${projectPath}/user-favorite-views`, { ...owner, method: 'POST', body: { view: first.id } }))
      .status,
    204
  )
  const favorites = await json(await request(`${projectPath}/user-favorite-views`, owner), 200)
  assert.equal(favorites.length, 1)
  assert.equal(favorites[0].entityIdentifier, first.id)
  assert.equal(favorites[0].entityType, 'view')
  assert.equal(favorites[0].projectId, project.id)
  const otherProject = await json(
    await request(`/api/v1/workspaces/${slug}/projects`, {
      ...owner,
      method: 'POST',
      body: { name: 'Other views', identifier: 'OTHER' }
    }),
    201
  )
  assert.deepEqual(
    await json(await request(`/api/v1/workspaces/${slug}/projects/${otherProject.id}/user-favorite-views`, owner), 200),
    []
  )
  const otherUser = await signUp('other', '198.18.224.4')
  const db = new DatabaseSync(process.env.LANCITY_TEST_D1, { timeout: 5_000 })
  try {
    db.prepare('INSERT INTO workspace_members (workspace_id, member_id, role) VALUES (?, ?, 15)').run(
      workspace.id,
      otherUser.id
    )
    db.prepare('INSERT INTO project_members (workspace_id, project_id, member_id, role) VALUES (?, ?, ?, 15)').run(
      workspace.id,
      project.id,
      otherUser.id
    )
  } finally {
    db.close()
  }
  assert.deepEqual(await json(await request(`${projectPath}/user-favorite-views`, otherUser), 200), [])
  assert.equal(
    (await request(`${projectPath}/user-favorite-views`, { ...owner, method: 'POST', body: { view: first.id } }))
      .status,
    204
  )
  const listed = await json(await request(`${projectPath}/views`, owner), 200)
  assert.deepEqual(
    listed.map(item => [item.name, item.isFavorite]),
    [
      ['Zeta', true],
      ['Alpha', false]
    ]
  )
  assert.equal(
    (await request(`${projectPath}/user-favorite-views`, { ...owner, method: 'POST', body: { view: 999999 } })).status,
    404
  )
  const picked = await json(await request(`${projectPath}/views?fields=name`, owner), 200)
  assert.deepEqual(Object.keys(picked[0]), ['name'])
  assert.equal((await request(`${projectPath}/views/${first.id}`, owner)).status, 200)
  assert.equal(
    (await request(`${projectPath}/user-favorite-views/${first.id}`, { ...owner, method: 'DELETE' })).status,
    204
  )
  assert.equal(
    (await request(`${projectPath}/user-favorite-views/${first.id}`, { ...owner, method: 'DELETE' })).status,
    404
  )
  // Changing filters recomputes the query; an update without filters keeps it.
  const updated = await json(
    await request(`${projectPath}/views/${first.id}`, {
      ...owner,
      method: 'PATCH',
      body: { filters: { priority: ['urgent'] } }
    }),
    200
  )
  assert.deepEqual(updated.query, { priority: ['urgent'] })
  const renamed = await json(
    await request(`${projectPath}/views/${first.id}`, { ...owner, method: 'PATCH', body: { name: 'Zeta 2' } }),
    200
  )
  assert.deepEqual(renamed.query, { priority: ['urgent'] })
})

test('workspace view issues apply filters and the guest restriction', async () => {
  const db = new DatabaseSync(process.env.LANCITY_TEST_D1, { timeout: 5_000 })
  try {
    const owner = await signUp('wowner', '198.18.224.2')
    const guest = await signUp('wguest', '198.18.224.3')
    const slug = `wvi-${run}`
    const workspace = await json(
      await request('/api/v1/workspaces', { ...owner, method: 'POST', body: { name: 'WVI', slug } }),
      201
    )
    const project = await json(
      await request(`/api/v1/workspaces/${slug}/projects`, {
        ...owner,
        method: 'POST',
        body: { name: 'WVI', identifier: 'WVI' }
      }),
      201
    )
    const projectPath = `/api/v1/workspaces/${slug}/projects/${project.id}`
    await json(
      await request(`${projectPath}/issues`, {
        ...owner,
        method: 'POST',
        body: { name: 'Urgent bug', priority: 'urgent' }
      }),
      201
    )
    await json(
      await request(`${projectPath}/issues`, {
        ...owner,
        method: 'POST',
        body: { name: 'Low chore', priority: 'low' }
      }),
      201
    )
    db.prepare('INSERT INTO workspace_members (workspace_id, member_id, role) VALUES (?, ?, 5)').run(
      workspace.id,
      guest.id
    )
    db.prepare('INSERT INTO project_members (workspace_id, project_id, member_id, role) VALUES (?, ?, ?, 5)').run(
      workspace.id,
      project.id,
      guest.id
    )
    db.prepare('UPDATE projects SET guest_view_all_features = 0 WHERE id = ?').run(project.id)
    const path = `/api/v1/workspaces/${slug}/issues`
    const all = await json(await request(path, owner), 200)
    assert.equal(all.total_count, 2)
    const urgent = await json(await request(`${path}?priority=urgent`, owner), 200)
    assert.deepEqual(
      urgent.results.map(item => item.name),
      ['Urgent bug']
    )
    const rich = await json(
      await request(`${path}?filters=${encodeURIComponent(JSON.stringify({ priority__in: 'low' }))}`, owner),
      200
    )
    assert.deepEqual(
      rich.results.map(item => item.name),
      ['Low chore']
    )
    assert.equal((await json(await request(path, guest), 200)).total_count, 0)
    assert.equal((await request(`${path}?per_page=0`, owner)).status, 400)
  } finally {
    db.close()
  }
})

test('global, entity and issue search respect membership', async () => {
  const db = new DatabaseSync(process.env.LANCITY_TEST_D1, { timeout: 5_000 })
  try {
    const owner = await signUp('sowner', '198.18.224.4')
    const outsider = await signUp('soutsider', '198.18.224.5')
    const slug = `srch-${run}`
    const workspace = await json(await request('/api/v1/workspaces', { ...owner, method: 'POST', body: { name: 'Search', slug } }), 201)
    const project = await json(
      await request(`/api/v1/workspaces/${slug}/projects`, {
        ...owner,
        method: 'POST',
        body: { name: 'Searchable', identifier: 'SRCH' }
      }),
      201
    )
    const base = `/api/v1/workspaces/${slug}`
    const projectPath = `${base}/projects/${project.id}`
    const parent = await json(
      await request(`${projectPath}/issues`, { ...owner, method: 'POST', body: { name: 'Needle parent' } }),
      201
    )
    const other = await json(
      await request(`${projectPath}/issues`, { ...owner, method: 'POST', body: { name: 'Needle other' } }),
      201
    )
    await json(await request(`${projectPath}/views`, { ...owner, method: 'POST', body: { name: 'Needle view' } }), 201)

    const global = await json(await request(`${base}/global-search?search=needle`, owner), 200)
    assert.equal(global.results.issue.length, 2)
    assert.equal(global.results.issue_view.length, 1)
    assert.equal(global.results.project.length, 0)
    const narrow = await json(await request(`${base}/global-search?search=needle&entities=issue,bogus`, owner), 200)
    assert.deepEqual(Object.keys(narrow.results), ['issue'])
    assert.equal((await request(`${base}/global-search?search=needle`, outsider)).status, 404)

    const mentions = await json(
      await request(`${base}/entity-search?query_type=user_mention,project&query=Search`, owner),
      200
    )
    assert.equal(mentions.project.length, 1)
    assert.ok(Array.isArray(mentions.user_mention))
    assert.equal(
      (await request(`${base}/entity-search?query_type=issue&project_id=${project.id}`, outsider)).status,
      404
    )

    const excluded = await json(
      await request(`${projectPath}/search-issues?search=needle&parent=true&issue_id=${parent.id}`, owner),
      200
    )
    assert.deepEqual(
      excluded.map(item => item.id),
      [other.id]
    )
    assert.equal((await request(`${projectPath}/search-issues?issue_id=abc`, owner)).status, 400)

    const term = 'ĐĂNG-'.repeat(40)
    const match = await json(await request(`${projectPath}/issues`, {
      ...owner, method: 'POST', body: { name: `A ${term} B` }
    }), 201)
    db.prepare(`INSERT INTO issues (name, sequence_id, project_id, workspace_id) VALUES (?, 999, ?, ?)`).run(
      `${term.slice(0, 100)} NGẮT ${term.slice(100)}`, project.id, workspace.id
    )
    db.prepare(`WITH RECURSIVE nums(n) AS (VALUES (1) UNION ALL SELECT n + 1 FROM nums WHERE n < 150)
      INSERT INTO issues (name, sequence_id, project_id, workspace_id)
      SELECT 'Filler ' || n, n + 1000, ?, ? FROM nums`).run(project.id, workspace.id)

    const keyword = encodeURIComponent(term.toLowerCase())
    const page = await json(await request(`${projectPath}/issues?name=${keyword}&per_page=1`, owner), 200)
    assert.equal(page.total_count, 1)
    assert.deepEqual(page.results.map(issue => issue.id), [match.id])
    const ids = db.prepare('SELECT id FROM issues WHERE project_id = ? AND sequence_id > 1000 ORDER BY sequence_id').all(project.id)
    const listed = await json(await request(`${projectPath}/issues/list?issues=${ids.map(row => row.id).join(',')}`, owner), 200)
    assert.equal(listed.length, 150)
  } finally {
    db.close()
  }
})
