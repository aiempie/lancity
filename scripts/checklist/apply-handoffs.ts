/**
 * Applies scripts/checklist/status.json to docs/plane-demo-porting/NN-*.md.
 *
 * Usage:
 *   pnpm exec tsx scripts/checklist/extract-handoffs.ts   # rebuild status.json from handoffs
 *   pnpm exec tsx scripts/checklist/apply-handoffs.ts     # tick items and write status lines
 *
 * Rules:
 * - Only PD marked "done" in status.json are ticked, each with a status line that links code and
 *   test files. The label is "có test nhóm" when at least one linked test file exists in the repo
 *   (group-level coverage, not one test per item) and "chưa có test riêng" otherwise.
 * - OVERRIDES below correct entries that status.json cannot express (wrong path in the checklist,
 *   Django `__str__` helpers that need no port). They win over status.json.
 * - Out-of-scope, blank, partial and deferred PD stay `[ ]`; the decision is written next to the item.
 * - Items that were already `[x]` before this script are never touched.
 * - Safe to re-run: status lines carry the marker below and are rebuilt every time.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { PdEntry, PdStatus } from './extract-handoffs'

const ROOT = join(import.meta.dirname, '..', '..')
const DOCS = join(ROOT, 'docs', 'plane-demo-porting')
const MARKER = '<!-- handoff-status -->'
const TESTED = 'có test nhóm'
const UNTESTED = 'chưa có test riêng'

interface StatusFile {
  entries: Record<string, PdEntry & { caveat?: string }>
}

const status = JSON.parse(readFileSync(join(import.meta.dirname, 'status.json'), 'utf8')) as StatusFile

const REVIEW = 'review-fixes'
const ISSUE_TESTS = ['tests/p1-issue-core.integration.mjs']
const str = (
  note = 'Hàm `__str__` của Django chỉ để in chuỗi, Lancity không cần port. Giữ ô trống theo quy tắc ngoài phạm vi.'
) => ({
  status: 'out' as const,
  source: REVIEW,
  kind: '',
  note,
  code: [],
  tests: [],
  alsoClaimedBy: []
})
const done = (code: string[], tests: string[], note: string, kind = 'Port') => ({
  status: 'done' as const,
  source: REVIEW,
  kind,
  note,
  code,
  tests,
  alsoClaimedBy: []
})
const REPLICA =
  'Chỉ port cờ theo request (`AsyncLocalStorage`). D1 chưa dùng Sessions API nên mọi truy vấn vẫn đi qua primary.'

/** Corrections verified against src/ (see handoff/review-fixes.md). */
const OVERRIDES: Record<string, PdEntry & { caveat?: string }> = {
  '0141': done(['src/server/issue/list.ts'], ISSUE_TESTS, 'Tra issue theo `PROJECT-seq` ở `getIssueByIdentifier`.'),
  '0580': done(['src/server/issue/list.ts'], ISSUE_TESTS, 'Điều kiện danh sách ở `listWhere`.'),
  '0581': done(['src/server/issue/filter.ts'], ISSUE_TESTS, 'Annotation ở `ISSUE_ANNOTATIONS`.'),
  '0495': done(['src/server/cycle/service.ts'], ['tests/p2-cycle.integration.mjs'], '`listCycles`.'),
  '1439': done(
    ['src/server/issue/version/snapshot.ts'],
    ISSUE_TESTS,
    '`logIssueVersion`, gọi từ job `issue-version-sync`.'
  ),
  '1440': done(
    ['src/server/issue/version/snapshot.ts'],
    ISSUE_TESTS,
    '`logIssueDescriptionVersion`, gọi từ job `issue-description-version`.'
  ),
  ...Object.fromEntries(
    ['1588', '1589', '1590', '1591', '1592', '1593'].map(pd => [
      pd,
      done(['src/server/common/request-scope.ts'], [], REPLICA, 'Port một phần có chủ đích')
    ])
  ),
  ...Object.fromEntries(
    [
      '1422',
      '1423',
      '1424',
      '1426',
      '1427',
      '1428',
      '1429',
      '1430',
      '1432',
      '1434',
      '1435',
      '1436',
      '1437',
      '1438'
    ].map(pd => [pd, str()])
  )
}
for (const [pd, entry] of Object.entries(OVERRIDES)) status.entries[pd] = entry

const ITEM = /^- \[( |x)\] <a id="pd-(\d{4})"/

interface Counters {
  total: number
  ticked: number
  preTicked: number
  out: number
  open: number
  partial: number
  defer: number
  noHandoff: number
}

function link(path: string, label?: string): string {
  return `[\`${label ?? basename(path)}\`](../../${path})`
}

function handoffLink(source: string): string {
  return `[${source}](./handoff/${source}.md)`
}

function statusLine(entry: PdEntry & { caveat?: string }): string {
  const others = entry.alsoClaimedBy.length > 0 ? ` Handoff khác cũng nêu: ${entry.alsoClaimedBy.join(', ')}.` : ''
  if (entry.status === 'done') {
    const kind = entry.kind ? ` (${entry.kind})` : ''
    const code = entry.code.length > 0 ? ` · Mã Lancity: ${entry.code.map(path => link(path)).join(', ')}` : ''
    const existing = entry.tests.filter(path => existsSync(join(ROOT, path)))
    const label = existing.length > 0 ? TESTED : UNTESTED
    const tests = existing.length > 0 ? ` · Kiểm thử: ${existing.map(path => link(path)).join(', ')}` : ''
    const note = entry.note ? ` ${entry.note}` : ''
    const caveat = entry.caveat ? ` Lưu ý: ${entry.caveat}` : ''
    return `      <br>**Đã chuyển, ${label}**${kind}${code}${tests} · Nguồn: ${handoffLink(entry.source)}.${note}${caveat}${others} ${MARKER}`
  }
  const note = entry.note ? ` ${entry.note}` : ''
  if (entry.status === 'out') {
    return `      <br>**Ngoài phạm vi** theo ${handoffLink(entry.source)}, giữ ô trống.${note}${others} ${MARKER}`
  }
  if (entry.status === 'open') {
    return `      <br>**Để trống** theo ${handoffLink(entry.source)}.${note}${others} ${MARKER}`
  }
  if (entry.status === 'partial') {
    return `      <br>**Mới làm một phần, giữ ô trống** theo ${handoffLink(entry.source)}.${note}${others} ${MARKER}`
  }
  return `      <br>**Chưa có handoff nhận làm.** ${handoffLink(entry.source)} ghi mục này thuộc nhóm khác.${note}${others} ${MARKER}`
}

function processFile(path: string, counters: Counters, seen: Map<string, string>, unknown: Set<string>): string {
  const lines = readFileSync(path, 'utf8').split('\n')
  const output: string[] = []
  let i = 0
  while (i < lines.length) {
    const match = lines[i].match(ITEM)
    if (!match) {
      output.push(lines[i])
      i += 1
      continue
    }
    let head = lines[i]
    const block: string[] = []
    i += 1
    while (i < lines.length && lines[i].startsWith('      ')) {
      block.push(lines[i])
      i += 1
    }
    const previous = block.find(line => line.includes(MARKER))
    const body = block.filter(line => !line.includes(MARKER))
    if (previous?.includes('**Đã chuyển') && head.startsWith('- [x]')) head = head.replace('- [x]', '- [ ]')

    const pd = match[2]
    const duplicate = seen.get(pd)
    if (duplicate) unknown.add(`duplicate ${pd} in ${duplicate} and ${basename(path)}`)
    seen.set(pd, basename(path))
    counters.total += 1

    const entry = status.entries[pd]
    const alreadyTicked = head.startsWith('- [x]')
    if (alreadyTicked) counters.preTicked += 1
    if (!entry) {
      if (alreadyTicked) {
        output.push(head, ...body)
      } else {
        counters.noHandoff += 1
        output.push(
          head,
          ...body,
          `      <br>**Chưa có handoff nhận.** Không handoff nào của bốn đợt nhắc tới mục này, giữ ô trống. ${MARKER}`
        )
      }
      continue
    }
    if (alreadyTicked) {
      output.push(head, ...body)
      continue
    }
    const kind: PdStatus = entry.status
    if (kind === 'done') {
      head = head.replace('- [ ]', '- [x]')
      counters.ticked += 1
    } else {
      counters[kind] += 1
    }
    output.push(head, ...body, statusLine(entry))
  }
  return output.join('\n')
}

function main(): void {
  const files = readdirSync(DOCS)
    .filter(name => /^\d{2}-.*\.md$/.test(name))
    .sort()
  const seen = new Map<string, string>()
  const unknown = new Set<string>()
  const report: Record<string, Counters> = {}
  for (const name of files) {
    const counters: Counters = {
      total: 0,
      ticked: 0,
      preTicked: 0,
      out: 0,
      open: 0,
      partial: 0,
      defer: 0,
      noHandoff: 0
    }
    const path = join(DOCS, name)
    writeFileSync(path, processFile(path, counters, seen, unknown))
    report[name] = counters
  }
  for (const pd of Object.keys(status.entries))
    if (!seen.has(pd)) unknown.add(`status.json has PD-${pd} but no checklist item`)
  console.table(report)
  if (unknown.size > 0) console.log([...unknown].join('\n'))
}

main()
