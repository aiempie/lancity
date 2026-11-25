import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'

export function createInstanceAdmin(db: DatabaseSync, email: string, instanceName: string) {
  db.exec('PRAGMA foreign_keys = ON; BEGIN IMMEDIATE')
  try {
    const person = db.prepare('SELECT id FROM user WHERE email = ? AND email_verified = 1').get(email.toLowerCase())
    if (!person) throw new Error('The administrator must have a verified Better Auth account')
    const instance =
      db.prepare('SELECT id FROM instances WHERE deleted_at IS NULL ORDER BY id LIMIT 1').get() ??
      db
        .prepare(
          `INSERT INTO instances (instance_name, instance_id, last_checked_at, current_version,
        is_setup_done, is_telemetry_enabled, is_support_required) VALUES (?, ?, ?, '0.1.0', 1, 0, 0) RETURNING id`
        )
        .get(instanceName, crypto.randomUUID(), Date.now())
    if (!instance) throw new Error('Instance setup did not return an ID')
    db.prepare(
      `INSERT INTO instance_admins (instance_id, user_id, role, is_verified) VALUES (?, ?, 20, 1)
      ON CONFLICT (instance_id, user_id) DO UPDATE SET deleted_at = NULL, is_verified = 1`
    ).run(instance.id, person.id)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [, , database, email, instanceName = 'Lancity'] = process.argv
  if (!database || !existsSync(database) || !email || !instanceName.trim() || instanceName.length > 255) {
    throw new Error(
      'Usage: node scripts/plane/create-instance-admin.ts <local D1 SQLite file> <verified email> [instance name]'
    )
  }
  const db = new DatabaseSync(database)
  try {
    createInstanceAdmin(db, email, instanceName.trim())
  } finally {
    db.close()
  }
}
