import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'vitest'
import { getDb } from '../src/db/client'
import { and, isNull, sql } from 'drizzle-orm'
import { issues, labels } from '../src/db/schema/issue'
import { createLocalD1 } from '../scripts/maintenance/d1-shim'
import { reencryptInstanceSecrets } from '../scripts/plane-import/cli'
import { decryptData, decryptValue, encryptData, encryptFernet } from '../src/server/instance/encryption'
import { loadAuthPageSettings, loadAuthSettings } from '../src/server/identity/settings'
import { getConfigurationValue } from '../src/server/instance/instance-value'
import { workspaceCreationDisabled } from '../src/server/instance/service'
import { getConfigurationValues } from '../src/server/integration/llm'
import { loadIssueExportRecords } from '../src/server/export/queries'
import { searchIssues } from '../src/server/issue/filter'
import { changePublicComment } from '../src/server/public/comments'
import { foldGlob } from '../src/server/common/unicode'
import { getModelData } from '../src/server/webhook/jobs/delivery'
import type { InfraEnv } from '../src/server/common/env'

function openDb() {
  const raw = new DatabaseSync(':memory:')
  for (const name of readdirSync('drizzle').filter(file => file.endsWith('.sql')).sort()) raw.exec(readFileSync(`drizzle/${name}`, 'utf8'))
  raw.exec(`PRAGMA foreign_keys = ON;
    INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (1, 'Admin', 'admin@example.com', 1, 1, 1), (2, 'Bot', 'bot@example.com', 1, 1, 1);
    INSERT INTO workspaces (id, name, slug, owner_id) VALUES (1, 'Workspace', 'ws', 1);
    INSERT INTO workspace_members (workspace_id, member_id, role) VALUES (1, 1, 20);
    INSERT INTO projects (id, name, identifier, workspace_id) VALUES (1, 'Dự án', 'DA', 1);
    INSERT INTO project_members (workspace_id, project_id, member_id, role) VALUES (1, 1, 1, 20);`)
  const db = getDb(createLocalD1(raw))
  return { raw, db }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>
const SECRET = 'plane-secret'

test('decryptValue reads a Fernet token produced by Python cryptography', async () => {
  const token = 'gAAAAABrBN_wIVxcJG4RG9QjCbCQJaZRSfsvigQHXpGf2hcVrsQ7WzfVAy1njxRMX8XWrQ7GcJMg418zJrjlRgJvKLeGWIcaxA=='
  assert.equal(await decryptValue(token, SECRET), 'héllo-secret')
})

test('decryptValue reads Fernet and v1 values, and reports failures instead of returning an empty string', async () => {
  const fernet = await encryptFernet('smtp-pass', SECRET)
  assert.equal(await decryptValue(fernet, SECRET), 'smtp-pass')
  assert.equal(await decryptValue(await encryptData('oauth-secret', SECRET), SECRET), 'oauth-secret')
  await assert.rejects(decryptValue(fernet, 'wrong-key'), { code: 'DECRYPTION_FAILED' })
  await assert.rejects(decryptValue(fernet, ''), { code: 'DECRYPTION_FAILED' })
  await assert.rejects(decryptValue('gAAAAAtampered', SECRET), { code: 'DECRYPTION_FAILED' })
  assert.equal(await decryptData(fernet, 'wrong-key'), null)
})

test('import: Fernet instance configuration is kept, or re-encrypted as v1 when both keys are given', async () => {
  const fernet = await encryptFernet('google-secret', SECRET)
  const makeResult = () => ({ rows: new Map([['instance_configurations', [{ key: 'GOOGLE_CLIENT_SECRET', value: fernet, is_encrypted: 1 }]]]), report: { warnings: [] as string[] } })
  const untouched = makeResult()
  await reencryptInstanceSecrets(untouched as never, undefined, undefined)
  assert.equal(untouched.rows.get('instance_configurations')![0].value, fernet)
  const converted = makeResult()
  await reencryptInstanceSecrets(converted as never, SECRET, 'lancity-key')
  const value = String(converted.rows.get('instance_configurations')![0].value)
  assert.match(value, /^v1:/)
  assert.equal(await decryptValue(value, 'lancity-key'), 'google-secret')
  const failed = makeResult()
  await reencryptInstanceSecrets(failed as never, 'wrong', 'lancity-key')
  assert.equal(failed.rows.get('instance_configurations')![0].value, fernet)
  assert.equal(failed.report.warnings.length, 1)
})

test('OAuth configuration reads imported Fernet secrets, respects stored empty values and reports decrypt errors', async () => {
  const { raw, db } = openDb()
  const env = { INSTANCE_ENCRYPTION_KEY: SECRET, GOOGLE_CLIENT_ID: 'env-id', GOOGLE_CLIENT_SECRET: 'env-secret' }
  raw.prepare("INSERT INTO instance_configurations (key, value, category, is_encrypted) VALUES ('GOOGLE_CLIENT_SECRET', ?, 'GOOGLE', 1), ('GOOGLE_CLIENT_ID', 'stored-id', 'GOOGLE', 0), ('IS_GOOGLE_ENABLED', '1', 'GOOGLE', 0)").run(await encryptFernet('imported-secret', SECRET))
  const settings = await loadAuthSettings(db, env)
  assert.equal(settings.google.enabled, true)
  assert.equal(settings.google.clientId, 'stored-id')
  assert.equal(settings.google.clientSecret, 'imported-secret')
  raw.exec("UPDATE instance_configurations SET value = '' WHERE key = 'GOOGLE_CLIENT_SECRET'")
  assert.equal((await loadAuthSettings(db, env)).google.enabled, false)
  raw.exec("UPDATE instance_configurations SET value = 'corrupt' WHERE key = 'GOOGLE_CLIENT_SECRET'")
  await assert.rejects(loadAuthSettings(db, env), { code: 'DECRYPTION_FAILED' })
  raw.close()
})

test('auth pages use environment-only Google settings and still load other sign-in providers', async () => {
  const { raw, db } = openDb()
  try {
    raw.exec(`INSERT INTO instance_configurations (key, value, category, is_encrypted) VALUES
      ('GOOGLE_CLIENT_SECRET', 'invalid-ciphertext', 'GOOGLE', 1),
      ('GOOGLE_CLIENT_ID', 'stored-id', 'GOOGLE', 0),
      ('IS_GOOGLE_ENABLED', '0', 'GOOGLE', 0),
      ('IS_GITHUB_ENABLED', '1', 'GITHUB', 0)`)
    const env = { GOOGLE_CLIENT_ID: 'env-id', GOOGLE_CLIENT_SECRET: 'env-secret', GITHUB_CLIENT_ID: 'github-id', GITHUB_CLIENT_SECRET: 'github-secret' }
    const settings = await loadAuthPageSettings(db, env)
    assert.equal(settings.google.enabled, true)
    assert.equal(settings.github.enabled, true)
    assert.equal((await loadAuthPageSettings(db, { GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID })).google.enabled, false)
  } finally {
    raw.close()
  }
})

test('encrypted LLM_API_KEY, Fernet SMTP secrets and the workspace-creation env fallback are read', async () => {
  const { raw, db } = openDb()
  const env = { INSTANCE_ENCRYPTION_KEY: SECRET, DISABLE_WORKSPACE_CREATION: '1' } as unknown as InfraEnv
  raw.prepare("INSERT INTO instance_configurations (key, value, category, is_encrypted) VALUES ('LLM_API_KEY', ?, 'AI', 1), ('EMAIL_HOST_PASSWORD', ?, 'SMTP', 1)").run(
    await encryptFernet('sk-test', SECRET),
    await encryptData('gmail-pass', SECRET)
  )
  assert.equal((await getConfigurationValues(db, env, ['LLM_API_KEY'] as const)).LLM_API_KEY, 'sk-test')
  const [password] = await getConfigurationValue(db, [{ key: 'EMAIL_HOST_PASSWORD' }], env)
  assert.equal(password, 'gmail-pass')
  assert.equal(await workspaceCreationDisabled(db, env as never), true)
  assert.equal(await workspaceCreationDisabled(db, {} as never), false)
  raw.exec("INSERT INTO instance_configurations (key, value, category) VALUES ('DISABLE_WORKSPACE_CREATION', '0', 'WORKSPACE_MANAGEMENT')")
  assert.equal(await workspaceCreationDisabled(db, env as never), false)
})

test('Unicode case-insensitive search and label name matching on D1/SQLite', async () => {
  const { raw, db } = openDb()
  raw.exec(`INSERT INTO issues (id, name, project_id, workspace_id, sequence_id) VALUES
    (1, 'đăng nhập lỗi', 1, 1, 1), (2, 'ĐĂNG KÝ', 1, 1, 2), (3, 'Dang ky', 1, 1, 3), (4, '50% off_[x]*', 1, 1, 4);
    INSERT INTO labels (id, name, project_id, workspace_id, color) VALUES (1, 'Đang xử lý', 1, 1, '#fff');`)
  const names = async (query: string) =>
    (await db.select({ name: issues.name }).from(issues).where(searchIssues(query))).map(row => row.name).sort()
  assert.deepEqual(await names('Đăng'), ['ĐĂNG KÝ', 'đăng nhập lỗi'])
  assert.deepEqual(await names('đĂNG ký'), ['ĐĂNG KÝ'])
  assert.deepEqual(await names('dang'), ['Dang ky'])
  assert.deepEqual(await names('50% OFF_[X]*'), ['50% off_[x]*'])
  const { equalsFolded } = await import('../src/server/common/unicode')
  const exact = async (name: string) => (await db.select({ id: labels.id }).from(labels).where(and(isNull(labels.deletedAt), equalsFolded(sql`${labels.name}`, name)))).length
  assert.equal(await exact('đang XỬ LÝ'), 1)
  assert.equal(await exact('đang xử'), 0)
  assert.equal(foldGlob('a*'), '[aA][*]')
})

test('issue export includes archived, draft and triage issues like Plane', async () => {
  const { raw, db } = openDb()
  raw.exec(`INSERT INTO states (id, name, slug, color, "group", project_id, workspace_id, is_triage) VALUES (1, 'Todo', 'todo', '#000', 'unstarted', 1, 1, 0), (2, 'Triage', 'triage', '#000', 'triage', 1, 1, 1);
    INSERT INTO issues (id, name, project_id, workspace_id, sequence_id, state_id, archived_at, is_draft) VALUES
    (1, 'live', 1, 1, 1, 1, NULL, 0), (2, 'archived', 1, 1, 2, 1, 1700000000000, 0), (3, 'draft', 1, 1, 3, 1, NULL, 1), (4, 'triage', 1, 1, 4, 2, NULL, 0);
    INSERT INTO issues (id, name, project_id, workspace_id, sequence_id, state_id, deleted_at) VALUES (5, 'deleted', 1, 1, 5, 1, 1700000000000);`)
  const records = await loadIssueExportRecords(db, { workspaceId: 1, workspaceSlug: 'ws', userId: 1, projectIds: [1] })
  assert.deepEqual(records.map(record => record.name), ['live', 'archived', 'draft', 'triage'])
})

test('webhook payloads use Plane serializer shapes', async () => {
  const { raw, db } = openDb()
  raw.exec(`INSERT INTO states (id, name, slug, color, "group", project_id, workspace_id) VALUES (1, 'Todo', 'todo', '#111', 'unstarted', 1, 1);
    INSERT INTO issues (id, name, project_id, workspace_id, sequence_id, state_id) VALUES (1, 'one', 1, 1, 1, 1);
    INSERT INTO issue_assignees (issue_id, assignee_id, project_id, workspace_id) VALUES (1, 1, 1, 1);
    INSERT INTO issue_comments (id, issue_id, project_id, workspace_id, actor_id, comment_stripped, comment_html, comment_json, access, attachments) VALUES (1, 1, 1, 1, 1, 'hi', '<p>hi</p>', '{"a":1}', 'INTERNAL', '[]');`)
  const issue = (await getModelData(db, 'issue', 1, { workspaceId: 1 })) as Loose
  assert.equal(issue.project, 1)
  assert.equal(issue.workspace, 1)
  assert.equal('project_id' in issue, false)
  assert.equal('description_binary' in issue, false)
  assert.deepEqual(issue.state, { id: 1, name: 'Todo', color: '#111', group: 'unstarted' })
  assert.equal(issue.assignees[0].email, 'admin@example.com')
  assert.equal('is_bot' in issue.assignees[0], false)
  const comment = (await getModelData(db, 'issue_comment', 1, { workspaceId: 1 })) as Loose
  assert.equal(comment.actor, 1)
  assert.equal('comment_json' in comment, false)
  assert.equal('comment_stripped' in comment, false)
  assert.equal(comment.comment_html, '<p>hi</p>')
})

test('PATCH public comment without comment_json keeps the stored comment_json', async () => {
  const { raw, db } = openDb()
  raw.exec(`INSERT INTO deploy_boards (anchor, entity_identifier, entity_name, project_id, workspace_id, is_comments_enabled) VALUES ('anchor1', '1', 'project', 1, 1, 1);
    INSERT INTO issues (id, name, project_id, workspace_id, sequence_id) VALUES (1, 'one', 1, 1, 1);
    INSERT INTO issue_comments (id, issue_id, project_id, workspace_id, actor_id, comment_stripped, comment_html, comment_json, access, attachments, updated_at) VALUES (1, 1, 1, 1, 1, 'hi', '<p>hi</p>', '{"a":1}', 'EXTERNAL', '[]', 1000);`)
  const actor = { userId: 1 } as never
  await changePublicComment(db, actor, 'anchor1', 1, 1, { text: 'new' }, { html: '<p>new</p>', json: undefined })
  const row = raw.prepare('select comment_html, comment_json from issue_comments where id = 1').get() as { comment_html: string; comment_json: string }
  assert.equal(row.comment_html, '<p>new</p>')
  assert.deepEqual(JSON.parse(row.comment_json), { a: 1 })
  await changePublicComment(db, actor, 'anchor1', 1, 1, { text: 'newer' }, { html: '<p>newer</p>', json: { b: 2 } })
  assert.deepEqual(JSON.parse((raw.prepare('select comment_json from issue_comments where id = 1').get() as { comment_json: string }).comment_json), { b: 2 })
})

test('containsFolded and equalsFolded keep patterns within the D1 GLOB limit for long terms', async () => {
  const { containsFolded, equalsFolded } = await import('../src/server/common/unicode')
  const { SQLiteSyncDialect } = await import('drizzle-orm/sqlite-core')
  const dialect = new SQLiteSyncDialect()
  const longTerm = 'P3 Space 501ea02cc815'
  for (const condition of [containsFolded(sql`name`, longTerm), equalsFolded(sql`name`, longTerm), containsFolded(sql`name`, 'Đăng ký tài khoản mới')]) {
    const { params } = dialect.sqlToQuery(condition)
    for (const param of params) {
      if (typeof param !== 'string') continue
      const patterns = param.startsWith('[{"') ? (JSON.parse(param) as Array<{ pattern: string }>).map(chunk => chunk.pattern) : [param]
      for (const pattern of patterns) assert.ok(new TextEncoder().encode(pattern).length <= 50, pattern)
    }
  }
})
