// Plane dump (JSON, JSONL or CSV per table) -> SQL for D1.
//   pnpm exec tsx scripts/plane-import/cli.ts --dump ./dump --out ./out [options]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  idMapSnapshotSchema,
  planeImportOptionsSchema,
  type PlaneImportOptions,
  type PlaneImportReport
} from '../../src/types/database/p4-migrations-schema'
import { decryptFernet, encryptData, isFernetToken } from '../../src/server/instance/encryption'
import { convertDump, type ConvertResult } from './convert'
import { IdMap } from './id-map'
import { readDumpDirectory } from './read-dump'
import { insertStatement } from './sql'
import { openTargetDatabase, readTargetSchema } from './target-schema'
import type { FilterConverter } from './transforms-content'

export const USAGE = `Usage: tsx scripts/plane-import/cli.ts --dump <dir> --out <dir> [options]
  --dump <dir>            Directory with <plane_table>.json|jsonl|csv files (users, workspaces, issues, ...)
  --out <dir>             Output directory for NNN-<table>.sql, id-map.json, report.json and asset-copies.json
  --drizzle <dir>         Drizzle SQL migrations that define the target schema (default: drizzle)
  --source-migration <n>  Last Plane migration applied to the dump (default: 125)
  --id-map <file>         Continue from an earlier id-map.json (IDs stay stable between runs)
  --start <table=n,...>   First ID to allocate per D1 table, for a database that already has rows
  --uploaded-keys <file>  JSON array of asset keys already verified in R2
  --assume-uploaded       Mark every file asset uploaded (only after copying all bytes to R2)
  --include-api-tokens    Import API tokens as inactive rows
  --plane-secret-key <s>  Plane SECRET_KEY. With --lancity-encryption-key, Fernet secrets in instance_configurations are re-encrypted as v1
  --lancity-encryption-key <s>  Lancity INSTANCE_ENCRYPTION_KEY used for the re-encrypted values
  --validate              Apply the SQL to a fresh in-memory schema and run PRAGMA foreign_key_check`

export function parseArgs(argv: string[]) {
  const flags = new Set(['--assume-uploaded', '--include-api-tokens', '--validate'])
  const values: Record<string, string> = {}
  const on = new Set<string>()
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (flags.has(arg)) on.add(arg)
    else if (arg.startsWith('--') && argv[i + 1] !== undefined) values[arg] = argv[++i]
    else throw new Error(`Unknown or incomplete argument: ${arg}\n${USAGE}`)
  }
  return { values, on }
}

/**
 * Re-encrypt Plane Fernet values in `instance_configurations` (rows with is_encrypted = 1) as Lancity `v1` values.
 * Without both keys the rows are imported unchanged: `decryptValue` reads Fernet when it has the Plane SECRET_KEY as
 * INSTANCE_ENCRYPTION_KEY. A value that cannot be decrypted is reported and left unchanged, never blanked.
 */
export async function reencryptInstanceSecrets(result: ConvertResult, planeKey: string | undefined, lancityKey: string | undefined) {
  if (!planeKey || !lancityKey) return
  for (const row of result.rows.get('instance_configurations') ?? []) {
    if (!row.is_encrypted || typeof row.value !== 'string' || !isFernetToken(row.value)) continue
    try {
      row.value = await encryptData(await decryptFernet(row.value, planeKey), lancityKey)
    } catch (error) {
      result.report.warnings.push(`instance_configurations ${String(row.key)}: kept Fernet value (${error instanceof Error ? error.message : String(error)})`)
    }
  }
}

export function renderSql(result: ConvertResult, order: string[]): { file: string; sql: string; statements: string[] }[] {
  const files: { file: string; sql: string; statements: string[] }[] = []
  for (const table of order) {
    const rows = result.rows.get(table)
    if (!rows?.length) continue
    const statements = rows.map(row => insertStatement(table, row))
    const file = `${String(files.length + 1).padStart(3, '0')}-${table}.sql`
    files.push({ file, statements, sql: `PRAGMA defer_foreign_keys = on;\n${statements.join('\n')}\n` })
  }
  return files
}

/** Run the SQL against a fresh schema copy. Returns the first failure or the foreign-key violations. */
export function validateSql(drizzleDir: string, statements: string[]): string[] {
  const db = openTargetDatabase(drizzleDir)
  const problems: string[] = []
  try {
    db.exec('PRAGMA foreign_keys = ON; BEGIN; PRAGMA defer_foreign_keys = on')
    try {
      for (const statement of statements) db.exec(statement)
      for (const violation of db.prepare('PRAGMA foreign_key_check').all()) {
        problems.push(`foreign key violation: ${JSON.stringify(violation)}`)
      }
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error))
    }
    db.exec('ROLLBACK')
  } finally {
    db.close()
  }
  return problems
}

async function loadConverter(): Promise<FilterConverter | null> {
  try {
    const loaded = (await import('../../src/server/common/filters')) as { LegacyToRichFiltersConverter: new () => FilterConverter }
    return new loaded.LegacyToRichFiltersConverter()
  } catch {
    return null
  }
}

export async function run(argv: string[]): Promise<{ report: PlaneImportReport; problems: string[] }> {
  const { values, on } = parseArgs(argv)
  if (!values['--dump'] || !values['--out']) throw new Error(USAGE)
  const drizzleDir = resolve(values['--drizzle'] ?? 'drizzle')
  const options: PlaneImportOptions = planeImportOptionsSchema.parse({
    sourceMigration: values['--source-migration'] === undefined ? undefined : Number(values['--source-migration']),
    assumeUploaded: on.has('--assume-uploaded'),
    includeApiTokens: on.has('--include-api-tokens'),
    uploadedKeys: values['--uploaded-keys'] ? JSON.parse(readFileSync(values['--uploaded-keys'], 'utf8')) : []
  })
  const idMap = new IdMap(values['--id-map'] ? idMapSnapshotSchema.parse(JSON.parse(readFileSync(values['--id-map'], 'utf8'))) : undefined)
  for (const part of (values['--start'] ?? '').split(',').filter(Boolean)) {
    const [table, first] = part.split('=')
    if (!table || !Number.isInteger(Number(first)) || Number(first) < 1) throw new Error(`Invalid --start entry: ${part}`)
    idMap.setStart(table, Number(first))
  }

  const target = openTargetDatabase(drizzleDir)
  const schema = readTargetSchema(target)
  target.close()
  const result = convertDump({ dump: readDumpDirectory(values['--dump']), schema, idMap, options, converter: await loadConverter() })
  await reencryptInstanceSecrets(result, values['--plane-secret-key'], values['--lancity-encryption-key'])
  const files = renderSql(result, schema.order)

  const out = resolve(values['--out'])
  mkdirSync(out, { recursive: true })
  for (const { file, sql } of files) writeFileSync(join(out, file), sql)
  writeFileSync(join(out, 'id-map.json'), JSON.stringify(idMap.snapshot()))
  writeFileSync(join(out, 'report.json'), JSON.stringify(result.report, null, 2))
  writeFileSync(join(out, 'asset-copies.json'), JSON.stringify(result.report.assetCopies, null, 2))
  const problems = on.has('--validate') ? validateSql(drizzleDir, files.flatMap(file => file.statements)) : []
  return { report: result.report, problems }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run(process.argv.slice(2)).then(
    ({ report, problems }) => {
      const written = Object.values(report.tables).reduce((sum, table) => sum + table.written, 0)
      const dropped = Object.values(report.tables).reduce((sum, table) => sum + table.dropped, 0)
      console.log(`Wrote ${written} rows, dropped ${dropped}, ${report.warnings.length} warnings, ${report.assetCopies.length} assets to copy.`)
      for (const problem of problems) console.error(problem)
      if (problems.length) process.exitCode = 1
    },
    error => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    }
  )
}

