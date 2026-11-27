import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'vitest'

const base = new URL(process.env.LANCITY_TEST_URL ?? 'http://localhost:4198')
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))
assert.ok(process.env.LANCITY_TEST_D1, 'Set LANCITY_TEST_D1 to the isolated Worker database')
const runId = randomUUID().replaceAll('-', '').slice(0, 12)
async function request(path, { cookie, method = 'GET', body, ip } = {}) {
  const headers = new Headers({ origin: base.origin })
  if (cookie) headers.set('cookie', cookie)
  if (ip) headers.set('cf-connecting-ip', ip)
  if (body !== undefined) headers.set('content-type', 'application/json')
  return fetch(new URL(path, base), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
}
async function signup(suffix) {
  const username = `p${runId}${suffix}`
  const ip = `198.18.${parseInt(runId.slice(0, 2), 16)}.${(parseInt(runId.slice(2, 4), 16) + (suffix === 'owner' ? 0 : 1)) % 256}`
  const res = await request('/api/auth/sign-up/email', {
    method: 'POST',
    ip,
    body: { name: suffix, username, email: `${username}@example.com`, password: 'isolated-test-password' }
  })
  assert.equal(res.status, 200)
  return {
    id: Number((await res.json()).user.id),
    ip,
    cookie: res.headers
      .getSetCookie()
      .map(value => value.split(';', 1)[0])
      .join('; ')
  }
}

async function submitProjectAction(cookie, values) {
  const page = await request('/projects', { cookie })
  assert.equal(page.status, 200)
  // Pick the create-project form (it holds the identifier field), not e.g. the favorite toggle forms.
  const form = [...(await page.text()).matchAll(/<form\b[^>]*>(?:(?!<\/form>)[\s\S])*?<\/form>/g)]
    .map(match => match[0])
    .find(html => html.includes('name="$ACTION_') && html.includes('name="identifier"'))
  assert.ok(form)
  const body = new FormData()
  for (const [, name, value = ''] of form.matchAll(/<input[^>]+name="(\$ACTION_[^"]+)"(?: value="([^"]*)")?/g)) {
    body.append(name, value.replaceAll('&quot;', '"').replaceAll('&#x27;', "'").replaceAll('&amp;', '&'))
  }
  for (const [key, value] of Object.entries(values)) body.append(key, value)
  return fetch(new URL('/projects', base), { method: 'POST', headers: { cookie, origin: base.origin }, body })
}

test('project membership, workspace isolation, state defaults and failed creation rollback', async () => {
  const db = new DatabaseSync(process.env.LANCITY_TEST_D1, { timeout: 5_000 })
  try {
    const owner = await signup('owner')
    const outsider = await signup('outsider')
    const slug = `p${runId}`
    let response = await request('/api/v1/workspaces', {
      ...owner,
      method: 'POST',
      body: { name: `Project workspace ${runId}`, slug }
    })
    assert.equal(response.status, 201)
    const { id: workspaceId } = await response.json()
    const path = `/api/v1/workspaces/${slug}/projects`
    assert.equal((await request(path)).status, 401)
    assert.equal((await request(path, { ...outsider })).status, 404)
    assert.equal((await request(path, { ...owner, method: 'POST', body: { name: '', identifier: 'X' } })).status, 400)
    response = await request(path, { ...owner, method: 'POST', body: { name: `Core ${runId}`, identifier: 'abc' } })
    assert.equal(response.status, 201, await response.clone().text())
    const project = await response.json()
    assert.equal(project.identifier, 'ABC')
    assert.equal(db.prepare('select count(*) as count from states where project_id = ?').get(project.id).count, 6)
    assert.equal(
      db
        .prepare('select count(*) as count from project_members where project_id = ? and member_id = ? and role = 20')
        .get(project.id, owner.id).count,
      1
    )
    assert.equal((await request(`${path}/${project.id}`, { ...outsider })).status, 404)
    const action = await submitProjectAction(owner.cookie, { workspace: slug, name: `Web ${runId}`, identifier: 'WEB' })
    assert.equal(action.status, 200)
    assert.match(await action.text(), /Project created/)
    const webProject = db
      .prepare('select id from projects where workspace_id = ? and identifier = ?')
      .get(workspaceId, 'WEB')
    assert.ok(webProject)
    assert.equal(db.prepare('select count(*) as count from states where project_id = ?').get(webProject.id).count, 6)
    const secondSlug = `other${runId}`
    const second = await request('/api/v1/workspaces', {
      ...owner,
      method: 'POST',
      body: { name: `Other ${runId}`, slug: secondSlug }
    })
    assert.equal(second.status, 201)
    assert.equal((await request(`/api/v1/workspaces/${secondSlug}/projects/${project.id}`, { ...owner })).status, 404)
    db.prepare('insert into workspace_members (workspace_id, member_id, role) values (?, ?, 5)').run(
      workspaceId,
      outsider.id
    )
    assert.equal(
      (await request(path, { ...outsider, method: 'POST', body: { name: 'Denied', identifier: 'NO' } })).status,
      403
    )
    assert.deepEqual(await (await request(path, outsider)).json(), [])
    assert.equal(
      (
        await request(`${path}/${project.id}/members`, {
          ...owner,
          method: 'POST',
          body: { memberId: outsider.id, role: 20 }
        })
      ).status,
      400
    )
    assert.equal(
      (
        await request(`${path}/${project.id}/members`, {
          ...owner,
          method: 'POST',
          body: { memberId: outsider.id, role: 5 }
        })
      ).status,
      201
    )
    assert.equal((await request(`${path}/${project.id}`, outsider)).status, 200)
    assert.equal(
      (await request(`${path}/${project.id}`, { ...outsider, method: 'PATCH', body: { name: 'Denied' } })).status,
      403
    )
    const ownerMember = db
      .prepare('select id from project_members where project_id = ? and member_id = ?')
      .get(project.id, owner.id)
    assert.equal(
      (await request(`${path}/${project.id}/members/${ownerMember.id}`, { ...owner, method: 'DELETE' })).status,
      400 // Plane: nobody removes themselves through DELETE (use leave)
    )
    db.exec(
      `create trigger fail_test_state before insert on project_identifiers when NEW.name = 'FAIL' begin select raise(abort, 'test failure'); end`
    )
    try {
      const failed = await request(path, {
        ...owner,
        method: 'POST',
        body: { name: `Fail ${runId}`, identifier: 'FAIL' }
      })
      assert.equal(failed.status, 400)
      assert.equal(
        db
          .prepare('select count(*) as count from projects where workspace_id = ? and identifier = ?')
          .get(workspaceId, 'FAIL').count,
        0
      )
    } finally {
      db.exec('drop trigger fail_test_state')
    }
  } finally {
    db.close()
  }
})
