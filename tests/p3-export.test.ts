import assert from 'node:assert/strict'
import test from 'node:test'
import { defineExportSchema, formatDate, formatDateTime, listField, numberField, serializeRows, stringField } from '../src/server/export/base'
import { DataExporter } from '../src/server/export/exporter'
import { CsvFormatter, CsvSchemaFormatter, JsonFormatter, XlsxFormatter, parseCsv, prettifyHeader, writeCsv } from '../src/server/export/formatters'
import { isLinkExpired, linkExpiresAt } from '../src/server/export/model-rules'
import { decodeXlsx, encodeXlsx } from '../src/server/export/xlsx'
import { createZipFile, readZip } from '../src/server/export/zip'
import { decodeImportFile, importFormatOf, listCell, mapImportRow, parseImportDate } from '../src/server/import/mapping'

test('dates follow the Python strftime formats', () => {
  assert.equal(formatDate('2026-02-02'), 'Mon, 02 Feb 2026')
  assert.equal(formatDateTime(new Date('2026-02-02T15:04:05Z')), 'Mon, 02 Feb 2026 03:04:05 UTC+0000')
  assert.equal(formatDate(null), '')
})

test('csv writer quotes like Python csv and the parser reads it back', () => {
  const text = writeCsv([['a', 'b,c', 'say "hi"', 'two\nlines', null, true]])
  assert.equal(text, 'a,"b,c","say ""hi""","two\nlines",,True\r\n')
  assert.deepEqual(parseCsv(text), [['a', 'b,c', 'say "hi"', 'two\nlines', '', 'True']])
  assert.equal(writeCsv([['x']], { quoteAll: true }), '"x"\r\n')
  assert.deepEqual(parseCsv('\uFEFFname\r\n\r\nx\r\n'), [['name'], ['x']])
})

test('porter CSV flattens, prettifies, guards formulas and decodes', async () => {
  const csv = new CsvFormatter()
  const text = await csv.encode([{ created_by_name: '=cmd', labels: ['a', 'b'], parent: { id: 1 } }])
  const [header, row] = text.trim().split('\r\n')
  assert.equal(header, 'Created By Name,Labels,Parent  Id')
  assert.ok(row.startsWith("'=cmd,"))
  assert.equal(prettifyHeader('sub_issues_count'), 'Sub Issues Count')
  const decoded = await csv.decode('Display Name,Parent__id,Tags\r\nAda,5,"[""x"", ""y""]"\r\n')
  assert.deepEqual(decoded, [{ display_name: 'Ada', parent: { id: '5' }, tags: ['x', 'y'] }])
  assert.equal(await csv.encode([]), '')
})

test('zip and xlsx round trip', async () => {
  const zip = await createZipFile([
    { name: 'a.txt', data: 'hello hello hello' },
    { name: 'empty.txt', data: '' }
  ])
  const entries = await readZip(zip)
  assert.equal(new TextDecoder().decode(entries.get('a.txt')), 'hello hello hello')
  assert.equal(entries.get('empty.txt')?.length, 0)

  const sheet = await encodeXlsx([['Name', 'Count'], ['<b>&"x"</b>', 3], [null, true]])
  assert.deepEqual(await decodeXlsx(sheet), [['Name', 'Count'], ['<b>&"x"</b>', 3], [null, true]])
  const formatter = new XlsxFormatter()
  assert.deepEqual(await formatter.decode(await formatter.encode([{ name: '=1+1', labels: ['a', 'b'] }])), [
    { name: "'=1+1", labels: 'a, b' }
  ])
})

test('data exporter builds a named file', async () => {
  const exporter = new DataExporter<{ n: number }>(rows => rows.map(row => ({ n: row.n })), 'json')
  const [name, content] = await exporter.export('out', [{ n: 1 }])
  assert.equal(name, 'out.json')
  assert.deepEqual(JSON.parse(content as string), [{ n: 1 }])
  assert.throws(() => new DataExporter(() => [], 'pdf'), /Unsupported format/)
  assert.deepEqual(await new JsonFormatter().decode('[{"a":1}]'), [{ a: 1 }])
})

test('export schema serializes rows and the schema formatter labels columns', async () => {
  const schema = defineExportSchema<{ id: number; tags: string[]; owner: { name: string } | null }>({
    fields: {
      id: numberField({ label: 'ID' }),
      owner_name: stringField({ source: 'owner.name', label: 'Owner' }),
      tags: listField({ label: 'Tags' })
    }
  })
  const records = await serializeRows(schema, [{ id: 1, tags: ['x', 'y'], owner: null }])
  assert.deepEqual(records, [{ id: 1, owner_name: '', tags: ['x', 'y'] }])
  const [name, content] = await new CsvSchemaFormatter().format('file', records, schema)
  assert.equal(name, 'file.csv')
  assert.equal(content, '"ID","Owner","Tags"\r\n"1","","x, y"\r\n')
})

test('download links last seven days', () => {
  const created = new Date('2026-01-01T00:00:00Z')
  assert.equal(linkExpiresAt(created).toISOString(), '2026-01-08T00:00:00.000Z')
  assert.equal(isLinkExpired(created, Date.parse('2026-01-07T23:59:59Z')), false)
  assert.equal(isLinkExpired(created, Date.parse('2026-01-08T00:00:00Z')), true)
})

test('import files decode and rows map to issues', async () => {
  assert.equal(importFormatOf('Rows.XLSX'), 'xlsx')
  assert.equal(importFormatOf('rows.txt'), null)
  assert.equal(parseImportDate('Mon, 02 Feb 2026'), '2026-02-02')
  assert.equal(parseImportDate('2026-02-30'), undefined)
  assert.equal(parseImportDate(46055), '2026-02-02')
  assert.deepEqual(listCell('a, b;c'), ['a', 'b', 'c'])
  const [record] = await decodeImportFile(
    'csv',
    new TextEncoder().encode('Name,State Name,Labels,Assignees,Parent\r\nFix,Todo,"bug, ui",Ada,IMP-4\r\n')
  )
  const lookups = {
    states: new Map([['todo', 7]]),
    labels: new Map([['bug', 3]]),
    members: new Map<string, number | null>([['ada', 9]]),
    projectIdentifier: 'IMP'
  }
  const mapped = mapImportRow(record, lookups, 'import:1', '1')
  assert.deepEqual(mapped.input, {
    name: 'Fix',
    priority: 'none',
    stateId: 7,
    labelIds: [3],
    assigneeIds: [9],
    externalSource: 'import:1',
    externalId: '1'
  })
  assert.equal(mapped.parentSequence, 4)
  assert.deepEqual(mapped.warnings, ['Label "ui" not found'])
  assert.equal(mapImportRow({ name: '' }, lookups, 's', '1').error, 'Name is required')
  assert.match(mapImportRow({ name: 'x', priority: 'huge' }, lookups, 's', '1').error ?? '', /Priority/)
})
