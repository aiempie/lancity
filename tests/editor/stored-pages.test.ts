import { DatabaseSync } from 'node:sqlite'
import { Node } from '@tiptap/pm/model'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { fragmentToJson, htmlToJson } from '@/server/collaboration/codec'
import { documentSchema } from './schema'

// Existing pages must still open in the ported editor. Point LANCITY_TEST_D1 at a local D1 SQLite file (the isolated
// database of the integration tests, or a copy of a real one) to check every stored page against the editor schema.
const databasePath = process.env.LANCITY_TEST_D1

type Row = { id: number; binary: Uint8Array | null; html: string | null }

function readPages(): Row[] {
  const db = new DatabaseSync(databasePath!, { readOnly: true })
  try {
    return db
      .prepare('select id, description_binary as binary, description_html as html from pages where deleted_at is null')
      .all() as Row[]
  } finally {
    db.close()
  }
}

describe.skipIf(!databasePath)('pages stored in LANCITY_TEST_D1', () => {
  const rows = databasePath ? readPages() : []
  const withBinary = rows.filter(row => row.binary && row.binary.byteLength > 0)

  it.skipIf(!withBinary.length)('open from their Yjs state in the editor schema', () => {
    const failures: string[] = []
    for (const row of withBinary) {
      const doc = new Y.Doc()
      try {
        Y.applyUpdate(doc, new Uint8Array(row.binary!))
        Node.fromJSON(documentSchema, fragmentToJson(doc.getXmlFragment('default'))).check()
      } catch (error) {
        failures.push(`page ${row.id}: ${String(error)}`)
      }
    }
    expect(failures).toEqual([])
  })

  it.skipIf(!rows.length)('open from their stored HTML in the editor schema', () => {
    const failures: string[] = []
    for (const row of rows) {
      try {
        Node.fromJSON(documentSchema, htmlToJson(row.html || '<p></p>')).check()
      } catch (error) {
        failures.push(`page ${row.id}: ${String(error)}`)
      }
    }
    expect(failures).toEqual([])
  })
})
