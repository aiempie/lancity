/**
 * Extracts the PD status of every handoff in docs/plane-demo-porting/handoff/*.md
 * into scripts/checklist/status.json.
 *
 * Usage: pnpm exec tsx scripts/checklist/extract-handoffs.ts
 *
 * Only the section "(a)" of each handoff is read. Tables are parsed by their first
 * cell (PD list). A few irregular spots (prose bullets, caveats, overrides) are
 * declared in the CONFIG below so the output stays reproducible.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'

export type PdStatus = 'done' | 'out' | 'open' | 'partial' | 'defer'

export interface PdEntry {
  status: PdStatus
  source: string
  kind: string
  note: string
  code: string[]
  tests: string[]
  alsoClaimedBy: string[]
}

const ROOT = join(import.meta.dirname, '..', '..')
const HANDOFF_DIR = join(ROOT, 'docs', 'plane-demo-porting', 'handoff')
const OUTPUT = join(import.meta.dirname, 'status.json')
const MAX_PD = 2348
const ROUTES_DIR = 'src/server/api/v1/routes'

const RANK: Record<PdStatus, number> = { done: 5, out: 4, open: 3, partial: 2, defer: 1 }

interface BulletSection {
  start: RegExp
  end?: RegExp
  mode: PdStatus | 'auto'
}

interface HandoffConfig {
  codeDirs: string[]
  /** Index of the table column that holds the code file name (without extension) */
  codeColumn?: number
  /** Stop parsing at the first line that matches */
  stopAt?: RegExp
  /** Mode for tables found under a heading about blank PDs */
  blankTableMode?: PdStatus
  /** Used when a ticked row names no code file */
  defaultCode?: string[]
  bullets?: BulletSection[]
}

const CONFIG: Record<string, HandoffConfig> = {
  'issue-type': { codeDirs: ['src/server/issue-type'] },
  'p0-infra': { codeDirs: ['src/server/common'] },
  'p1-auth': {
    codeDirs: ['src/server/identity', 'src/lib/auth', ROUTES_DIR],
    stopAt: /^### API token/,
    bullets: [{ start: /^### Để trống/, end: /^### API token/, mode: 'open' }]
  },
  'p1-issue-background': { codeDirs: ['src/server/issue/jobs', 'src/server/issue'] },
  'p1-issue-collab': {
    codeDirs: ['src/server/issue', ROUTES_DIR],
    bullets: [{ start: /^PD để trống:/, mode: 'auto' }]
  },
  'p1-issue-core': {
    codeDirs: ['src/server/issue', ROUTES_DIR],
    stopAt: /^## PD để trống hoặc thuộc nhóm khác/
  },
  'p1-platform': { codeDirs: ['src/server/common', 'src/server/api/v1'] },
  'p1-project': {
    codeDirs: ['src/server/project', ROUTES_DIR],
    bullets: [{ start: /^\*\*`apps\/api\/plane\/api\/views\/member\.py`\*\*/, end: /^\*\*PD không port hết/, mode: 'done' }]
  },
  'p1-workspace': { codeDirs: ['src/server/workspace', ROUTES_DIR] },
  'p2-asset': { codeDirs: ['src/server/asset', ROUTES_DIR] },
  'p2-cycle': { codeDirs: ['src/server/cycle', ROUTES_DIR] },
  'p2-estimate': { codeDirs: ['src/server/estimate', ROUTES_DIR] },
  'p2-intake-draft': {
    codeDirs: ['src/server/intake', 'src/server/draft', ROUTES_DIR],
    defaultCode: ['src/server/intake/service.ts', 'src/server/draft/service.ts', 'src/server/api/v1/routes/intakes.ts']
  },
  'p2-module': {
    codeDirs: ['src/server/module', ROUTES_DIR],
    bullets: [{ start: /^PD để trống \(ngoài phạm vi\):/, mode: 'out' }]
  },
  'p2-notification': {
    codeDirs: ['src/server/notification', 'src/server/sticky', ROUTES_DIR],
    defaultCode: ['src/server/notification/service.ts', 'src/server/sticky/service.ts', 'src/server/api/v1/routes/notifications.ts']
  },
  'p2-page': { codeDirs: ['src/server/page', ROUTES_DIR], blankTableMode: 'defer' },
  'p3-analytics': { codeDirs: ['src/server/analytics', ROUTES_DIR] },
  'p3-export': {
    codeDirs: ['src/server/export', 'src/server/import', ROUTES_DIR],
    bullets: [{ start: /^## PD để trống hoặc ngoài phạm vi/, mode: 'auto' }]
  },
  'p3-instance': { codeDirs: ['src/server/instance', ROUTES_DIR] },
  'p3-integrations': { codeDirs: ['src/server/integration', 'src/server/webhook', 'src/server/webhook/jobs', ROUTES_DIR] },
  'p3-public': { codeDirs: ['src/server/public', ROUTES_DIR] },
  'p3-view-search': { codeDirs: ['src/server/view', 'src/server/search', ROUTES_DIR] },
  'p4-live': { codeDirs: ['src/server/collaboration', 'src/server/live', ROUTES_DIR] },
  'p4-maintenance': { codeDirs: ['src/server/maintenance', 'scripts/maintenance'] },
  'p4-migrations': { codeDirs: ['scripts/plane-import'], codeColumn: 2 },
  'p4-pdf': { codeDirs: ['src/server/pdf', ROUTES_DIR] }
}

interface ManualEntry {
  source: string
  pds: string[]
  status: PdStatus
  kind?: string
  note?: string
  code?: string[]
}

/** Irregular spots (prose, not tables) that the handoffs state explicitly. */
const MANUAL: ManualEntry[] = [
  {
    source: 'p0-infra',
    pds: ['1248', '1249', '1250'],
    status: 'done',
    kind: 'Port',
    code: ['src/server/common/env.ts']
  },
  {
    source: 'p1-auth',
    pds: range(1056, 1073),
    status: 'done',
    kind: 'Gộp',
    note: 'Endpoint spaces gộp vào cùng endpoint với app, dùng chung cookie và phiên Better Auth.',
    code: ['src/lib/auth/auth.ts', 'src/server/api/v1/routes/auth-extra.ts']
  },
  {
    source: 'p1-workspace',
    pds: ['0394'],
    status: 'done',
    kind: 'Có sẵn',
    note: 'Schema đã có ở nhóm sticky, không nhân đôi.',
    code: ['src/types/reporting/schema.ts']
  },
  {
    source: 'p3-public',
    pds: ['1646', '1680', '1681', '1682', '1687'],
    status: 'done',
    kind: 'Có sẵn',
    note: 'Đã xong từ trước, chỉ export thêm `visibleBoard` và `resourceOnBoard`.',
    code: ['src/server/public/service.ts']
  },
  {
    source: 'p4-maintenance',
    pds: ['1198', '1199'],
    status: 'done',
    kind: 'Port',
    code: ['src/server/maintenance/logger.ts']
  }
]

/** Forced status after merging (documented decisions of a handoff). */
const OVERRIDES: ManualEntry[] = [
  {
    source: 'p1-auth',
    pds: ['0968'],
    status: 'done',
    kind: 'Port',
    note: 'Cờ `ENABLE_{GOOGLE,GITHUB,GITLAB}_SYNC` bật `overrideUserInfoOnSignIn`.',
    code: ['src/lib/auth/providers.ts']
  }
]

/** Caveats appended to a ticked item (handoff says done, with a known limit). */
const CAVEATS: Record<string, string> = {
  '0020': '`fields`/`expand` mới có helper, chưa nối vào route (theo p1-issue-core).',
  '0030': '`fields`/`expand` mới có helper, chưa nối vào route (theo p1-issue-core).',
  '0031': '`fields`/`expand` mới có helper, chưa nối vào route (theo p1-issue-core).',
  '0334': '`fields`/`expand` mới có helper, chưa nối vào route (theo p1-issue-core).',
  '0338': '`fields`/`expand` mới có helper, chưa nối vào route (theo p1-issue-core).',
  '0587': 'Reaction và link nhúng trong chi tiết issue chưa được trả; dùng endpoint của nhóm cộng tác.',
  '1882': '`filter_logged_by` nhận tham số nhưng bỏ qua vì Lancity không có cột `logged_by`.',
  '0738': 'Chưa ghi lượt xem gần đây khi mở project; cần gọi hàm của nhóm workspace trong route.',
  '1318': 'Không nhập hash mật khẩu Django (không tương thích Better Auth); người dùng đặt lại mật khẩu.',
  '1330': 'Tên bảng favorite cũ chưa đối chiếu được vì repo Plane hiện tại đã bỏ model này.',
  '1336': 'Xung đột tài liệu: README ghi 10 → 15 nhưng migration gốc 0076 đổi 10 → 5. Hàm theo source (5).',
  '1338': 'Công cụ không sao chép byte S3 → R2, chỉ ghi `asset-copies.json`.',
  '1339': 'Công cụ không sao chép byte S3 → R2, chỉ ghi `asset-copies.json`.',
  '1350': 'Importer bỏ qua `api_tokens` mặc định; chỉ nhập khi có `--include-api-tokens` và ở trạng thái không hoạt động.'
}

function range(from: number, to: number): string[] {
  const out: string[] = []
  for (let n = from; n <= to; n += 1) out.push(String(n).padStart(4, '0'))
  return out
}

function cleanText(text: string): string {
  return text
    .replace(/\*\*/g, '')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
}

/** Expands "0814, 0815..0817, 1137 đến 1177" into zero-padded PD ids. */
export function parseTokens(text: string): string[] {
  const clean = cleanText(text)
  const re = /(?<!\d)(?:PD-)?(\d{4})(?!\d)(?:\s*(?:\.\.\.?|–|-|đến)\s*(?:PD-)?(\d{4})(?!\d))?/g
  const out: string[] = []
  for (const m of clean.matchAll(re)) {
    const from = Number(m[1])
    const to = m[2] ? Number(m[2]) : from
    if (to < from || to - from > 400) {
      out.push(m[1])
      if (m[2]) out.push(m[2])
      continue
    }
    for (let n = from; n <= to; n += 1) out.push(String(n).padStart(4, '0'))
  }
  return out.filter(id => Number(id) >= 1 && Number(id) <= MAX_PD)
}

/** Reads only PD-prefixed chains, ignoring numbers that appear in prose. */
function parseBulletTokens(line: string): string[] {
  const clean = cleanText(line.replace(/^- (\*\*)?(?=\d{4})/, '- PD-'))
  const chain = /PD-\d{4}(?:\s*(?:,|và|đến|\.\.|–|-)\s*(?:PD-)?\d{4})*/g
  const out: string[] = []
  for (const m of clean.matchAll(chain)) out.push(...parseTokens(m[0]))
  return out
}

function stripLinks(text: string): string {
  return text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim()
}

function truncate(text: string, max = 260): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

function fileIndex(): Map<string, string[]> {
  const index = new Map<string, string[]>()
  const walk = (dir: string) => {
    for (const name of readdirSync(join(ROOT, dir))) {
      const rel = `${dir}/${name}`
      const abs = join(ROOT, rel)
      if (statSync(abs).isDirectory()) walk(rel)
      else if (/\.(ts|tsx|mjs)$/.test(name)) {
        index.set(rel, [rel])
        index.set(name, [...(index.get(name) ?? []), rel])
      }
    }
  }
  for (const dir of ['src', 'scripts']) if (existsSync(join(ROOT, dir))) walk(dir)
  return index
}

const INDEX = fileIndex()

function resolveName(name: string, dirs: string[]): string | null {
  const direct = [name, `src/server/${name}`, `src/${name}`].find(candidate => INDEX.has(candidate) && candidate.includes('/'))
  if (name.includes('/') && direct) return direct
  const candidates = INDEX.get(basename(name)) ?? []
  const unique = [...new Set(candidates)]
  for (const dir of dirs) {
    const hit = unique.find(c => c === `${dir}/${basename(name)}`)
    if (hit) return hit
  }
  return unique.length === 1 ? unique[0] : null
}

function rowCode(cells: string[], config: HandoffConfig): string[] {
  const found: string[] = []
  const add = (path: string | null) => {
    if (path && !found.includes(path)) found.push(path)
  }
  const rest = cells.slice(1).join(' | ')
  for (const m of rest.matchAll(/\]\(((?:\.\.\/){3}[^)#\s]+)\)/g)) {
    const path = m[1].replace(/^(?:\.\.\/){3}/, '')
    if ((path.startsWith('src/') || path.startsWith('scripts/')) && existsSync(join(ROOT, path)) && statSync(join(ROOT, path)).isFile()) add(path)
  }
  if (found.length === 0 && config.codeColumn !== undefined && cells[config.codeColumn]) {
    for (const part of cells[config.codeColumn].split('/')) {
      const name = part.replace(/`/g, '').trim()
      if (name) add(resolveName(`${name}.ts`, config.codeDirs))
    }
  }
  if (found.length === 0) {
    for (const m of rest.matchAll(/`([\w./-]+\.(?:ts|tsx|mjs))`/g)) add(resolveName(m[1], config.codeDirs))
  }
  if (found.length === 0) {
    for (const m of rest.replace(/\]\([^)]*\)/g, ']').matchAll(/(?<![\w/.-])([\w-]+\.(?:ts|tsx|mjs))(?![\w])/g)) add(resolveName(m[1], config.codeDirs))
  }
  return found.slice(0, 4)
}

function linkCode(text: string): string[] {
  const found: string[] = []
  for (const m of text.matchAll(/\]\(((?:\.\.\/){3}[^)#\s]+)\)/g)) {
    const path = m[1].replace(/^(?:\.\.\/){3}/, '')
    const ok = path.startsWith('src/') || path.startsWith('scripts/')
    if (ok && existsSync(join(ROOT, path)) && statSync(join(ROOT, path)).isFile() && !found.includes(path)) found.push(path)
  }
  return found
}

function splitRow(line: string): string[] {
  return line
    .replace(/\\\|/g, '\u0001')
    .split('|')
    .slice(1, -1)
    .map(cell => cell.replace(/\u0001/g, '|').trim())
}

function detectKind(text: string): string {
  const m = stripLinks(text).match(/^(Port|Gộp|Thay thế|Tham chiếu|Đã có|Có sẵn|Đã xong[^.,:;]*)/i)
  return m ? m[1] : ''
}

function classifyRow(cells: string[]): { status: PdStatus; note: string } {
  const result = stripLinks(cells[1] ?? '')
  const head = stripLinks(cells[0])
  if (/^(Port |Thay thế )?một phần/i.test(result) || /một phần(?! tư)/i.test(head) || /^Thay thế một phần/i.test(result)) {
    return { status: 'partial', note: result || head }
  }
  if (/ngoài phạm vi|không áp dụng/i.test(result)) return { status: 'out', note: result }
  return { status: 'done', note: '' }
}

function classifyBullet(text: string, mode: PdStatus | 'auto'): { status: PdStatus; note: string } {
  const body = stripLinks(text.replace(/^- /, '')).replace(/\*\*/g, '')
  const colon = body.indexOf(': ')
  const note = colon >= 0 ? body.slice(colon + 2) : body
  if (mode !== 'auto') return { status: mode, note }
  if (/không cần port|ngoài phạm vi/i.test(note)) return { status: 'out', note }
  if (/thuộc/i.test(note)) return { status: 'defer', note }
  return { status: 'open', note }
}

interface Claim {
  pd: string
  entry: PdEntry
}

function testsFor(handoff: string): string[] {
  const dir = join(ROOT, 'tests')
  return readdirSync(dir)
    .filter(name => name.startsWith(`${handoff}.`))
    .map(name => `tests/${name}`)
}

function parseHandoff(file: string): Claim[] {
  const handoff = basename(file, '.md')
  const config = CONFIG[handoff]
  if (!config) return []
  const lines = readFileSync(file, 'utf8').split('\n')
  const start = lines.findIndex(line => /^## \(a\)/.test(line))
  if (start < 0) return []
  let end = lines.findIndex((line, i) => i > start && /^## \(b\)/.test(line))
  if (end < 0) end = lines.length
  const tests = testsFor(handoff)
  const claims: Claim[] = []
  let heading = ''
  let sectionCode: string[] = []
  let sectionOpen = false
  const baseCode = linkCode(lines.slice(0, start).join('\n')).slice(0, 3)
  let bulletMode: PdStatus | 'auto' | null = null
  let bulletEnd: RegExp | undefined

  for (let i = start; i < end; i += 1) {
    const line = lines[i]
    if (config.stopAt?.test(line)) break
    if (/^#{2,4} /.test(line)) {
      heading = line
      sectionCode = []
      sectionOpen = true
    } else if (sectionOpen && line.trim() && !line.startsWith('|')) {
      const links = linkCode(line)
      if (links.length > 0) sectionCode = links.slice(0, 3)
    }
    if (bulletMode && bulletEnd?.test(line)) bulletMode = null
    for (const section of config.bullets ?? []) {
      if (section.start.test(line)) {
        bulletMode = section.mode
        bulletEnd = section.end
      }
    }

    if (line.startsWith('|')) {
      const cells = splitRow(line)
      if (cells.length < 2 || /^:?-{3,}/.test(cells[0])) continue
      const pds = parseTokens(cells[0])
      if (pds.length === 0) continue
      const blank = /^#{2,4} .*(Để trống|PD để trống)/i.test(heading)
      let { status, note } = classifyRow(cells)
      if (blank) {
        status = config.blankTableMode ?? 'open'
        note = stripLinks(cells[1] ?? '')
      }
      const kind = status === 'done' ? detectKind(cells[1] ?? '') : ''
      let code = status === 'done' ? rowCode(cells, config) : []
      if (status === 'done' && code.length === 0) code = sectionCode.length > 0 ? sectionCode : baseCode.length > 0 ? baseCode : (config.defaultCode ?? [])
      for (const pd of pds) {
        claims.push({ pd, entry: { status, source: handoff, kind, note: truncate(note), code, tests: status === 'done' ? tests : [], alsoClaimedBy: [] } })
      }
      continue
    }

    if (bulletMode && /^- (\*\*)?(PD-)?\d{4}/.test(line)) {
      const pds = parseBulletTokens(line)
      const { status, note } = classifyBullet(line, bulletMode)
      const kind = status === 'done' ? detectKind(note) : ''
      for (const pd of pds) {
        claims.push({ pd, entry: { status, source: handoff, kind, note: status === 'done' ? '' : truncate(note), code: status === 'done' ? (baseCode.length > 0 ? baseCode : (config.defaultCode ?? [])) : [], tests: status === 'done' ? tests : [], alsoClaimedBy: [] } })
      }
    }
  }
  return claims
}

function fromManual(items: ManualEntry[]): Claim[] {
  return items.flatMap(item =>
    item.pds.map(pd => ({
      pd,
      entry: {
        status: item.status,
        source: item.source,
        kind: item.kind ?? '',
        note: item.note ?? '',
        code: item.code ?? [],
        tests: item.status === 'done' ? testsFor(item.source) : [],
        alsoClaimedBy: []
      } satisfies PdEntry
    }))
  )
}

function better(a: PdEntry, b: PdEntry): boolean {
  if (RANK[a.status] !== RANK[b.status]) return RANK[a.status] > RANK[b.status]
  return a.code.length > b.code.length
}

function main(): void {
  const files = readdirSync(HANDOFF_DIR)
    .filter(name => name.endsWith('.md') && name !== 'i-wiring.md' && name !== 'i-checklist.md')
    .sort()
  const claims: Claim[] = [...files.flatMap(name => parseHandoff(join(HANDOFF_DIR, name))), ...fromManual(MANUAL)]
  const merged = new Map<string, PdEntry>()
  for (const { pd, entry } of claims) {
    const current = merged.get(pd)
    if (!current) {
      merged.set(pd, entry)
    } else if (better(entry, current)) {
      merged.set(pd, { ...entry, alsoClaimedBy: [...new Set([...current.alsoClaimedBy, current.source])].filter(s => s !== entry.source) })
    } else if (current.source !== entry.source) {
      current.alsoClaimedBy = [...new Set([...current.alsoClaimedBy, entry.source])]
    }
  }
  for (const { pd, entry } of fromManual(OVERRIDES)) merged.set(pd, entry)

  const entries: Record<string, PdEntry & { caveat?: string }> = {}
  for (const pd of [...merged.keys()].sort()) {
    const entry = merged.get(pd) as PdEntry
    entries[pd] = CAVEATS[pd] && entry.status === 'done' ? { ...entry, caveat: CAVEATS[pd] } : entry
  }

  const counts: Record<PdStatus, number> = { done: 0, out: 0, open: 0, partial: 0, defer: 0 }
  for (const entry of Object.values(entries)) counts[entry.status] += 1
  const bySource: Record<string, Record<PdStatus, number>> = {}
  for (const entry of Object.values(entries)) {
    bySource[entry.source] ??= { done: 0, out: 0, open: 0, partial: 0, defer: 0 }
    bySource[entry.source][entry.status] += 1
  }

  writeFileSync(OUTPUT, `${JSON.stringify({ meta: { handoffs: files.map(f => basename(f, '.md')), counts, bySource }, entries }, null, 2)}\n`)
  console.log(`Wrote ${relative(ROOT, OUTPUT)}: ${Object.keys(entries).length} PD`, counts)
}

main()
