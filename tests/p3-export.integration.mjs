import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'
import test from 'node:test'

// Requires the routes of p3-export mounted as described in docs/plane-demo-porting/handoff/p3-export.md:
// workspaceExportsRoutes at /workspaces/:slug and importsRoutes at /workspaces/:slug/projects/:projectId,
// the import_jobs migration, and the local R2 bucket ASSET_BUCKET. Without JOBS_QUEUE the jobs run in the same Worker.
const base = new URL(process.env.LANCITY_TEST_URL ?? 'http://localhost:4198')
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Use an isolated local Worker')
const runId = randomUUID().replaceAll('-', '').slice(0, 12)

function request(path, { cookie, method = 'GET', body, ip } = {}) {
  const headers = new Headers()
  if (cookie) headers.set('cookie', cookie)
  if (ip) headers.set('cf-connecting-ip', ip)
  if (method !== 'GET') headers.set('origin', base.origin)
  const raw = body instanceof FormData
  if (body !== undefined && !raw) headers.set('content-type', 'application/json')
  return fetch(new URL(path, base), {
    method,
    headers,
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    redirect: 'manual'
  })
}
async function responseJson(response, status) {
  assert.equal(response.status, status, `${response.url}: ${await response.clone().text()}`)
  return response.json()
}
async function signUp(suffix, ip) {
  const username = `exp${runId}${suffix}`
  const response = await request('/api/auth/sign-up/email', {
    method: 'POST',
    ip,
    body: { name: `Export ${suffix}`, username, email: `${username}@example.com`, password: 'isolated-test-password' }
  })
  const { user } = await responseJson(response, 200)
  return {
    id: Number(user.id),
    cookie: response.headers
      .getSetCookie()
      .map(value => value.split(';', 1)[0])
      .join('; ')
  }
}

/** Read the entries of a ZIP archive with the central directory (deflate or stored). */
function unzip(bytes) {
  const buffer = Buffer.from(bytes)
  let end = buffer.length - 22
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--
  assert.ok(end >= 0, 'not a ZIP archive')
  const entries = new Map()
  let pos = buffer.readUInt32LE(end + 16)
  for (let i = 0; i < buffer.readUInt16LE(end + 10); i++) {
    const method = buffer.readUInt16LE(pos + 10)
    const size = buffer.readUInt32LE(pos + 20)
    const nameLength = buffer.readUInt16LE(pos + 28)
    const extraLength = buffer.readUInt16LE(pos + 30)
    const commentLength = buffer.readUInt16LE(pos + 32)
    const offset = buffer.readUInt32LE(pos + 42)
    const name = buffer.toString('utf8', pos + 46, pos + 46 + nameLength)
    const start = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28)
    const data = buffer.subarray(start, start + size)
    entries.set(name, method === 8 ? inflateRawSync(data) : data)
    pos += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

async function waitFor(check, label) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const value = await check()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  assert.fail(`Timed out waiting for ${label}`)
}

test('export: CSV, JSON and XLSX files in a ZIP, injection guard, owner only download, expiry', async () => {
  const owner = await signUp('owner', '198.18.230.1')
  const other = await signUp('other', '198.18.230.2')
  const slug = `export-${runId}`
  await responseJson(await request('/api/v1/workspaces', { ...owner, method: 'POST', body: { name: 'Export', slug } }), 201)
  const project = await responseJson(
    await request(`/api/v1/workspaces/${slug}/projects`, { ...owner, method: 'POST', body: { name: 'Export', identifier: 'EXP' } }),
    201
  )
  const issuesUrl = `/api/v1/workspaces/${slug}/projects/${project.id}/issues`
  for (const name of ['Plain issue', '=HYPERLINK("http://example.com")', '@SUM(1+1)']) {
    await responseJson(await request(issuesUrl, { ...owner, method: 'POST', body: { name } }), 201)
  }
  const exportsUrl = `/api/v1/workspaces/${slug}/export-issues`

  // Validation and permissions.
  assert.equal((await request(exportsUrl, { ...owner, method: 'POST', body: { provider: 'pdf' } })).status, 400)
  assert.equal((await request(exportsUrl, { ...owner, method: 'POST', body: {} })).status, 400)
  assert.equal((await request(exportsUrl, { ...other, method: 'POST', body: { provider: 'csv' } })).status, 403)
  assert.equal((await request(exportsUrl, owner)).status, 400, 'per_page and cursor are required')

  const results = {}
  for (const provider of ['csv', 'json', 'xlsx']) {
    const started = await responseJson(await request(exportsUrl, { ...owner, method: 'POST', body: { provider } }), 200)
    assert.match(started.message, /ready/)
    const done = await waitFor(async () => {
      const list = await responseJson(await request(`${exportsUrl}?per_page=50&cursor=50:0:0`, owner), 200)
      const row = list.results.find(item => item.id === started.id)
      return row && ['completed', 'failed'].includes(row.status) ? row : null
    }, `${provider} export`)
    assert.equal(done.status, 'completed', JSON.stringify(done))
    assert.equal(done.initiated_by, owner.id)
    assert.ok(done.url.endsWith(`/export-issues/${started.id}/download`))

    assert.equal((await request(done.url, other)).status, 403)
    assert.equal((await request(done.url)).status, 401)
    const download = await request(done.url, owner)
    assert.equal(download.status, 200)
    assert.equal(download.headers.get('x-content-type-options'), 'nosniff')
    const files = unzip(new Uint8Array(await download.arrayBuffer()))
    assert.equal(files.size, 1)
    results[provider] = [...files.entries()][0]
  }

  const [csvName, csv] = results.csv
  assert.match(csvName, /\.csv$/)
  const csvText = csv.toString('utf8')
  assert.match(csvText, /Plain issue/)
  assert.ok(csvText.includes(`'=HYPERLINK`), 'formula prefixes are neutralised')
  assert.ok(csvText.includes(`'@SUM`), 'formula prefixes are neutralised')
  assert.ok(!/(^|,)"?=HYPERLINK/m.test(csvText))

  const jsonRows = JSON.parse(results.json[1].toString('utf8'))
  assert.equal(jsonRows.length, 3)
  assert.ok(jsonRows.some(row => row.identifier?.startsWith('EXP-')))

  const [xlsxName, xlsx] = results.xlsx
  assert.match(xlsxName, /\.xlsx$/)
  const sheet = unzip(xlsx).get('xl/worksheets/sheet1.xml').toString('utf8')
  assert.match(sheet, /Plain issue/)
  assert.ok(sheet.includes(`&apos;`) || sheet.includes(`'=HYPERLINK`), 'XLSX cells are guarded too')
})

test('import: CSV rows become issues, bad rows are reported, formats and permissions are checked', async () => {
  const owner = await signUp('importer', '198.18.230.3')
  const guest = await signUp('guest', '198.18.230.4')
  const slug = `import-${runId}`
  await responseJson(await request('/api/v1/workspaces', { ...owner, method: 'POST', body: { name: 'Import', slug } }), 201)
  const project = await responseJson(
    await request(`/api/v1/workspaces/${slug}/projects`, { ...owner, method: 'POST', body: { name: 'Import', identifier: 'IMP' } }),
    201
  )
  const importUrl = `/api/v1/workspaces/${slug}/projects/${project.id}/import-issues`
  const upload = (name, content, user = owner, source) => {
    const form = new FormData()
    form.set('file', new File([content], name, { type: 'text/plain' }))
    if (source) form.set('source', source)
    return request(importUrl, { ...user, method: 'POST', body: form })
  }

  assert.equal((await upload('rows.txt', 'name\nx')).status, 400)
  assert.equal((await upload('rows.csv', 'name\n')).status, 400)
  assert.equal((await upload('rows.json', '{"not":"a list"}')).status, 400)
  assert.equal((await upload('rows.csv', 'name\nx', guest)).status, 404)
  assert.equal((await upload('rows.csv', 'name\nx', owner, 'jira')).status, 400)

  const csv = [
    'Name,Priority,Start Date,Target Date,Description',
    'Imported one,high,2026-01-05,2026-01-20,"First line',
    'second line"',
    '=2+2,low,"Mon, 02 Feb 2026",,',
    ',none,,,',
    'Bad priority,huge,,,',
    'Dates reversed,none,2026-03-10,2026-03-01,'
  ].join('\r\n')
  const started = await responseJson(await upload('rows.csv', csv, owner, 'plane'), 202)
  assert.equal(started.total_rows, 5)
  const done = await waitFor(async () => {
    const row = await responseJson(await request(`${importUrl}/${started.id}`, owner), 200)
    return ['completed', 'failed'].includes(row.status) ? row : null
  }, 'import')
  assert.equal(done.status, 'completed', JSON.stringify(done))
  assert.equal(done.created_count, 2)
  assert.equal(done.failed_count, 3)
  assert.equal(done.processed_rows, 5)
  assert.ok(done.errors.some(item => item.row === 3 && item.level === 'error'))
  assert.ok(done.errors.some(item => /Priority/.test(item.message)))

  const list = await responseJson(await request(`/api/v1/workspaces/${slug}/projects/${project.id}/issues`, owner), 200)
  const names = (Array.isArray(list) ? list : list.results).map(issue => issue.name)
  assert.ok(names.includes('Imported one'))
  assert.ok(names.includes('=2+2'), 'import keeps the text; the export guard handles formulas')
  assert.equal((await request(`${importUrl}/${started.id}`, guest)).status, 404)
  const page = await responseJson(await request(`${importUrl}?per_page=10&cursor=10:0:0`, owner), 200)
  assert.equal(page.results[0].id, started.id)
  assert.equal(page.results[0].errors, undefined, 'the list leaves the error report out')
})
