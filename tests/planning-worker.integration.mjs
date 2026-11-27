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
  const ip = `198.19.${parseInt(runId.slice(0, 2), 16)}.${(parseInt(runId.slice(2, 4), 16) + (suffix === 'owner' ? 0 : 1)) % 256}`
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

test('Worker archives cycles and modules and transfers open issues', async () => {
  const db = new DatabaseSync(process.env.LANCITY_TEST_D1, { timeout: 5_000 })
  try {
    const owner = await signup('owner')
    const outsider = await signup('other')
    const slug = `t${runId}`
    const wsRes = await request('/api/v1/workspaces', {
      ...owner,
      method: 'POST',
      body: { name: `Transfer ${runId}`, slug }
    })
    assert.equal(wsRes.status, 201)
    const workspace = await wsRes.json()
    const projectBase = `/api/v1/workspaces/${slug}/projects`
    const pRes = await request(projectBase, {
      ...owner,
      method: 'POST',
      body: { name: `Test ${runId}`, identifier: 'TEST' }
    })
    assert.equal(pRes.status, 201)
    const project = await pRes.json()
    const old = Number(
      db
        .prepare('insert into cycles(name, owned_by_id, project_id, workspace_id, end_date) values(?,?,?,?,?)')
        .run('Old', owner.id, project.id, workspace.id, 1).lastInsertRowid
    )
    const future = Number(
      db
        .prepare('insert into cycles(name, owned_by_id, project_id, workspace_id, end_date) values(?,?,?,?,?)')
        .run('New', owner.id, project.id, workspace.id, 4102444800000).lastInsertRowid
    )
    const mod = Number(
      db
        .prepare('insert into modules(name,status,project_id,workspace_id) values(?,?,?,?)')
        .run(`Module ${runId}`, 'completed', project.id, workspace.id).lastInsertRowid
    )
    const state = db.prepare(`select id from states where project_id=? and "group"='started'`).get(project.id).id
    const issue = Number(
      db
        .prepare('insert into issues(name,sequence_id,state_id,project_id,workspace_id) values(?,?,?,?,?)')
        .run('Open', 1, state, project.id, workspace.id).lastInsertRowid
    )
    db.prepare('insert into cycle_issues(cycle_id,issue_id,project_id,workspace_id) values(?,?,?,?)').run(
      old,
      issue,
      project.id,
      workspace.id
    )
    const prefix = `${projectBase}/${project.id}`
    assert.equal(
      (
        await request(`${prefix}/cycles/${old}/transfer-issues`, {
          ...outsider,
          method: 'POST',
          body: { new_cycle_id: future }
        })
      ).status,
      404
    )
    const moved = await request(`${prefix}/cycles/${old}/transfer-issues`, {
      ...owner,
      method: 'POST',
      body: { new_cycle_id: future }
    })
    assert.equal(moved.status, 200, await moved.clone().text())
    assert.equal(db.prepare('select cycle_id from cycle_issues where issue_id=?').get(issue).cycle_id, future)
    const cycleArchive = await request(`${prefix}/cycles/${old}/archive`, { ...owner, method: 'POST' })
    assert.equal(cycleArchive.status, 200, await cycleArchive.clone().text())
    const moduleArchive = await request(`${prefix}/modules/${mod}/archive`, { ...owner, method: 'POST' })
    assert.equal(moduleArchive.status, 200, await moduleArchive.clone().text())
    const archivedCycles = await request(`${prefix}/archived-cycles`, owner)
    assert.equal(archivedCycles.status, 200)
    assert.ok((await archivedCycles.json()).some(cycle => cycle.id === old))
    assert.equal(
      (await request(`${prefix}/archived-cycles/${old}/unarchive`, { ...owner, method: 'DELETE' })).status,
      204
    )
    assert.equal(
      (await request(`${prefix}/archived-modules/${mod}/unarchive`, { ...owner, method: 'DELETE' })).status,
      204
    )
  } finally {
    db.close()
  }
})
