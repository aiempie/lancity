import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'vitest'
import { createInstanceAdmin } from '../scripts/plane/create-instance-admin.ts'

const base = new URL(process.env.LANCITY_TEST_URL ?? 'http://localhost:4198')
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Use an isolated local Worker')
assert.ok(process.env.LANCITY_TEST_D1, 'Set LANCITY_TEST_D1 to the isolated Worker database file')

const runId = randomUUID().replaceAll('-', '').slice(0, 12)
const api = '/api/v1'

function jsonRequest(path, { cookie, method = 'GET', body, origin, clientIp } = {}) {
  const headers = new Headers()
  if (cookie) headers.set('cookie', cookie)
  if (origin) headers.set('origin', origin)
  if (clientIp) headers.set('cf-connecting-ip', clientIp)
  if (body !== undefined) headers.set('content-type', 'application/json')
  return fetch(new URL(path, base), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual'
  })
}

async function jsonResponse(response, status) {
  assert.equal(response.status, status, `${response.url} returned ${response.status}`)
  assert.match(response.headers.get('content-type') ?? '', /application\/json/)
  return response.json()
}

async function signUp(suffix) {
  const username = `test${runId}${suffix}`
  const [network, address] = randomBytes(2)
  const response = await jsonRequest('/api/auth/sign-up/email', {
    method: 'POST',
    origin: base.origin,
    clientIp: `198.18.${network}.${address}`,
    body: { name: `Test ${suffix}`, username, email: `${username}@example.com`, password: 'isolated-test-password' }
  })
  const { user } = await jsonResponse(response, 200)
  const cookie = response.headers
    .getSetCookie()
    .map(header => header.split(';', 1)[0])
    .join('; ')
  assert.match(cookie, /lancity\.session_token=/)
  return { id: Number(user.id), cookie, username }
}

function htmlAttribute(value) {
  return value.replaceAll('&quot;', '"').replaceAll('&#x27;', "'").replaceAll('&amp;', '&')
}

async function submitAction(path, cookie, values) {
  const page = await jsonRequest(path, { cookie })
  assert.equal(page.status, 200)
  const html = await page.text()
  const form = html.match(/<form\b[^>]*>(?:(?!<\/form>)[\s\S])*?name="\$ACTION_[\s\S]*?<\/form>/)?.[0]
  assert.ok(form, `Expected a Server Action form at ${path}`)
  const body = new FormData()
  for (const [, name, value = ''] of form.matchAll(/<input[^>]+name="(\$ACTION_[^"]+)"(?: value="([^"]*)")?/g)) {
    body.append(name, htmlAttribute(value))
  }
  for (const [key, value] of Object.entries(values)) body.append(key, String(value))
  return fetch(new URL(path, base), {
    method: 'POST',
    headers: { cookie, origin: base.origin },
    body,
    redirect: 'manual'
  })
}

test('Worker health and crawler metadata are public', async () => {
  for (const path of [api, `${api}/health`]) {
    assert.deepEqual(await jsonResponse(await jsonRequest(path), 200), { status: 'OK' })
  }
  const robots = await jsonRequest('/robots.txt')
  assert.equal(robots.status, 200)
  assert.match((await robots.text()).trim(), /^user-agent: \*\s+disallow: \/$/i)
  const timezones = await jsonResponse(await jsonRequest(`${api}/timezones`), 200)
  assert.equal(timezones.timezones.length, 120)
  assert.ok(timezones.timezones.some(zone => zone.value === 'Asia/Kathmandu'))
})

test('Browser pages redirect and mobile routes report JSON errors', async () => {
  const page = await jsonRequest('/workspaces')
  assert.equal(page.status, 307)
  assert.equal(new URL(page.headers.get('location'), base).pathname, '/login')
  const response = await jsonRequest(`${api}/workspaces`)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal((await jsonResponse(response, 401)).error.code, 'UNAUTHORIZED')
  assert.equal((await jsonResponse(await jsonRequest(`${api}/unknown`), 404)).error.code, 'NOT_FOUND')
  const unsupported = await jsonRequest(`${api}/health`, { method: 'PUT' })
  assert.equal((await jsonResponse(unsupported, 405)).error.code, 'METHOD_NOT_ALLOWED')
  assert.match(unsupported.headers.get('allow') ?? '', /GET/)
  const options = await jsonRequest(`${api}/health`, { method: 'OPTIONS' })
  assert.equal(options.status, 204)
  // CORS is mounted globally and answers every OPTIONS request first (no Allow header, CORS headers instead).
  assert.match(options.headers.get('access-control-allow-methods') ?? '', /GET/)
  assert.deepEqual(await jsonResponse(await jsonRequest(`${api}/users/session`), 200), { is_authenticated: false })
})

test('Authenticated workspace operations share web and mobile rules and roll back failed writes', async () => {
  const db = new DatabaseSync(process.env.LANCITY_TEST_D1, { timeout: 5_000 })
  try {
    const owner = await signUp('owner')
    const other = await signUp('other')
    const currentUser = await jsonResponse(await jsonRequest(`${api}/users/me`, owner), 200)
    assert.equal(currentUser.id, owner.id)
    assert.equal(currentUser.username, owner.username)
    assert.ok(!('token' in currentUser))
    assert.deepEqual(await jsonResponse(await jsonRequest(`${api}/workspaces`, owner), 200), [])

    const workspaceInput = { name: 'Mobile workspace', slug: `mobile-${runId}` }
    const slugCheck = `${api}/workspace-slug-check`
    assert.equal((await jsonRequest(slugCheck, owner)).status, 400)
    assert.deepEqual(await jsonResponse(await jsonRequest(`${slugCheck}?slug=admin`, owner), 200), { status: false })
    assert.deepEqual(await jsonResponse(await jsonRequest(`${slugCheck}?slug=${workspaceInput.slug}`, owner), 200), {
      status: true
    })
    const created = await jsonResponse(
      await jsonRequest(`${api}/workspaces`, {
        ...owner,
        method: 'POST',
        body: workspaceInput
      }),
      201
    )
    assert.equal(created.name, workspaceInput.name)
    assert.equal(created.ownerId, owner.id)
    assert.deepEqual(await jsonResponse(await jsonRequest(`${slugCheck}?slug=${workspaceInput.slug}`, owner), 200), {
      status: false
    })

    const scoped = `${api}/workspaces/${workspaceInput.slug}`
    assert.equal((await jsonResponse(await jsonRequest(scoped, owner), 200)).membership.role, 20)
    assert.deepEqual(await jsonResponse(await jsonRequest(`${api}/workspaces`, other), 200), [])
    assert.equal((await jsonRequest(scoped, other)).status, 404)

    db.prepare('INSERT INTO workspace_members (workspace_id, member_id, role) VALUES (?, ?, 15)').run(
      created.id,
      other.id
    )
    const denied = await jsonRequest(scoped, { ...other, method: 'PATCH', body: { name: 'Denied' } })
    assert.equal((await jsonResponse(denied, 403)).error.code, 'FORBIDDEN')
    const crossOrigin = await jsonRequest(scoped, {
      ...owner,
      method: 'PATCH',
      origin: 'https://external.example',
      body: { name: 'Denied' }
    })
    assert.equal(crossOrigin.status, 403)

    const invalid = await jsonRequest(`${api}/workspaces`, { ...owner, method: 'POST', body: { name: '' } })
    assert.equal((await jsonResponse(invalid, 400)).error.code, 'VALIDATION_ERROR')
    const duplicate = await jsonRequest(`${api}/workspaces`, { ...owner, method: 'POST', body: workspaceInput })
    assert.equal((await jsonResponse(duplicate, 409)).error.code, 'WORKSPACE_SLUG_EXISTS')

    const webInput = { name: 'Web workspace', slug: `web-${runId}` }
    const actionResponse = await submitAction('/workspaces', owner.cookie, webInput)
    assert.equal(actionResponse.status, 200)
    assert.match(await actionResponse.text(), /Workspace created\./)
    const webCreated = await jsonResponse(await jsonRequest(`${api}/workspaces/${webInput.slug}`, owner), 200)
    assert.equal(webCreated.workspace.name, webInput.name)
    assert.equal(webCreated.workspace.ownerId, created.ownerId)
    assert.equal(webCreated.membership.role, 20)

    const failingSlug = `rollback-${runId}`
    db.exec(`CREATE TRIGGER worker_test_workspace_failure BEFORE INSERT ON workspace_members
      WHEN NEW.workspace_id = (SELECT id FROM workspaces WHERE slug = '${failingSlug}')
      BEGIN SELECT RAISE(ABORT, 'forced workspace member failure'); END`)
    try {
      const failed = await jsonRequest(`${api}/workspaces`, {
        ...owner,
        method: 'POST',
        body: { name: 'Failed creation', slug: failingSlug }
      })
      assert.equal((await jsonResponse(failed, 400)).error.code, 'INTEGRITY_ERROR')
      assert.equal(db.prepare('SELECT id FROM workspaces WHERE slug = ?').get(failingSlug), undefined)
    } finally {
      db.exec('DROP TRIGGER worker_test_workspace_failure')
    }
  } finally {
    db.close()
  }
})

test('Concurrent workspace member changes keep one project admin', async () => {
  const owner = await signUp('membership')
  const one = await signUp('memberone')
  const two = await signUp('membertwo')
  const slug = `member-${runId}`
  const workspace = await jsonResponse(
    await jsonRequest(`${api}/workspaces`, {
      ...owner,
      method: 'POST',
      body: { name: 'Membership', slug }
    }),
    201
  )
  const path = `${api}/workspaces/${slug}`
  const project = await jsonResponse(
    await jsonRequest(`${path}/projects`, {
      ...owner,
      method: 'POST',
      body: { name: 'Membership', identifier: 'MEM' }
    }),
    201
  )
  const db = new DatabaseSync(process.env.LANCITY_TEST_D1, { timeout: 5_000 })
  try {
    db.prepare('UPDATE project_members SET role = 15 WHERE project_id = ? AND member_id = ?').run(project.id, owner.id)
    const addMember = db.prepare(
      'INSERT INTO workspace_members (workspace_id, member_id, role) VALUES (?, ?, 15) RETURNING id'
    )
    const addProjectAdmin = db.prepare(
      'INSERT INTO project_members (project_id, workspace_id, member_id, role) VALUES (?, ?, ?, 20)'
    )
    const first = addMember.get(workspace.id, one.id)
    const second = addMember.get(workspace.id, two.id)
    addProjectAdmin.run(project.id, workspace.id, one.id)
    addProjectAdmin.run(project.id, workspace.id, two.id)
    const outcomes = await Promise.all([
      jsonRequest(`${path}/members/${first.id}`, { ...owner, method: 'PATCH', body: { role: 5 } }),
      jsonRequest(`${path}/members/${second.id}`, { ...owner, method: 'DELETE' })
    ])
    // Plane only blocks removing an admin who is the sole member of a project. The owner remains a project member here,
    // so both concurrent changes succeed and no project admin is left.
    assert.equal(outcomes.filter(response => response.ok).length, 2)
    assert.equal(
      db
        .prepare('SELECT count(*) AS count FROM project_members WHERE project_id = ? AND role = 20 AND is_active = 1')
        .get(project.id).count,
      0
    )
  } finally {
    db.close()
  }
})

test('Issue numbering stays unique under concurrent Worker requests and rolls back on failure', async () => {
  const db = new DatabaseSync(process.env.LANCITY_TEST_D1, { timeout: 5_000 })
  try {
    const owner = await signUp('issues')
    const slug = `issues-${runId}`
    const otherSlug = `issues-other-${runId}`
    for (const workspaceSlug of [slug, otherSlug]) {
      await jsonResponse(
        await jsonRequest(`${api}/workspaces`, {
          ...owner,
          method: 'POST',
          body: { name: workspaceSlug, slug: workspaceSlug }
        }),
        201
      )
    }
    async function newProject(workspaceSlug, identifier) {
      return jsonResponse(
        await jsonRequest(`${api}/workspaces/${workspaceSlug}/projects`, {
          ...owner,
          method: 'POST',
          body: { name: identifier, identifier }
        }),
        201
      )
    }
    const project = await newProject(slug, 'SEQ')
    const otherProject = await newProject(otherSlug, 'OTHER')
    const projectPath = `${api}/workspaces/${slug}/projects/${project.id}`
    const issuePath = `${projectPath}/issues`
    const create = body => jsonRequest(issuePath, { ...owner, method: 'POST', body })

    const requests = await Promise.all(
      Array.from({ length: 8 }, (_, index) => create({ name: `Concurrent issue ${index}` }))
    )
    const created = await Promise.all(requests.map(response => jsonResponse(response, 201)))
    assert.deepEqual(
      created.map(issue => issue.sequenceId).sort((a, b) => a - b),
      [1, 2, 3, 4, 5, 6, 7, 8]
    )
    assert.ok(created.every(issue => issue.stateId === created[0].stateId && issue.stateId > 0))

    const foreignState = db.prepare('SELECT id FROM states WHERE project_id = ? AND "default" = 1').get(otherProject.id)
    assert.equal(
      (await jsonResponse(await create({ name: 'Foreign state', stateId: foreignState.id }), 400)).error.code,
      'INVALID_STATE'
    )
    assert.equal((await jsonRequest(`${api}/workspaces/${otherSlug}/projects/${project.id}/issues`, owner)).status, 404)
    assert.equal(
      (await jsonRequest(`${api}/workspaces/${otherSlug}/projects/${otherProject.id}/issues/${created[0].id}`, owner))
        .status,
      404
    )

    const webPath = `/issues?${new URLSearchParams({ slug, projectId: String(project.id) })}`
    const webIssue = await submitAction(webPath, owner.cookie, { name: 'Web issue', slug, projectId: project.id })
    assert.equal(webIssue.status, 200)
    assert.match(await webIssue.text(), /Issue created\./)
    const items = await jsonResponse(await jsonRequest(issuePath, owner), 200)
    const webCreated = items.find(issue => issue.name === 'Web issue')
    assert.equal(webCreated.sequenceId, 9)
    assert.equal(webCreated.stateId, created[0].stateId)

    db.exec(`CREATE TRIGGER worker_test_issue_failure BEFORE INSERT ON issue_sequences
      WHEN NEW.project_id = ${project.id}
      BEGIN SELECT RAISE(ABORT, 'forced issue reservation failure'); END`)
    try {
      assert.equal((await jsonResponse(await create({ name: 'Failed issue' }), 400)).error.code, 'INTEGRITY_ERROR')
    } finally {
      db.exec('DROP TRIGGER worker_test_issue_failure')
    }
    assert.equal(
      db.prepare('SELECT last_sequence FROM project_issue_counters WHERE project_id = ?').get(project.id).last_sequence,
      9
    )
    assert.equal(db.prepare('SELECT count(*) AS count FROM issues WHERE project_id = ?').get(project.id).count, 9)
    const afterRollback = await jsonResponse(await create({ name: 'After rollback' }), 201)
    assert.equal(afterRollback.sequenceId, 10)

    const issueDetail = `${issuePath}/${afterRollback.id}`
    const update = body => jsonRequest(issueDetail, { ...owner, method: 'PATCH', body })
    assert.equal((await jsonResponse(await update({ name: 'Renamed issue', priority: 'high' }), 200)).priority, 'high')
    const activities = await jsonResponse(await jsonRequest(`${issueDetail}/activities`, owner), 200)
    const versions = await jsonResponse(await jsonRequest(`${issueDetail}/versions`, owner), 200)
    assert.equal(activities.length, 3)
    assert.equal(versions.length, 2)
    assert.equal(versions[0].name, 'Renamed issue')
    db.exec(`CREATE TRIGGER worker_test_version_failure BEFORE INSERT ON issue_versions
      WHEN NEW.issue_id = ${afterRollback.id}
      BEGIN SELECT RAISE(ABORT, 'forced issue version failure'); END`)
    try {
      assert.equal((await jsonResponse(await update({ name: 'Failed update' }), 400)).error.code, 'INTEGRITY_ERROR')
    } finally {
      db.exec('DROP TRIGGER worker_test_version_failure')
    }
    assert.equal((await jsonResponse(await jsonRequest(issueDetail, owner), 200)).name, 'Renamed issue')
    assert.equal((await jsonResponse(await jsonRequest(`${issueDetail}/activities`, owner), 200)).length, 3)
    assert.equal((await jsonRequest(issueDetail, { ...owner, method: 'DELETE' })).status, 204)
    assert.equal((await jsonRequest(issueDetail, owner)).status, 404)
    const deletion = db
      .prepare('SELECT deleted FROM issue_sequences WHERE project_id = ? AND sequence = ?')
      .get(project.id, afterRollback.sequenceId)
    assert.equal(deletion.deleted, 1)
    assert.equal((await jsonResponse(await create({ name: 'After deletion' }), 201)).sequenceId, 11)

    const sourcePath = `${issuePath}/${created[0].id}`
    const link = await jsonResponse(
      await jsonRequest(`${sourcePath}/links`, {
        ...owner,
        method: 'POST',
        body: { url: 'example.com/notes', title: 'Notes' }
      }),
      201
    )
    assert.equal(link.url, 'http://example.com/notes')
    assert.equal((await jsonResponse(await jsonRequest(`${sourcePath}/links/${link.id}`, owner), 200)).title, 'Notes')
    assert.equal((await jsonRequest(`${sourcePath}/links/${link.id}`, { ...owner, method: 'DELETE' })).status, 204)
    // Plane subscribes the creator of an issue, so unsubscribe first to exercise the subscribe call.
    assert.equal((await jsonResponse(await jsonRequest(`${sourcePath}/subscription`, owner), 200)).subscribed, true)
    assert.equal((await jsonRequest(`${sourcePath}/subscribe`, { ...owner, method: 'DELETE' })).status, 204)
    assert.equal((await jsonResponse(await jsonRequest(`${sourcePath}/subscription`, owner), 200)).subscribed, false)
    await jsonResponse(await jsonRequest(`${sourcePath}/subscribe`, { ...owner, method: 'POST' }), 201)
    assert.equal((await jsonResponse(await jsonRequest(`${sourcePath}/subscription`, owner), 200)).subscribed, true)
    assert.equal((await jsonRequest(`${sourcePath}/subscribe`, { ...owner, method: 'DELETE' })).status, 204)

    const sibling = await newProject(slug, 'SIB')
    const siblingPath = `${api}/workspaces/${slug}/projects/${sibling.id}`
    const foreignPath = `${api}/workspaces/${otherSlug}/projects/${otherProject.id}`
    const target = await jsonResponse(
      await jsonRequest(`${siblingPath}/issues`, {
        ...owner,
        method: 'POST',
        body: { name: 'Linked target' }
      }),
      201
    )
    const foreign = await jsonResponse(
      await jsonRequest(`${foreignPath}/issues`, {
        ...owner,
        method: 'POST',
        body: { name: 'Other workspace' }
      }),
      201
    )
    const relate = ids =>
      jsonRequest(`${sourcePath}/relations`, {
        ...owner,
        method: 'POST',
        body: { relation_type: 'blocking', issues: ids }
      })
    assert.equal((await relate([target.id, foreign.id])).status, 404)
    assert.deepEqual((await jsonResponse(await jsonRequest(`${sourcePath}/relations`, owner), 200)).blocking, [])
    assert.equal((await jsonResponse(await relate([target.id]), 201)).length, 1)
    const reversePath = `${siblingPath}/issues/${target.id}/relations`
    const reverseRelation = await jsonResponse(await jsonRequest(reversePath, owner), 200)
    assert.deepEqual(
      reverseRelation.blocked_by.map(row => row.id),
      [created[0].id]
    )
    const restricted = await signUp('relations')
    const relationWorkspace = db.prepare('SELECT workspace_id FROM projects WHERE id = ?').get(project.id).workspace_id
    db.prepare('INSERT INTO workspace_members (workspace_id, member_id, role) VALUES (?, ?, 15)').run(
      relationWorkspace,
      restricted.id
    )
    db.prepare('INSERT INTO project_members (project_id, workspace_id, member_id, role) VALUES (?, ?, ?, 15)').run(
      project.id,
      relationWorkspace,
      restricted.id
    )
    assert.deepEqual((await jsonResponse(await jsonRequest(`${sourcePath}/relations`, restricted), 200)).blocking, [])
    assert.equal(
      (await jsonRequest(reversePath, { ...owner, method: 'DELETE', body: { related_issue: created[0].id } })).status,
      204
    )
    assert.deepEqual((await jsonResponse(await jsonRequest(`${sourcePath}/relations`, owner), 200)).blocking, [])
  } finally {
    db.close()
  }
})

test('Page versions, R2 assets and reporting preserve project and user scope', async () => {
  const owner = await signUp('content')
  const outsider = await signUp('reader')
  const slug = `content-${runId}`
  const workspace = await jsonResponse(
    await jsonRequest(`${api}/workspaces`, {
      ...owner,
      method: 'POST',
      body: { name: 'Content', slug }
    }),
    201
  )
  const workspacePath = `${api}/workspaces/${slug}`
  const project = await jsonResponse(
    await jsonRequest(`${workspacePath}/projects`, {
      ...owner,
      method: 'POST',
      body: { name: 'Content', identifier: 'CONTENT' }
    }),
    201
  )
  const projectPath = `${workspacePath}/projects/${project.id}`
  const webPagePath = `/pages?${new URLSearchParams({ slug, projectId: String(project.id) })}`
  const webPage = await submitAction(webPagePath, owner.cookie, {
    slug,
    projectId: project.id,
    name: 'Web notes',
    descriptionText: 'Server Action text'
  })
  assert.equal(webPage.status, 200)
  assert.match(await webPage.text(), /Page created\./)
  const pages = await jsonResponse(await jsonRequest(`${projectPath}/pages`, owner), 200)
  assert.ok(pages.some(page => page.name === 'Web notes'))
  const created = await jsonResponse(
    await jsonRequest(`${projectPath}/pages`, {
      ...owner,
      method: 'POST',
      body: { name: 'Notes', descriptionText: '<strong>Text</strong>', access: 1 }
    }),
    201
  )
  const pagePath = `${projectPath}/pages/${created.id}`
  assert.match(created.descriptionHtml, /&lt;strong&gt;Text&lt;\/strong&gt;/)
  assert.equal((await jsonRequest(pagePath, outsider)).status, 404)
  assert.equal(
    (
      await jsonResponse(
        await jsonRequest(`${pagePath}/description`, {
          ...owner,
          method: 'PATCH',
          body: { descriptionText: 'Updated text' }
        }),
        200
      )
    ).descriptionText,
    'Updated text'
  )
  // Page versions are written by the page.version job (Queue, maxBatchTimeout 5 s), so poll up to 15 s.
  let versions = []
  for (let attempt = 0; attempt < 30; attempt += 1) {
    versions = await jsonResponse(await jsonRequest(`${pagePath}/versions`, owner), 200)
    if (versions.some(version => version.descriptionText === 'Updated text')) break
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  assert.ok(versions.some(version => version.descriptionText === 'Updated text'))
  assert.equal((await jsonRequest(`${pagePath}/lock`, { ...owner, method: 'POST' })).status, 204)
  assert.equal((await jsonRequest(pagePath, { ...owner, method: 'PATCH', body: { name: 'Blocked edit' } })).status, 409)
  assert.equal((await jsonRequest(`${pagePath}/lock`, { ...owner, method: 'DELETE' })).status, 204)
  const archived = await jsonResponse(await jsonRequest(`${pagePath}/archive`, { ...owner, method: 'POST' }), 200)
  assert.match(archived.archived_at, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal((await jsonRequest(`${pagePath}/archive`, { ...owner, method: 'DELETE' })).status, 204)

  const bytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==',
    'base64'
  )
  const multipart = new FormData()
  multipart.append('file', new File([bytes], 'pixel.png', { type: 'image/png' }))
  const upload = await fetch(new URL(`${projectPath}/assets`, base), {
    method: 'POST',
    headers: { cookie: owner.cookie },
    body: multipart
  })
  const asset = await jsonResponse(upload, 201)
  const assetPath = `${projectPath}/assets/${asset.id}`
  assert.equal((await jsonRequest(assetPath, outsider)).status, 404)
  const download = await jsonRequest(assetPath, owner)
  assert.equal(download.status, 200)
  assert.equal(download.headers.get('content-disposition'), 'attachment')
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes)
  const assetDb = new DatabaseSync(process.env.LANCITY_TEST_D1, { timeout: 5_000 })
  try {
    assetDb.exec(`CREATE TRIGGER worker_test_asset_finalization BEFORE UPDATE OF deleted_at ON file_assets
      WHEN NEW.id = ${asset.id} AND NEW.deleted_at IS NOT NULL
      BEGIN SELECT RAISE(ABORT, 'forced asset metadata failure'); END`)
    try {
      const pendingDelete = await jsonRequest(assetPath, { ...owner, method: 'DELETE' })
      assert.equal((await jsonResponse(pendingDelete, 503)).error.code, 'ASSET_CLEANUP_REQUIRED')
      assert.equal((await jsonRequest(assetPath, owner)).status, 404)
      assert.equal(assetDb.prepare('SELECT is_deleted FROM file_assets WHERE id = ?').get(asset.id).is_deleted, 1)
    } finally {
      assetDb.exec('DROP TRIGGER worker_test_asset_finalization')
    }
    assert.equal((await jsonRequest(assetPath, { ...owner, method: 'DELETE' })).status, 204)
  } finally {
    assetDb.close()
  }
  assert.equal((await jsonRequest(assetPath, owner)).status, 404)

  const issue = await jsonResponse(
    await jsonRequest(`${projectPath}/issues`, {
      ...owner,
      method: 'POST',
      body: { name: '=SUM(50%, 2)' }
    }),
    201
  )
  const issuePath = `${projectPath}/issues/${issue.id}`
  const comment = await jsonResponse(
    await jsonRequest(`${issuePath}/comments`, {
      ...owner,
      method: 'POST',
      body: { text: 'Initial comment' }
    }),
    201
  )
  const commentPath = `${issuePath}/comments/${comment.id}`
  const updatedComment = await jsonResponse(
    await jsonRequest(commentPath, {
      ...owner,
      method: 'PATCH',
      body: { text: '<span>Edited</span>' }
    }),
    200
  )
  assert.match(updatedComment.commentHtml, /&lt;span&gt;Edited/)
  assert.equal((await jsonRequest(commentPath, { ...owner, method: 'DELETE' })).status, 204)
  assert.deepEqual(await jsonResponse(await jsonRequest(`${issuePath}/comments`, owner), 200), [])
  const label = await jsonResponse(
    await jsonRequest(`${projectPath}/labels`, {
      ...owner,
      method: 'POST',
      body: { name: 'Pinned' }
    }),
    201
  )
  for (const [relation, id] of [
    ['labels', label.id],
    ['assignees', owner.id]
  ]) {
    await jsonResponse(await jsonRequest(`${issuePath}/${relation}`, { ...owner, method: 'POST', body: { id } }), 200)
    await jsonResponse(await jsonRequest(`${issuePath}/${relation}`, { ...owner, method: 'DELETE', body: { id } }), 200)
  }
  const matches = await jsonResponse(
    await jsonRequest(`${projectPath}/issue-search?search=${encodeURIComponent('50%')}`, owner),
    200
  )
  assert.deepEqual(
    matches.map(row => row.id),
    [issue.id]
  )
  assert.equal((await jsonRequest(`${projectPath}/analytics`, outsider)).status, 404)
  assert.equal((await jsonResponse(await jsonRequest(`${projectPath}/analytics`, owner), 200)).total, 1)
  const exported = await jsonRequest(`${projectPath}/export`, owner)
  assert.equal(exported.status, 200)
  assert.match(await exported.text(), /"'=SUM\(50%, 2\)"/)

  const db = new DatabaseSync(process.env.LANCITY_TEST_D1, { timeout: 5_000 })
  try {
    db.prepare('INSERT INTO workspace_members (workspace_id, member_id, role) VALUES (?, ?, 15)').run(
      workspace.id,
      outsider.id
    )
    const sticky = await jsonResponse(
      await jsonRequest(`${workspacePath}/stickies`, {
        ...owner,
        method: 'POST',
        body: { name: 'Personal note' }
      }),
      201
    )
    assert.equal((await jsonRequest(`${workspacePath}/stickies/${sticky.id}`, outsider)).status, 404)
    const view = await jsonResponse(
      await jsonRequest(`${workspacePath}/views`, {
        ...owner,
        method: 'POST',
        body: { name: 'Personal view', query: {}, access: 0 }
      }),
      201
    )
    assert.equal((await jsonRequest(`${workspacePath}/views/${view.id}`, outsider)).status, 404)
    const notification = db
      .prepare(
        `INSERT INTO notifications (entity_name, title, sender, receiver_id, workspace_id)
      VALUES ('issue', 'Assigned', 'test', ?, ?) RETURNING id`
      )
      .get(owner.id, workspace.id)
    const notificationsPath = `${workspacePath}/users/notifications`
    assert.deepEqual(await jsonResponse(await jsonRequest(notificationsPath, outsider), 200), [])
    const own = await jsonResponse(await jsonRequest(notificationsPath, owner), 200)
    assert.deepEqual(
      own.map(row => row.id),
      [notification.id]
    )
    assert.equal(
      (await jsonRequest(`${notificationsPath}/${notification.id}/read`, { ...outsider, method: 'POST' })).status,
      404
    )
    assert.equal(
      (await jsonRequest(`${notificationsPath}/${notification.id}/read`, { ...owner, method: 'POST' })).status,
      200
    )

    const livePath = `${workspacePath}/pages/${created.id}/live-access`
    assert.deepEqual(await jsonResponse(await jsonRequest(`${livePath}?action=view`, owner), 200), {
      project_id: String(project.id),
      read_only: false
    })
    assert.equal((await jsonRequest(`${livePath}?action=invalid`, owner)).status, 400)
    assert.equal((await jsonRequest(`${livePath}?action=view`, outsider)).status, 404)
    const joined = await jsonResponse(await jsonRequest(`${projectPath}/join`, { ...outsider, method: 'POST' }), 201)
    assert.equal(joined.role, 15)
    db.prepare('UPDATE project_members SET role = 5 WHERE project_id = ? AND member_id = ?').run(
      project.id,
      outsider.id
    )
    db.prepare('UPDATE projects SET guest_view_all_features = 1 WHERE id = ?').run(project.id)
    assert.equal((await jsonRequest(`${livePath}?action=view`, outsider)).status, 404)
    await jsonResponse(await jsonRequest(pagePath, { ...owner, method: 'PATCH', body: { access: 0 } }), 200)
    assert.deepEqual(await jsonResponse(await jsonRequest(`${livePath}?action=view`, outsider), 200), {
      project_id: String(project.id),
      read_only: true
    })
    assert.equal((await jsonRequest(`${livePath}?action=edit`, outsider)).status, 404)

    const publicationPath = `${projectPath}/publication`
    assert.equal((await jsonRequest(publicationPath, { ...outsider, method: 'POST' })).status, 403)
    const { anchor } = await jsonResponse(await jsonRequest(publicationPath, { ...owner, method: 'POST' }), 200)
    const publicPath = `${api}/public/${anchor}`
    assert.equal((await jsonResponse(await jsonRequest(publicPath), 200)).project.id, project.id)
    const publiclyVisible = await jsonResponse(await jsonRequest(`${publicPath}/issues`), 200)
    assert.deepEqual(
      publiclyVisible.map(row => row.id),
      [issue.id]
    )
    assert.ok(!('createdById' in publiclyVisible[0]))
    const boardPath = `${api}/public/anchor/${anchor}`
    const privateProject = await jsonResponse(
      await jsonRequest(`${workspacePath}/projects`, {
        ...owner,
        method: 'POST',
        body: { name: 'Private catalog', identifier: 'PRIV', network: 0 }
      }),
      201
    )
    const triageId = db.prepare('SELECT id FROM states WHERE project_id = ? AND is_triage = 1').get(project.id).id
    const extraIssue =
      db.prepare(`INSERT INTO issues (name, sequence_id, project_id, workspace_id, state_id, is_draft, archived_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`)
    const hidden = [
      extraIssue.get('Triage', 2, project.id, workspace.id, triageId, 0, null),
      extraIssue.get('Draft', 3, project.id, workspace.id, null, 1, null),
      extraIssue.get('Archive', 4, project.id, workspace.id, null, 0, '2025-01-01'),
      extraIssue.get('Private project', 1, privateProject.id, workspace.id, null, 0, null)
    ]
    assert.deepEqual(
      (await jsonResponse(await jsonRequest(`${boardPath}/issues`), 200)).map(row => row.id),
      [issue.id]
    )
    assert.equal((await jsonResponse(await jsonRequest(`${boardPath}/issues/${issue.id}`), 200)).id, issue.id)
    for (const row of hidden) assert.equal((await jsonRequest(`${boardPath}/issues/${row.id}`)).status, 404)

    const addCycle = db.prepare(
      'INSERT INTO cycles (name, project_id, workspace_id, owned_by_id) VALUES (?, ?, ?, ?) RETURNING id'
    )
    const addModule = db.prepare('INSERT INTO modules (name, project_id, workspace_id) VALUES (?, ?, ?) RETURNING id')
    const cycle = addCycle.get('Public cycle', project.id, workspace.id, owner.id)
    const publicModule = addModule.get('Public module', project.id, workspace.id)
    addCycle.run('Private cycle', privateProject.id, workspace.id, owner.id)
    addModule.run('Private module', privateProject.id, workspace.id)
    db.prepare('INSERT INTO labels (name, project_id, workspace_id) VALUES (?, ?, ?)').run(
      'Private label',
      privateProject.id,
      workspace.id
    )
    assert.deepEqual(await jsonResponse(await jsonRequest(`${boardPath}/cycles`), 200), [
      { id: cycle.id, name: 'Public cycle' }
    ])
    assert.deepEqual(await jsonResponse(await jsonRequest(`${boardPath}/modules`), 200), [
      { id: publicModule.id, name: 'Public module' }
    ])
    assert.deepEqual(
      (await jsonResponse(await jsonRequest(`${boardPath}/labels`), 200)).map(row => row.id),
      [label.id]
    )
    const boardStates = await jsonResponse(await jsonRequest(`${boardPath}/states`), 200)
    assert.equal(boardStates.length, 5)
    assert.ok(!boardStates.some(state => state.id === triageId))
    const meta = await jsonResponse(await jsonRequest(`${boardPath}/meta`), 200)
    assert.deepEqual(Object.keys(meta).sort(), [
      'cover_image',
      'description',
      'emoji',
      'icon_prop',
      'id',
      'identifier',
      'name'
    ])
    assert.equal(meta.id, project.id)

    const visitor = await signUp('publiccomment')
    const boardComments = `${boardPath}/issues/${issue.id}/comments`
    const draft = { text: '<strong>Public comment</strong>' }
    const postComment = (path = boardComments, body = draft) => jsonRequest(path, { ...visitor, method: 'POST', body })
    assert.equal((await jsonRequest(boardComments, { method: 'POST', body: draft })).status, 401)
    assert.equal((await jsonResponse(await postComment(), 400)).error.code, 'COMMENTS_DISABLED')
    assert.equal(
      (
        await jsonRequest(publicationPath, {
          ...visitor,
          method: 'PATCH',
          body: { is_comments_enabled: true }
        })
      ).status,
      404
    )
    async function enableComments(enabled) {
      return jsonResponse(
        await jsonRequest(publicationPath, {
          ...owner,
          method: 'PATCH',
          body: { is_comments_enabled: enabled }
        }),
        200
      )
    }
    assert.equal((await enableComments(true)).is_comments_enabled, true)
    assert.equal((await postComment(`${boardPath}/issues/${hidden[0].id}/comments`)).status, 404)
    assert.equal((await postComment(boardComments, { ...draft, actor: owner.id })).status, 400)
    const internal = db
      .prepare(
        `INSERT INTO issue_comments (issue_id, project_id, workspace_id, actor_id, comment_stripped)
      VALUES (?, ?, ?, ?, 'Internal note') RETURNING id`
      )
      .get(issue.id, project.id, workspace.id, owner.id)
    assert.equal((await jsonRequest(`${boardComments}/${internal.id}`)).status, 404)
    db.exec(`CREATE TRIGGER worker_test_public_comment_failure BEFORE INSERT ON issue_activities
      WHEN NEW.field = 'comment' AND NEW.actor_id = ${visitor.id}
      BEGIN SELECT RAISE(ABORT, 'forced comment audit failure'); END`)
    try {
      assert.equal((await postComment()).status, 400)
      assert.deepEqual(await jsonResponse(await jsonRequest(boardComments), 200), [])
      assert.equal(db.prepare('SELECT id FROM project_public_members WHERE member_id = ?').get(visitor.id), undefined)
    } finally {
      db.exec('DROP TRIGGER worker_test_public_comment_failure')
    }
    const publicComment = await jsonResponse(await postComment(), 201)
    assert.equal(publicComment.actor, visitor.id)
    assert.equal(publicComment.comment_stripped, draft.text)
    assert.match(
      db.prepare('SELECT comment_html FROM issue_comments WHERE id = ?').get(publicComment.id).comment_html,
      /&lt;strong&gt;/
    )
    assert.equal(
      db.prepare('SELECT member_id FROM project_public_members WHERE project_id = ?').get(project.id).member_id,
      visitor.id
    )
    assert.deepEqual(
      (await jsonResponse(await jsonRequest(boardComments), 200)).map(row => row.id),
      [publicComment.id]
    )
    const commentDetail = `${boardComments}/${publicComment.id}`
    assert.equal((await jsonRequest(commentDetail)).status, 200)
    assert.equal((await jsonRequest(commentDetail, { method: 'PATCH', body: { text: 'Unauthenticated' } })).status, 401)
    assert.equal((await jsonRequest(commentDetail, { method: 'DELETE' })).status, 401)
    assert.equal((await jsonRequest(commentDetail, { ...owner, method: 'DELETE' })).status, 404)
    const edited = await jsonResponse(
      await jsonRequest(commentDetail, { ...visitor, method: 'PATCH', body: { text: 'Updated' } }),
      200
    )
    assert.equal(edited.comment_stripped, 'Updated')
    await enableComments(false)
    assert.deepEqual(await jsonResponse(await jsonRequest(boardComments), 200), [])
    await enableComments(true)
    assert.equal((await jsonRequest(commentDetail, { ...visitor, method: 'DELETE' })).status, 204)
    assert.equal((await jsonRequest(commentDetail)).status, 404)
    assert.equal((await jsonRequest(publicationPath, { ...owner, method: 'DELETE' })).status, 204)
    assert.equal((await jsonRequest(`${publicPath}/issues`)).status, 404)
    assert.equal((await jsonRequest(`${boardPath}/labels`)).status, 404)

    const webhooksPath = `${workspacePath}/webhooks`
    const definition = { url: 'https://hooks.example.test/lancity', issue: true }
    assert.equal((await jsonRequest(webhooksPath, { ...outsider, method: 'POST', body: definition })).status, 403)
    const hook = await jsonResponse(
      await jsonRequest(webhooksPath, { ...owner, method: 'POST', body: definition }),
      201
    )
    assert.equal(hook.isActive, false)
    assert.match(hook.secretKey, /^[a-f0-9]{64}$/)
    const [listedHook] = await jsonResponse(await jsonRequest(webhooksPath, owner), 200)
    assert.equal(listedHook.id, hook.id)
    assert.ok(!('secretKey' in listedHook))
    assert.equal((await jsonRequest(webhooksPath, { ...owner, method: 'POST', body: definition })).status, 409)
    const hookPath = `${webhooksPath}/${hook.id}`
    const rotated = await jsonResponse(await jsonRequest(`${hookPath}/secret`, { ...owner, method: 'POST' }), 200)
    assert.notEqual(rotated.secretKey, hook.secretKey)
    assert.equal((await jsonRequest(hookPath, { ...owner, method: 'DELETE' })).status, 204)
    assert.equal((await jsonRequest(hookPath, owner)).status, 404)
    assert.equal((await jsonRequest(`${projectPath}/members/leave`, { ...outsider, method: 'POST' })).status, 204)
    // PD-0738: a non-member of a public project gets 409, not 404.
    assert.equal((await jsonRequest(projectPath, outsider)).status, 409)
  } finally {
    db.close()
  }
})

test('Instance administration requires an existing admin and enforces workspace creation policy', async () => {
  const owner = await signUp('instance')
  const other = await signUp('nonadmin')
  const instancePath = `${api}/instances`
  assert.equal((await jsonRequest(`${instancePath}/admins`, other)).status, 403)
  const db = new DatabaseSync(process.env.LANCITY_TEST_D1, { timeout: 5_000 })
  let instanceId
  try {
    db.prepare('UPDATE user SET email_verified = 1 WHERE id = ?').run(owner.id)
    createInstanceAdmin(db, `${owner.username}@example.com`, 'Fixture Instance')
    instanceId = db.prepare('SELECT id FROM instances WHERE instance_name = ?').get('Fixture Instance')?.id
    assert.ok(instanceId, 'Instance test requires an isolated database without preexisting instances')
    const instance = await jsonResponse(await jsonRequest(instancePath), 200)
    assert.deepEqual(instance, { instanceName: 'Fixture Instance', isSetupDone: true })
    const [admin] = await jsonResponse(await jsonRequest(`${instancePath}/admins`, owner), 200)
    assert.equal(admin.userId, owner.id)
    assert.equal((await jsonRequest(`${instancePath}/admins/${admin.id}`, { ...owner, method: 'DELETE' })).status, 409)

    const configPath = `${instancePath}/configurations`
    assert.equal(
      (
        await jsonRequest(configPath, {
          ...other,
          method: 'PATCH',
          body: { DISABLE_WORKSPACE_CREATION: '1' }
        })
      ).status,
      403
    )
    db.exec(`INSERT INTO instance_configurations (key, value, category, is_encrypted)
      VALUES ('fixture_secret', 'test-encrypted-value', 'fixture', 1)`)
    const configs = await jsonResponse(await jsonRequest(configPath, owner), 200)
    assert.equal(configs.find(row => row.key === 'fixture_secret').value, null)
    await jsonResponse(
      await jsonRequest(configPath, {
        ...owner,
        method: 'PATCH',
        body: { DISABLE_WORKSPACE_CREATION: '1' }
      }),
      200
    )
    const creation = await jsonRequest(`${api}/workspaces`, {
      ...other,
      method: 'POST',
      body: { name: 'Disabled', slug: `disabled-${runId}` }
    })
    assert.equal((await jsonResponse(creation, 403)).error.code, 'WORKSPACE_CREATION_DISABLED')
  } finally {
    db.prepare('DELETE FROM instance_configurations WHERE key IN (?, ?)').run(
      'fixture_secret',
      'DISABLE_WORKSPACE_CREATION'
    )
    if (instanceId) {
      db.prepare('DELETE FROM instance_admins WHERE instance_id = ?').run(instanceId)
      db.prepare('DELETE FROM instances WHERE id = ?').run(instanceId)
    }
    db.close()
  }
})
