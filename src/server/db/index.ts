import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { applyMigrations } from './migrations.ts'

// Give concurrent local processes time to finish short write transactions.
const WRITE_BUSY_TIMEOUT_MS = 5000

export function createTestDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  applyMigrations(db)
  return db
}

export function createFileDatabase(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec(`PRAGMA busy_timeout = ${WRITE_BUSY_TIMEOUT_MS};`)
  // WAL allows a concurrent reader (`list`/`export`) while `serve` holds the file open.
  db.exec('PRAGMA journal_mode = WAL;')
  applyMigrations(db)
  return db
}
