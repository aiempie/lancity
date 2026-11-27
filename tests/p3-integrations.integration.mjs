import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { test } from 'vitest'
import { drizzle } from 'drizzle-orm/d1'
import { openTargetDatabase } from '../scripts/plane-import/target-schema.ts'
import * as schema from '../src/db/schema.ts'
import { apiTokenCreateSchema } from '../src/types/integration/p3-integration-schema.ts'
import { dispatchJob } from '../src/server/common/jobs.ts'
import { authenticateApiKeyAuthentication, assertTokenWorkspaceScope } from '../src/server/api-token/authentication.ts'
import {
  createApiToken,
  deleteApiToken,
  getApiToken,
  listApiTokens,
  updateApiToken
} from '../src/server/integration/api.ts'
import { getLlmConfig, getLlmResponse } from '../src/server/integration/llm.ts'
import { generateLabelToken, generateToken, hashApiToken } from '../src/server/integration/model-rules.ts'
import { formatGithubRepositorySync, getIsActiveApiTokenRead } from '../src/server/integration/presenters.ts'
import { createGptIntegration, createWorkspaceGPTIntegration, getUnsplash } from '../src/server/integration/service.ts'
import { register } from '../src/server/webhook/jobs.ts'
import {
  dispatchIssueActivity,
  getModelData,
  modelActivity,
  signPayload,
  webhookActivity,
  webhookSendTask
} from '../src/server/webhook/jobs/delivery.ts'
import { validateDomain, validateSchema } from '../src/server/webhook/model-rules.ts'
import { validateWebhookUrl } from '../src/server/webhook/presenters.ts'
import {
  createWebhook,
  deleteWebhook,
  getWebhook,
  listWebhookLogs,
  listWebhooks,
  rotateWebhookSecret,
  updateWebhook
} from '../src/server/webhook/service.ts'

// A SQLite-backed D1 adapter runs the real Drizzle queries (same approach as p1-issue-background.integration.mjs).
function createEnv(extra = {}) {
  const sqlite = openTargetDatabase('drizzle')
  sqlite.exec(`PRAGMA foreign_keys = ON;
    INSERT INTO user(id,name,email,username,created_at,updated_at) VALUES(1,'Owner','o@example.com','owner',1,1),(2,'Member','m@example.com','member',1,1),(3,'Bot','b@example.com','bot',1,1);
    INSERT INTO workspaces(id,name,slug,owner_id) VALUES(1,'Workspace','ws',1),(2,'Other','other',2);
    INSERT INTO workspace_members(workspace_id,member_id,role) VALUES(1,1,20),(1,2,15),(1,3,5),(2,2,20);
    INSERT INTO projects(id,name,identifier,workspace_id,created_by_id) VALUES(1,'Project','PRJ',1,1);
    INSERT INTO project_members(project_id,workspace_id,member_id,role) VALUES(1,1,1,20),(1,1,2,15);
    INSERT INTO states(id,name,color,slug,project_id,workspace_id,"group") VALUES(1,'Todo','#000','todo',1,1,'unstarted');
    INSERT INTO labels(id,name,workspace_id,project_id,color) VALUES(1,'Bug',1,1,'#f00');
    INSERT INTO issues(id,name,sequence_id,state_id,project_id,workspace_id,created_by_id) VALUES(1,'A',1,1,1,1,1);
    INSERT INTO issue_labels(issue_id,label_id,project_id,workspace_id) VALUES(1,1,1,1);
    INSERT INTO issue_assignees(assignee_id,issue_id,project_id,workspace_id) VALUES(2,1,1,1);`)
  const prepare = sql => ({
    bind: (...params) => ({
      async raw() {
        const stmt = sqlite.prepare(sql)
        stmt.setReturnArrays(true)
        return stmt.all(...params)
      },
      async all() {
        return { results: sqlite.prepare(sql).all(...params) }
      },
      async run() {
        sqlite.prepare(sql).run(...params)
        return { results: [] }
      },
      execute() {
        const stmt = sqlite.prepare(sql)
        return { results: stmt.columns().length ? stmt.all(...params) : (stmt.run(...params), []) }
      }
    })
  })
  const d1 = {
    prepare,
    async batch(statements) {
      sqlite.exec('BEGIN')
      try {
        const result = statements.map(stmt => stmt.execute())
        sqlite.exec('COMMIT')
        return result
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    }
  }
  const sent = []
  const env = { DB: d1, JOBS_QUEUE: { send: async (body, options) => void sent.push({ ...body, options }) }, ...extra }
  return { sqlite, sent, env, db: drizzle(d1, { schema }) }
}

const rows = (sqlite, sql, ...params) => sqlite.prepare(sql).all(...params)
const owner = { userId: 1 }
const member = { userId: 2 }
const publicResolver = async () => ['93.184.216.34']

function addWebhook(sqlite, fields = {}) {
  const hook = { id: 1, url: 'https://hooks.example.com/in', is_active: 1, secret_key: 'secret', issue: 1, ...fields }
  sqlite
    .prepare(
      `INSERT INTO webhooks(id,url,is_active,secret_key,issue,project,workspace_id,created_by_id) VALUES(?,?,?,?,?,?,1,1)`
    )
    .run(hook.id, hook.url, hook.is_active, hook.secret_key, hook.issue, fields.project ?? 0)
  return hook
}

test('pure helpers: token format, hash, expiry, validators and signature', async () => {
  assert.match(generateToken(), /^plane_api_[a-f0-9]{64}$/)
  assert.match(generateLabelToken(), /^[a-f0-9]{32}$/)
  assert.match(await hashApiToken('abc'), /^[a-f0-9]{64}$/)
  assert.equal(getIsActiveApiTokenRead(null), true)
  assert.equal(getIsActiveApiTokenRead(new Date(Date.now() + 1000)), true)
  assert.equal(getIsActiveApiTokenRead(new Date(Date.now() - 1000)), false)
  assert.equal(formatGithubRepositorySync({ repositoryName: 'repo', projectName: 'Proj' }), 'repo <Proj>')
  assert.throws(() => validateSchema('ftp://example.com/'), /Invalid schema/)
  assert.throws(() => validateDomain('http://localhost/x'), /Local URLs/)
  assert.throws(() => validateDomain('http://127.0.0.1:8000/x'), /Local URLs/)
  validateDomain('https://example.com/x')
  assert.equal(await signPayload('key', '{"a":1}'), createHmac('sha256', 'key').update('{"a":1}').digest('hex'))
})

test('API tokens: create once, store a hash, list, update, authenticate and revoke', async () => {
  const { sqlite, db } = createEnv()
  const created = await createApiToken(db, owner, { workspaceId: 1, label: 'CI', description: 'build' })
  assert.match(created.token, /^plane_api_/)
  assert.equal(created.workspaceId, 1)
  assert.equal(apiTokenCreateSchema.safeParse({}).success, false)
  assert.equal(apiTokenCreateSchema.safeParse({ workspaceId: 0 }).success, false)
  await assert.rejects(createApiToken(db, owner, { workspaceId: 2 }), { status: 404 })
  await assertTokenWorkspaceScope(db, 1, '/workspaces/ws/projects')
  await assert.rejects(assertTokenWorkspaceScope(db, 1, '/workspaces/other/projects'), { status: 403 })
  await assert.rejects(assertTokenWorkspaceScope(db, null, '/workspaces/ws/projects'), { status: 401 })
  sqlite.prepare('INSERT INTO api_tokens(token, label, user_id, workspace_id, is_active) VALUES (?, ?, 1, NULL, 1)').run(await hashApiToken('legacy'), 'legacy')
  await assert.rejects(authenticateApiKeyAuthentication(db, new Headers({ 'x-api-key': 'legacy' })), { status: 401 })
  sqlite.exec('UPDATE workspace_members SET is_active = 0 WHERE workspace_id = 1 AND member_id = 1')
  await assert.rejects(createApiToken(db, owner, { workspaceId: 1 }), { status: 404 })
  sqlite.exec('UPDATE workspace_members SET is_active = 1 WHERE workspace_id = 1 AND member_id = 1')
  assert.equal(created.userType, 0)
  assert.equal(created.isActive, true)
  const [stored] = rows(sqlite, 'SELECT token FROM api_tokens WHERE id = ?', created.id)
  assert.equal(stored.token, await hashApiToken(created.token))
  assert.notEqual(stored.token, created.token)

  const generated = await createApiToken(db, owner, { workspaceId: 1 })
  assert.match(generated.label, /^[a-f0-9]{32}$/)
  const [first] = await listApiTokens(db, owner)
  assert.ok(!('token' in first))
  assert.equal((await listApiTokens(db, member)).length, 0)
  await assert.rejects(getApiToken(db, member, created.id), { status: 404 })

  const updated = await updateApiToken(db, owner, created.id, { label: 'CI 2' })
  assert.equal(updated.label, 'CI 2')
  assert.ok(!('token' in updated))

  const headers = new Headers({ 'X-API-Key': created.token })
  assert.deepEqual(await authenticateApiKeyAuthentication(db, headers), owner)
  assert.ok((await getApiToken(db, owner, created.id)).lastUsed)
  assert.equal(await authenticateApiKeyAuthentication(db, new Headers()), null)
  await assert.rejects(authenticateApiKeyAuthentication(db, new Headers({ 'x-api-key': 'plane_api_nope' })), {
    status: 401
  })
  // The stored hash is not a credential.
  await assert.rejects(authenticateApiKeyAuthentication(db, new Headers({ 'x-api-key': stored.token })), {
    status: 401
  })

  sqlite.exec('INSERT INTO user_security(user_id, is_active) VALUES(3, 0)')
  const inactive = await createApiToken(db, { userId: 3 }, { workspaceId: 1 })
  await assert.rejects(authenticateApiKeyAuthentication(db, new Headers({ 'x-api-key': inactive.token })), {
    status: 401
  })
  sqlite.exec('UPDATE user_security SET is_active = 1, is_bot = 1 WHERE user_id = 3')
  assert.equal((await createApiToken(db, { userId: 3 }, { workspaceId: 1 })).userType, 1)

  const expired = await createApiToken(db, owner, { workspaceId: 1, expiredAt: new Date(Date.now() - 60_000) })
  assert.equal(expired.isActive, false)
  await assert.rejects(authenticateApiKeyAuthentication(db, new Headers({ 'x-api-key': expired.token })), {
    status: 401
  })

  await deleteApiToken(db, owner, created.id)
  await assert.rejects(authenticateApiKeyAuthentication(db, headers), { status: 401 })
  await assert.rejects(getApiToken(db, owner, created.id), { status: 404 })
})

test('webhook management: SSRF checks, inactive start, secret shown once, activation and soft delete', async () => {
  const { db } = createEnv()
  const input = { url: 'https://hooks.example.com/in', issue: true }
  await assert.rejects(createWebhook(db, member, 'ws', input, { env: {}, resolver: publicResolver }), { status: 403 })
  await assert.rejects(
    createWebhook(
      db,
      owner,
      'ws',
      { url: 'https://internal.example.com/' },
      { env: {}, resolver: async () => ['10.0.0.5'] }
    ),
    { status: 400 }
  )
  await assert.rejects(
    createWebhook(db, owner, 'ws', { url: 'http://localhost/hook' }, { env: {}, resolver: publicResolver }),
    {
      status: 400
    }
  )
  await assert.rejects(
    createWebhook(
      db,
      owner,
      'ws',
      { url: 'https://app.example.com/hook' },
      { env: {}, requestHost: 'app.example.com', resolver: publicResolver }
    ),
    { status: 400 }
  )
  await assert.rejects(
    createWebhook(
      db,
      owner,
      'ws',
      { url: 'https://a.evil.test/hook' },
      { env: { WEBHOOK_DISALLOWED_DOMAINS: 'evil.test' }, resolver: publicResolver }
    ),
    { status: 400 }
  )
  // An unresolvable host is tolerated at save time. Delivery validates it again.
  const unresolved = await createWebhook(
    db,
    owner,
    'ws',
    { url: 'https://nx.example.test/in' },
    {
      env: {},
      resolver: async () => {
        throw new Error('nxdomain')
      }
    }
  )
  await deleteWebhook(db, owner, 'ws', unresolved.id)

  const created = await createWebhook(db, owner, 'ws', input, { env: {}, resolver: publicResolver })
  assert.equal(created.isActive, false)
  assert.match(created.secretKey, /^[a-f0-9]{64}$/)
  await assert.rejects(createWebhook(db, owner, 'ws', input, { env: {}, resolver: publicResolver }), { status: 409 })
  const [listed] = await listWebhooks(db, owner, 'ws')
  assert.ok(!('secretKey' in listed))
  const activated = await updateWebhook(
    db,
    owner,
    'ws',
    created.id,
    { isActive: true, cycle: true },
    { env: {}, resolver: publicResolver }
  )
  assert.equal(activated.isActive, true)
  assert.ok(!('secretKey' in activated))
  await assert.rejects(
    updateWebhook(
      db,
      owner,
      'ws',
      created.id,
      { url: 'https://x.example.com/' },
      { env: {}, resolver: async () => ['127.0.0.1'] }
    ),
    { status: 400 }
  )
  const rotated = await rotateWebhookSecret(db, owner, 'ws', created.id)
  assert.notEqual(rotated.secretKey, created.secretKey)
  assert.deepEqual(await listWebhookLogs(db, owner, 'ws', created.id), [])
  await deleteWebhook(db, owner, 'ws', created.id)
  await assert.rejects(getWebhook(db, owner, 'ws', created.id), { status: 404 })
})

test('model_activity and dispatch turn changes into webhook.activity jobs', async () => {
  const { sqlite, env, sent } = createEnv()
  await modelActivity(env, { model_name: 'project', model_id: 1, actor_id: 1, slug: 'ws', current_instance: null })
  assert.equal(sent[0].type, 'webhook.activity')
  assert.equal(sent[0].payload.verb, 'created')

  sent.length = 0
  await modelActivity(env, {
    model_name: 'issue',
    model_id: 1,
    actor_id: 1,
    slug: 'ws',
    requested_data: { name: 'B', priority: 'none', ignored: 1, labels: [1, 2] },
    current_instance: JSON.stringify({ name: 'A', priority: 'none', labels: [2, 1] })
  })
  assert.deepEqual(
    sent.map(job => [job.payload.field, job.payload.old_value, job.payload.new_value]),
    [
      ['name', 'A', 'B'],
      ['labels', [2, 1], [1, 2]]
    ]
  )

  sent.length = 0
  sqlite.exec(`INSERT INTO issue_activities(id,verb,field,old_value,new_value,issue_id,project_id,workspace_id,actor_id)
    VALUES(1,'updated','name','A','B',1,1,1,1),(2,'updated',NULL,NULL,NULL,1,1,1,1)`)
  await dispatchIssueActivity(env, {
    source: 'issue.activity',
    type: 'issue.activity.updated',
    issueId: 1,
    projectId: 1,
    workspaceId: 1,
    actorId: 1,
    activityIds: [1, 2]
  })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].payload.field, 'name')
  assert.equal(sent[0].payload.event, 'issue')
  sent.length = 0
  await dispatchIssueActivity(env, {
    type: 'cycle.activity.created',
    projectId: 1,
    workspaceId: 1,
    actorId: 1,
    activityIds: []
  })
  assert.equal(sent.length, 0)
})

test('webhookActivity fans out to subscribed active webhooks with expanded data', async () => {
  const { sqlite, env, sent, db } = createEnv()
  addWebhook(sqlite, { id: 1, url: 'https://a.example.com/in', issue: 1 })
  addWebhook(sqlite, { id: 2, url: 'https://b.example.com/in', issue: 0, project: 1 })
  addWebhook(sqlite, { id: 3, url: 'https://c.example.com/in', issue: 1, is_active: 0 })
  const issue = await getModelData(db, 'issue', 1, { workspaceId: 1 })
  assert.equal(issue.id, 1)
  assert.deepEqual(
    issue.labels.map(label => label.name),
    ['Bug']
  )
  assert.equal(issue.assignees[0].id, 2)
  assert.equal(await getModelData(db, 'issue', 1, { workspaceId: 2 }), null)
  await assert.rejects(getModelData(db, 'nope', 1), /Model not found/)

  await webhookActivity(env, {
    event: 'issue',
    verb: 'updated',
    field: 'name',
    old_value: 'A',
    new_value: 'B',
    actor_id: 1,
    slug: 'ws',
    event_id: 1
  })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].type, 'webhook.send')
  assert.equal(sent[0].payload.webhookId, 1)
  assert.equal(sent[0].payload.activity.field, 'name')
  assert.equal(sent[0].payload.activity.actor.id, 1)
  assert.equal(sent[0].payload.eventData.id, 1)

  sent.length = 0
  await webhookActivity(env, { event: 'issue', verb: 'deleted', actor_id: 1, slug: 'ws', event_id: 99 })
  assert.deepEqual(sent[0].payload.eventData, { id: 99 })
  sent.length = 0
  await webhookActivity(env, { event: 'issue', verb: 'updated', actor_id: 1, slug: 'ws', event_id: 99 })
  assert.equal(sent.length, 0)
})

test('webhookSendTask signs the body, logs the answer, retries transport errors and deactivates after the last', async () => {
  const { sqlite, env, sent } = createEnv({ BETTER_AUTH_URL: 'https://lancity.example.com' })
  addWebhook(sqlite)
  const realFetch = globalThis.fetch
  const calls = []
  let behaviour = () => new Response('ok', { status: 200, headers: { 'x-test': '1' } })
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return behaviour()
  }
  try {
    const base = {
      webhookId: 1,
      slug: 'ws',
      event: 'issue',
      eventData: { id: 1 },
      action: 'updated',
      activity: { field: 'name' }
    }
    await webhookSendTask(env, base, { resolver: publicResolver })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'https://hooks.example.com/in')
    const { headers, body } = calls[0].init
    assert.equal(headers.get('x-plane-event'), 'issue')
    assert.equal(headers.get('x-plane-signature'), createHmac('sha256', 'secret').update(body).digest('hex'))
    assert.equal(JSON.parse(body).workspace_slug, 'ws')
    assert.equal(JSON.parse(body).action, 'updated')
    const [log] = rows(sqlite, 'SELECT * FROM webhook_logs')
    assert.equal(log.response_status, '200')
    assert.equal(log.response_body, 'ok')
    assert.equal(log.webhook, 1)
    assert.equal(log.retry_count, 0)

    // The action of an HTTP verb is translated like Plane does.
    await webhookSendTask(env, { ...base, action: 'PATCH' }, { resolver: publicResolver })
    assert.equal(JSON.parse(calls[1].init.body).action, 'update')

    // A private target is rejected: logged with 400, no retry and no deactivation.
    await webhookSendTask(env, base, { resolver: async () => ['10.0.0.9'] })
    assert.equal(calls.length, 2)
    const rejected = rows(sqlite, 'SELECT * FROM webhook_logs ORDER BY id DESC LIMIT 1')[0]
    assert.equal(rejected.response_status, '400')
    assert.match(rejected.response_body, /Webhook URL rejected/)
    assert.equal(sent.length, 0)

    // A transport error schedules the next attempt with a counter and a delay of at most 600 seconds.
    behaviour = () => {
      throw new TypeError('fetch failed')
    }
    await webhookSendTask(env, base, { resolver: publicResolver })
    assert.equal(rows(sqlite, 'SELECT * FROM webhook_logs ORDER BY id DESC LIMIT 1')[0].response_status, '500')
    assert.equal(sent.length, 1)
    assert.equal(sent[0].type, 'webhook.send')
    assert.equal(sent[0].payload.retryCount, 1)
    assert.ok(sent[0].payload.deliveryId)
    assert.ok(!sent[0].options || sent[0].options.delaySeconds <= 600)
    assert.equal(rows(sqlite, 'SELECT is_active FROM webhooks WHERE id = 1')[0].is_active, 1)

    sent.length = 0
    await webhookSendTask(env, { ...base, retryCount: 5 }, { resolver: publicResolver })
    assert.equal(rows(sqlite, 'SELECT is_active FROM webhooks WHERE id = 1')[0].is_active, 0)
    assert.equal(sent.length, 1)
    assert.equal(sent[0].type, 'webhook.deactivation_email')
    assert.equal(sent[0].payload.receiverId, 1)

    // An inactive webhook is skipped.
    const before = calls.length
    await webhookSendTask(env, base, { resolver: publicResolver })
    assert.equal(calls.length, before)
  } finally {
    globalThis.fetch = realFetch
  }
})

test('registered handlers validate payloads and run through dispatchJob', async () => {
  const { env, sent } = createEnv()
  register()
  await dispatchJob(env, {
    type: 'webhook.model_activity',
    payload: { model_name: 'project', model_id: 1, actor_id: 1, slug: 'ws' }
  })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].type, 'webhook.activity')
  const warn = console.warn
  console.warn = () => {}
  try {
    await dispatchJob(env, { type: 'webhook.activity', payload: { event: 'issue' } })
  } finally {
    console.warn = warn
  }
  assert.equal(sent.length, 1)
})

test('LLM config, completion and the AI assistant endpoints', async () => {
  const { sqlite, env, db } = createEnv()
  const warn = console.warn
  console.warn = () => {}
  try {
    assert.equal(await getLlmConfig(db, env), null)
    assert.equal(await getLlmConfig(db, { ...env, LLM_API_KEY: 'k', LLM_PROVIDER: 'nope' }), null)
    assert.equal(await getLlmConfig(db, { ...env, LLM_API_KEY: 'k', LLM_MODEL: 'gpt-9' }), null)
  } finally {
    console.warn = warn
  }
  assert.deepEqual(await getLlmConfig(db, { ...env, LLM_API_KEY: 'k' }), {
    apiKey: 'k',
    model: 'gpt-4o-mini',
    provider: 'openai'
  })
  // A plain instance configuration row wins over the environment.
  sqlite.exec(
    `INSERT INTO instance_configurations(key,value,category,is_encrypted) VALUES('LLM_PROVIDER','anthropic','ai',0)`
  )
  assert.equal((await getLlmConfig(db, { ...env, LLM_API_KEY: 'k' })).model, 'claude-3-sonnet-20240229')
  sqlite.exec(`UPDATE instance_configurations SET value = 'openai'`)

  const requests = []
  const fetcher = async (url, init) => {
    requests.push({ url: String(url), init })
    return Response.json({ choices: [{ message: { content: 'line 1\n<b>two</b>' } }] })
  }
  const llmEnv = { ...env, LLM_API_KEY: 'k' }
  await assert.rejects(createWorkspaceGPTIntegration(db, owner, env, 'other', { task: 't' }, fetcher), { status: 403 })
  await assert.rejects(createWorkspaceGPTIntegration(db, member, env, 'ws', { task: 't' }, fetcher), { status: 400 })
  const answer = await createWorkspaceGPTIntegration(
    db,
    member,
    llmEnv,
    'ws',
    { task: 'Summarize', prompt: 'text' },
    fetcher
  )
  assert.equal(answer.response, 'line 1\n<b>two</b>')
  assert.equal(answer.response_html, 'line 1<br/>&lt;b&gt;two&lt;/b&gt;')
  assert.equal(requests[0].url, 'https://api.openai.com/v1/chat/completions')
  assert.equal(JSON.parse(requests[0].init.body).messages[0].content, 'Summarize\ntext')
  const projectAnswer = await createGptIntegration(db, member, llmEnv, 'ws', 1, { task: 'T' }, fetcher)
  assert.equal(projectAnswer.project_detail.identifier, 'PRJ')
  assert.equal(projectAnswer.workspace_detail.slug, 'ws')
  await assert.rejects(createGptIntegration(db, member, llmEnv, 'ws', 2, { task: 'T' }, fetcher), { status: 403 })

  const config = { apiKey: 'k', model: 'gpt-4o', provider: 'openai' }
  assert.deepEqual(await getLlmResponse('t', 'p', config, async () => new Response('no', { status: 401 })), {
    text: null,
    error: 'Invalid API key for openai'
  })
  assert.equal(
    (await getLlmResponse('t', 'p', config, async () => new Response('no', { status: 429 }))).error,
    'Rate limit exceeded for openai'
  )
  await assert.rejects(
    createWorkspaceGPTIntegration(
      db,
      member,
      llmEnv,
      'ws',
      { task: 'T' },
      async () => new Response('x', { status: 500 })
    ),
    {
      status: 500
    }
  )
})

test('Unsplash proxy', async () => {
  const { env, db } = createEnv()
  assert.deepEqual(await getUnsplash(db, env, { page: 1, per_page: 20 }), { status: 200, body: [] })
  const requests = []
  const fetcher = async (url, init) => {
    requests.push({ url: new URL(url), init })
    return Response.json({ results: [] }, { status: 201 })
  }
  const keyed = { ...env, UNSPLASH_ACCESS_KEY: 'access' }
  const search = await getUnsplash(db, keyed, { query: 'cats & dogs', page: 2, per_page: 5 }, fetcher)
  assert.equal(search.status, 201)
  assert.equal(requests[0].url.pathname, '/search/photos/')
  assert.equal(requests[0].url.searchParams.get('query'), 'cats & dogs')
  assert.equal(requests[0].url.searchParams.get('page'), '2')
  assert.equal(requests[0].init.headers.authorization, 'Client-ID access')
  assert.ok(!requests[0].url.search.includes('access'))
  await getUnsplash(db, keyed, { page: 1, per_page: 20 }, fetcher)
  assert.equal(requests[1].url.pathname, '/photos/')
})

test('webhook URL validation is exported for reuse', async () => {
  await validateWebhookUrl('https://hooks.example.com/x', {}, { resolver: publicResolver })
  await assert.rejects(
    validateWebhookUrl('https://hooks.example.com/x', {}, { resolver: async () => ['169.254.169.254'] }),
    { status: 400 }
  )
  await validateWebhookUrl(
    'https://metadata.internal/x',
    { WEBHOOK_ALLOWED_HOSTS: 'metadata.internal' },
    { resolver: async () => ['169.254.169.254'] }
  )
  await validateWebhookUrl(
    'https://hooks.example.com/x',
    { WEBHOOK_ALLOWED_IPS: '10.0.0.0/8' },
    { resolver: async () => ['10.1.1.1'] }
  )
})
