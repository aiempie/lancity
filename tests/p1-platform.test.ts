import assert from 'node:assert/strict'
import test from 'node:test'
import { Hono } from 'hono'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { handleApiError } from '../src/server/api/v1/errors'
import { generateOperationSummary, getSampleForSchema, mergeSchemaOptions, userDocs } from '../src/server/api/v1/openapi'
import { corsSettings, cookiesSecure, redactedHeaders, safeDecodeBody } from '../src/server/api/v1/request-security'
import { requireContainerBody } from '../src/server/api/v1/validation'
import { issues } from '../src/db/schema/issue'
import { getAnalyticsDateRange, getChartPeriodRange } from '../src/server/common/date-utils'
import { ServiceError } from '../src/server/common/errors'
import {
  ComplexFilterBackend,
  LegacyToRichFiltersConverter,
  createIssueFilterSet,
  buildSearchCondition
} from '../src/server/common/filters'
import { getClientIp, isBlockedIp, parseIp, validateUrl } from '../src/server/common/ip-address'
import { ChangeTracker, auditFields } from '../src/server/common/mutations'
import { Cursor, OffsetPaginator, paginate, paginateGlobal, resolveGroupColumn } from '../src/server/common/pagination'
import { getSafeRedirectUrl, sanitizeFilename, urlHasAllowedHostAndScheme, validateNextPath } from '../src/server/common/path-validator'
import { parseRate } from '../src/server/common/rate-limit'
import { DynamicSerializer, expandRelations, pickFields, writableData } from '../src/server/common/serializers'
import { convertDateToUtc, formatInTimeZone } from '../src/server/common/timezone-converter'
import { containsUrl, normalizeUrlPath, urlparse } from '../src/server/common/url'
import { isEntityId, isValidUuid } from '../src/server/common/uuid'

const dialect = new SQLiteSyncDialect()
const render = (query: ReturnType<ComplexFilterBackend['evaluateNode']>) => dialect.sqlToQuery(query!)

function slice<T>(rows: T[]) {
  return {
    fetch: async (offset: number, limit: number) => rows.slice(offset, offset + limit),
    count: async () => rows.length
  }
}

test('cursor round trip and offset paginator page boundaries', async () => {
  assert.equal(String(Cursor.fromString('20:2:1')), '20:2:1')
  assert.throws(() => Cursor.fromString('20:2'), /Invalid cursor format/)
  const paginator = new OffsetPaginator({ ...slice([1, 2, 3, 4, 5]), orderBy: '-id' })
  const first = await paginator.getResult(2, new Cursor(2, 0))
  assert.deepEqual(first.results, [1, 2])
  assert.equal(first.next.hasResults, true)
  assert.equal(first.prev.hasResults, false)
  assert.equal(first.hits, 5)
  assert.equal(first.maxHits, 3)
  const last = await paginator.getResult(2, new Cursor(2, 2))
  assert.deepEqual(last.results, [5])
  assert.equal(last.next.hasResults, false)
  assert.equal(String(last.prev), '2:1:1')
})

test('paginate builds the Plane response body and rejects bad input', async () => {
  const paginator = new OffsetPaginator(slice(['a', 'b', 'c']))
  const body = await paginate(new URLSearchParams('per_page=2'), { paginator })
  assert.equal(body.next_cursor, '2:1:0')
  assert.equal(body.prev_cursor, '2:-1:1')
  assert.equal(body.next_page_results, true)
  assert.equal(body.count, 2)
  assert.equal(body.total_pages, 2)
  assert.deepEqual(body.results, ['a', 'b'])
  for (const query of ['per_page=abc', 'per_page=0', 'per_page=1001', 'cursor=bad', 'cursor=20:-1:0', 'cursor=2000:0:0']) {
    await assert.rejects(paginate(new URLSearchParams(query), { paginator }), (error: ServiceError) => error.status === 400)
  }
  assert.throws(() => resolveGroupColumn('name; drop table issues'), (error: ServiceError) => error.status === 400)
  assert.equal(resolveGroupColumn('labels__id'), 'label_id')
})

test('global paginator slices by page', async () => {
  const rows = Array.from({ length: 5 }, (_, i) => i)
  const source = { count: async () => rows.length, fetchRange: async (start: number, end: number) => rows.slice(start, end) }
  const page = await paginateGlobal(source, '2:1:0')
  assert.deepEqual(page.results, [2, 3])
  assert.equal(page.next_cursor, '2:2:0')
  assert.equal(page.total_pages, 3)
  assert.equal((await paginateGlobal(source, '2:2:0')).next_cursor, null)
})

test('legacy filters convert to rich filters', () => {
  const converter = new LegacyToRichFiltersConverter()
  assert.deepEqual(converter.convert({ priority: ['high', 'bogus'], state: [1, 2] }), {
    and: [{ priority__in: 'high' }, { state_id__in: '1,2' }]
  })
  assert.deepEqual(converter.convert({ start_date: ['2026-01-01;after', '2026-02-01;before'] }), {
    start_date__range: '2026-01-01,2026-02-01'
  })
  assert.deepEqual(converter.convert({ target_date: ['2_weeks;after;fromnow'] }), {})
  assert.throws(() => converter.convert({ nope: 1 }, true), /Unsupported filter key/)
})

test('complex filters validate structure and compile to SQL', () => {
  const backend = new ComplexFilterBackend(createIssueFilterSet(), { maxDepth: 3 })
  const sql = render(backend.applyJsonFilter({ and: [{ priority__in: 'high,urgent' }, { not: { assignee_id: 7 } }] }))
  assert.match(sql.sql, /"issues"\."priority" in/)
  assert.match(sql.sql, /issue_assignees/)
  assert.match(sql.sql, /deleted_at/)
  assert.match(sql.sql, /json_each/)
  assert.deepEqual(JSON.parse(sql.params[0] as string), ['high', 'urgent'])
  assert.equal(sql.params[1], 7)
  assert.ok(backend.applyJsonFilter({ OR: [{ is_draft: true }] }), 'operators are case-insensitive')
  const code = (filter: unknown) => {
    try {
      backend.applyJsonFilter(filter)
    } catch (error) {
      return (error as ServiceError).code
    }
  }
  assert.equal(code({ secret_field: 1 }), 'INVALID_FILTER_FIELD')
  assert.equal(code({ and: [{ or: [{ and: [{ priority: 'low' }] }] }] }), 'MAX_DEPTH_EXCEEDED')
  assert.equal(code({ and: [{ priority: 'low' }], priority: 'low' }), 'MIXED_OPERATOR_AND_FIELDS')
  assert.equal(code({ priority__in: [] }), 'EMPTY_LIST_VALUE')
  assert.equal(code({ priority: { nested: 1 } }), 'INVALID_VALUE_TYPE')
  assert.equal(code({ state_id: 'abc' }), 'INVALID_FILTERSET')
  assert.equal(code({ priority: 'nope' }), 'INVALID_FILTERSET')
  assert.throws(() => backend.normalizeFilterData('{', 'filter'), (error: ServiceError) => error.code === 'INVALID_JSON')
  assert.equal(backend.filterQueryset(new URLSearchParams(''), {}), undefined)
  const range = render(backend.applyJsonFilter({ created_at__range: '2026-03-01,2026-03-02' }, { timezone: 'Asia/Ho_Chi_Minh' }))
  assert.equal(range.params.length, 2)
})

test('search condition ANDs terms and ORs columns', () => {
  assert.equal(buildSearchCondition([], 'x'), undefined)
  assert.equal(buildSearchCondition([issues.name], '  ,'), undefined)
  const query = render(buildSearchCondition([issues.name, issues.descriptionStripped], 'ab, c_d')!)
  assert.equal(query.sql.match(/ glob /g)?.length, 4)
  assert.deepEqual(query.params, ['*[aA][bB]*', '*[aA][bB]*', '*[cC]_[dD]*', '*[cC]_[dD]*'])
})

test('SSRF address checks fail closed', async () => {
  for (const blocked of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.0.1', '0.0.0.0', '::1', 'fe80::1', '::ffff:169.254.169.254', '64:ff9b::7f00:1', '2002:7f00:1::', 'garbage']) {
    assert.equal(isBlockedIp(blocked), true, blocked)
  }
  for (const open of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.equal(isBlockedIp(open), false, open)
  assert.deepEqual(parseIp('::')?.bytes.length, 16)
  assert.equal(parseIp('01.2.3.4'), null)
  await assert.rejects(validateUrl('ftp://example.com'), /scheme/)
  await assert.rejects(validateUrl('https://rebind.example', { resolver: async () => ['93.184.216.34', '10.0.0.5'] }), /private\/internal/)
  await validateUrl('https://ok.example', { resolver: async () => ['93.184.216.34'] })
  await validateUrl('http://internal.svc', { allowedHosts: ['Internal.SVC'] })
})

test('client IP prefers the Cloudflare header', () => {
  assert.equal(getClientIp(new Headers({ 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' })), '1.2.3.4')
  assert.equal(getClientIp(new Headers({ 'x-forwarded-for': '9.9.9.9, 8.8.8.8' })), '9.9.9.9')
  assert.equal(getClientIp(new Headers()), null)
})

test('redirect and filename sanitizers', () => {
  assert.equal(validateNextPath('/workspaces/a?x=1'), '/workspaces/a?x=1')
  for (const bad of ['//evil.com', '/\t/\t/evil.com', 'https://evil.com', '/a/../b', '/x?u=javascript:alert(1)', '/%252e%252e/etc', 'relative']) {
    assert.equal(validateNextPath(bad), '', bad)
  }
  assert.equal(sanitizeFilename('../../etc/passwd'), 'passwd')
  assert.equal(sanitizeFilename('..\\win\\.env'), 'env')
  assert.equal(sanitizeFilename('  .. '), null)
  assert.equal(urlHasAllowedHostAndScheme('//evil.com/x', ['app.test']), false)
  assert.equal(urlHasAllowedHostAndScheme('https://app.test/x', ['app.test']), true)
  assert.equal(urlHasAllowedHostAndScheme('/local', ['app.test']), true)
  const env = { APP_BASE_URL: 'https://app.test' }
  assert.equal(getSafeRedirectUrl(env, 'https://app.test', '/a', { error: 'x y' }), 'https://app.test/?next_path=%2Fa&error=x+y')
  assert.equal(getSafeRedirectUrl(env, 'https://evil.test', '/a'), 'https://evil.test')
})

test('url helpers', () => {
  assert.deepEqual(
    (({ scheme, netloc, path, query, fragment, hostname, port }) => ({ scheme, netloc, path, query, fragment, hostname, port }))(urlparse('https://u:p@Example.com:8443/a/b?x=1#f')),
    { scheme: 'https', netloc: 'u:p@Example.com:8443', path: '/a/b', query: 'x=1', fragment: 'f', hostname: 'example.com', port: 8443 }
  )
  assert.equal(normalizeUrlPath('https://example.com//foo///bar//baz?x=1#frag'), 'https://example.com/foo/bar/baz?x=1#frag')
  assert.equal(containsUrl('see www.example.com now'), true)
  assert.equal(containsUrl('plain words only'), false)
  assert.equal(containsUrl('a'.repeat(1001) + ' http://x.io'), false)
})

test('uuid and id checks', () => {
  assert.equal(isValidUuid('3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e'), true)
  assert.equal(isValidUuid('3f2b8c1e-4d5a-1b6c-8d7e-9f0a1b2c3d4e'), false)
  assert.equal(isEntityId('12'), true)
  assert.equal(isEntityId('012'), false)
  assert.equal(isEntityId(0), false)
})

test('project timezone date conversion', () => {
  const zone = 'Asia/Ho_Chi_Minh'
  assert.equal(convertDateToUtc('2026-03-10', zone, false).toISOString(), '2026-03-10T16:59:00.000Z')
  const farNow = new Date('2026-01-01T00:00:00Z')
  assert.equal(convertDateToUtc('2026-03-10', zone, true, farNow).toISOString(), '2026-03-09T17:00:01.000Z')
  const sameDay = new Date('2026-03-10T03:00:00Z')
  assert.equal(convertDateToUtc('2026-03-10', zone, true, sameDay).getTime(), sameDay.getTime())
  assert.equal(formatInTimeZone(new Date('2026-03-10T03:00:00Z'), zone), '2026-03-10T10:00:00+07:00')
  assert.equal(formatInTimeZone(new Date('2026-01-15T12:00:00Z'), 'America/New_York'), '2026-01-15T07:00:00-05:00')
  assert.throws(() => convertDateToUtc('10/03/2026', zone), /does not match/)
})

test('analytics date ranges', () => {
  const now = new Date('2026-05-20T10:00:00Z')
  const range = getAnalyticsDateRange('last_7_days', null, null, now)!
  assert.equal(range.current.gte.toISOString(), '2026-05-13T00:00:00.000Z')
  assert.equal(range.current.lte.toISOString(), '2026-05-20T23:59:59.999Z')
  assert.equal(range.previous!.gte.toISOString(), '2026-05-06T00:00:00.000Z')
  assert.equal(getAnalyticsDateRange('custom', '2026-02-30', '2026-03-01', now), null)
  assert.equal(getAnalyticsDateRange('nope', null, null, now), null)
  assert.deepEqual(getChartPeriodRange('yesterday', now)!.map(d => d.toISOString().slice(0, 10)), ['2026-05-19', '2026-05-19'])
})

test('rate spec, cors and cookie settings', () => {
  assert.deepEqual(parseRate('60/minute'), { limit: 60, windowSeconds: 60 })
  assert.deepEqual(parseRate('5/s'), { limit: 5, windowSeconds: 1 })
  assert.throws(() => parseRate('lots'))
  assert.deepEqual(corsSettings([], ['https://App.test/x', undefined, 'bad']), {
    allowedOrigins: ['https://app.test'],
    allowAllOrigins: false,
    allowCredentials: true
  })
  assert.deepEqual(corsSettings([], []), { allowedOrigins: [], allowAllOrigins: true, allowCredentials: false })
  assert.equal(cookiesSecure('https://a.test'), true)
  assert.equal(cookiesSecure('http://a.test', ['https://b.test']), true)
  assert.equal(cookiesSecure('http://a.test', ['http://b.test']), false)
})

test('serializers shape fields, expansions and writable data', async () => {
  assert.deepEqual(pickFields({ a: 1, b: 2, c: 3 }, ['a', { c: ['x'] }]), { a: 1, c: 3 })
  assert.deepEqual(writableData({ a: 1, id: 5 }, ['id']), { a: 1 })
  const mapper = new Map([['state', async (row: unknown) => ({ name: (row as { name: string }).name })]])
  const out = await expandRelations({ id: 1 }, { state: { name: 'Todo' }, stateId: 3, createdById: 9 }, ['state', 'created_by'], mapper)
  assert.deepEqual(out, { id: 1, state: { name: 'Todo' }, created_by: 9 })
  const serializer = new DynamicSerializer({ serialize: row => ({ id: row.id, name: row.name, secret: 1 }), fields: ['name'], expand: ['state'], mapper })
  assert.deepEqual(await serializer.toRepresentation({ id: 1, name: 'n', state: { name: 'Done' } }), { name: 'n', state: { name: 'Done' } })
  assert.deepEqual(serializer.readableFields(['id', 'name', 'state']), ['name', 'state'])
})

test('change tracker reports edits relative to the last save', () => {
  const row = { name: 'a', tags: ['x'], stateId: 1 }
  const tracker = new ChangeTracker(row, ['name', 'tags'])
  assert.equal(tracker.hasChanged(row, 'stateId'), false)
  row.name = 'b'
  row.tags.push('y')
  assert.deepEqual(tracker.changedFields(row), ['name', 'tags'])
  assert.deepEqual(tracker.oldValues, { name: 'a', tags: ['x'] })
  assert.deepEqual(tracker.commit(row), ['name', 'tags'])
  assert.deepEqual(tracker.changedFields(row), [])
  assert.deepEqual(auditFields({ userId: 4 }, 'insert'), { createdById: 4, updatedById: 4 })
  assert.deepEqual(auditFields({ userId: 4 }, 'update'), { updatedById: 4 })
})

test('API token log helpers hide credentials and binary content', () => {
  const headers = new Headers({ 'x-api-key': 'secret', cookie: 'a=b', accept: 'json' })
  const text = redactedHeaders(headers)
  assert.doesNotMatch(text, /secret|a=b/)
  assert.match(text, /"accept":"json"/)
  assert.equal(safeDecodeBody(new Uint8Array()), null)
  assert.equal(safeDecodeBody(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1])), '[Binary Content]')
  assert.equal(safeDecodeBody(new Uint8Array([0xc3, 0x28])), '[Could not decode content]')
  assert.match(safeDecodeBody(new TextEncoder().encode('x'.repeat(10 * 1024 + 5)))!, /\.\.\. \[truncated\]$/)
})

test('OpenAPI helpers merge options and summarise operations', () => {
  const operation = userDocs({ summary: 'Me', responses: { 404: { description: 'gone' } }, parameters: [] })
  assert.deepEqual(operation.tags, ['Users'])
  assert.equal(operation.responses?.[404]?.description, 'gone')
  assert.ok(operation.responses?.[401])
  assert.equal(mergeSchemaOptions({ summary: 'a' }, { summary: 'b' }).summary, 'b')
  assert.equal(generateOperationSummary('GET', '/api/v1/workspaces/{slug}/issues/', 'Work Items'), 'Retrieve Issues')
  assert.equal(generateOperationSummary('POST', '/x/archive/', 'Cycles'), 'Archive Cycle')
  assert.equal(generateOperationSummary('POST', '/x/transfer-issues/', 'Cycles'), 'Transfer Cycle')
  assert.deepEqual(getSampleForSchema('PaginatedUnknownResponse'), getSampleForSchema('Whatever'))
})

test('API errors and body checks', async () => {
  const app = new Hono()
  app.onError(handleApiError)
  app.use('*', requireContainerBody)
  app.post('/echo', async c => c.json(await c.req.json()))
  app.get('/unique', () => {
    throw new Error('D1_ERROR: UNIQUE constraint failed: projects.name')
  })
  const post = (body: string) => app.request('/echo', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
  assert.equal((await post('{"a":1}')).status, 200)
  assert.equal((await post('[1]')).status, 200)
  for (const scalar of ['5', 'null', '"x"']) {
    const response = await post(scalar)
    assert.equal(response.status, 400)
    assert.equal(((await response.json()) as { error: { code: string } }).error.code, 'PARSE_ERROR')
  }
  const original = console.warn
  console.warn = () => {}
  try {
    const unique = await app.request('/unique')
    assert.equal(unique.status, 400)
    assert.deepEqual(await unique.json(), { error: { code: 'INTEGRITY_ERROR', message: 'The payload is not valid' } })
  } finally {
    console.warn = original
  }
})
