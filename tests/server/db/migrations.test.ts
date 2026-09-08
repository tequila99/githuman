import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createTestDatabase } from '../../../src/server/db/index.ts'
import { applyMigrations } from '../../../src/server/db/migrations.ts'

test('createTestDatabase applies migrations: the reviews table exists with expected columns', () => {
  const db = createTestDatabase()

  const columns = db.prepare('PRAGMA table_info(reviews)').all() as Array<{
    name: string
  }>
  const columnNames = columns.map(c => c.name)

  assert.deepEqual(
    columnNames.sort(),
    [
      'id',
      'repository_path',
      'base_ref',
      'source_type',
      'source_ref',
      'snapshot_data',
      'status',
      'created_at',
      'updated_at'
    ].sort()
  )

  db.close()
})

test('createTestDatabase applies migrations: the comments table exists with expected columns and an FK to reviews', () => {
  const db = createTestDatabase()

  const columns = db.prepare('PRAGMA table_info(comments)').all() as Array<{
    name: string
  }>
  const columnNames = columns.map(c => c.name)

  assert.deepEqual(
    columnNames.sort(),
    [
      'id',
      'review_id',
      'file_path',
      'line_number',
      'line_type',
      'content',
      'created_at',
      'updated_at',
      'resolved',
      'suggestion'
    ].sort()
  )

  const foreignKeys = db
    .prepare('PRAGMA foreign_key_list(comments)')
    .all() as Array<{ table: string }>
  assert.ok(foreignKeys.some(fk => fk.table === 'reviews'))

  db.close()
})

test('applyMigrations adds resolved/suggestion columns to a pre-existing comments table without them', () => {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE reviews (
      id TEXT PRIMARY KEY, repository_path TEXT NOT NULL, base_ref TEXT, source_type TEXT NOT NULL,
      source_ref TEXT, snapshot_data TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE comments (
      id TEXT PRIMARY KEY, review_id TEXT NOT NULL REFERENCES reviews(id), file_path TEXT NOT NULL,
      line_number INTEGER, line_type TEXT, content TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `)
  db.prepare(
    'INSERT INTO reviews (id, repository_path, source_type, snapshot_data, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run('r1', '/repo', 'staged', '[]', 'in_progress', 'x', 'x')
  db.prepare(
    'INSERT INTO comments (id, review_id, file_path, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run('c1', 'r1', 'a.txt', 'hi', 'x', 'x')

  applyMigrations(db)

  const columns = db.prepare('PRAGMA table_info(comments)').all() as Array<{
    name: string
  }>
  const columnNames = columns.map(c => c.name)
  assert.ok(columnNames.includes('resolved'))
  assert.ok(columnNames.includes('suggestion'))

  const row = db.prepare('SELECT * FROM comments WHERE id = ?').get('c1') as {
    resolved: number
    content: string
  }
  assert.equal(row.resolved, 0)
  assert.equal(row.content, 'hi')

  db.close()
})

test('applyMigrations is safe to call twice on the same database', () => {
  const db = createTestDatabase()

  assert.doesNotThrow(() => applyMigrations(db))

  db.close()
})
