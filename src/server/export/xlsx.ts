import { createZipFile, readZip } from '@/server/export/zip'

/**
 * Minimal XLSX (OOXML) writer and reader replacing `openpyxl`. Strings are written as inline strings, so every
 * text cell stays text even when it starts with a formula character. Only the first worksheet is read.
 */

const decoder = new TextDecoder()
const MAX_CELL_CHARS = 32767
// Characters XML 1.0 cannot carry.
const invalidXml = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g

const escapeXml = (value: string) =>
  value.replace(invalidXml, '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch)

function unescapeXml(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1))
      return Number.isSafeInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[entity] ?? ''
  })
}

/** Column index (0 based) to letters: 0 is A, 26 is AA. */
export function columnName(index: number): string {
  let name = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name
  return name
}

function columnIndex(ref: string): number {
  let index = 0
  for (const ch of ref.replace(/[^A-Za-z]/g, '').toUpperCase()) index = index * 26 + ch.charCodeAt(0) - 64
  return index - 1
}

function cellXml(value: unknown, ref: string): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`
  if (typeof value === 'boolean') return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`
  const text = String(value).slice(0, MAX_CELL_CHARS)
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`
}

/** Encode rows (first row is usually the header) as an XLSX workbook with one sheet. */
export async function encodeXlsx(rows: readonly (readonly unknown[])[], sheetName = 'Sheet'): Promise<Uint8Array> {
  const sheetRows = rows
    .map((row, r) => `<row r="${r + 1}">${row.map((value, c) => cellXml(value, `${columnName(c)}${r + 1}`)).join('')}</row>`)
    .join('')
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  return createZipFile([
    {
      name: '[Content_Types].xml',
      data: `${xml}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`
    },
    {
      name: '_rels/.rels',
      data: `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
    },
    {
      name: 'xl/workbook.xml',
      data: `${xml}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      data: `${xml}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`
    }
  ])
}

const textOf = (xml: string) =>
  [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(match => unescapeXml(match[1])).join('')

/** Decode the first worksheet to rows. Shared and inline strings become strings, numbers stay numbers. */
export async function decodeXlsx(bytes: Uint8Array): Promise<unknown[][]> {
  const files = await readZip(bytes)
  const read = (name: string) => (files.has(name) ? decoder.decode(files.get(name)) : null)
  const workbook = read('xl/workbook.xml')
  let sheetPath = 'xl/worksheets/sheet1.xml'
  const relId = workbook?.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1]
  const rels = read('xl/_rels/workbook.xml.rels')
  if (relId && rels) {
    for (const tag of rels.match(/<Relationship\b[^>]*>/g) ?? []) {
      if (tag.includes(`Id="${relId}"`)) {
        const target = tag.match(/Target="([^"]+)"/)?.[1]
        if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target}`
      }
    }
  }
  const sheet = read(sheetPath)
  if (!sheet) throw new Error('The workbook has no worksheet')
  const shared = [...(read('xl/sharedStrings.xml') ?? '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(match => textOf(match[1]))
  const rows: unknown[][] = []
  for (const rowMatch of sheet.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row: unknown[] = []
    for (const cell of (rowMatch[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = cell[1].match(/\br="([A-Za-z]+\d+)"/)?.[1]
      const type = cell[1].match(/\bt="([^"]+)"/)?.[1]
      const body = cell[2] ?? ''
      const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1]
      let value: unknown = null
      if (type === 'inlineStr') value = textOf(body)
      else if (raw === undefined) value = null
      else if (type === 's') value = shared[Number(raw)] ?? ''
      else if (type === 'b') value = raw === '1'
      else if (type === 'str' || type === 'e') value = unescapeXml(raw)
      else value = Number.isFinite(Number(raw)) ? Number(raw) : unescapeXml(raw)
      const column = ref ? columnIndex(ref) : row.length
      while (row.length < column) row.push(null)
      row[column] = value
    }
    rows.push(row)
  }
  return rows
}
