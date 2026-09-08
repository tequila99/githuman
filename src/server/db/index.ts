import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { applyMigrations } from './migrations.ts'

export function createTestDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  applyMigrations(db)
  return db
}

export function createFileDatabase(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  // WAL allows a concurrent reader (`list`/`export`) while `serve` holds the file open.
  db.exec('PRAGMA journal_mode = WAL;')
  applyMigrations(db)
  return db
}
