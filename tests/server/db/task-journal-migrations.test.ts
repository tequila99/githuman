import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { applyTaskJournalMigrations } from '../../../src/server/db/task-journal-migrations.ts'
import { protectArtifactTables } from '../../../src/server/db/artifact-migrations.ts'

test('journal upgrade retains immutable history and adds idempotent unassigned facts', t => {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  db.exec(`CREATE TABLE task_journal_entries (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, store_id TEXT NOT NULL, task_id TEXT NOT NULL,
    id TEXT NOT NULL, snapshot_json TEXT NOT NULL, source_event_id TEXT,
    UNIQUE(store_id,id), UNIQUE(store_id,task_id,source_event_id));
    INSERT INTO task_journal_entries VALUES(42,'store','task','old','{"body":"original"}','old-event');`)
  protectArtifactTables(db, { task_journal_entries: 'id=NEW.id' })
  applyTaskJournalMigrations(db)
  applyTaskJournalMigrations(db)
  assert.deepEqual(
    { ...db.prepare('SELECT * FROM task_journal_entries').get() },
    {
      seq: 42,
      store_id: 'store',
      task_id: 'task',
      id: 'old',
      snapshot_json: '{"body":"original"}',
      source_event_id: 'old-event'
    }
  )
  const insert = db.prepare(
    'INSERT INTO task_journal_entries(store_id,task_id,id,snapshot_json,source_event_id) VALUES(?,?,?,?,?)'
  )
  const result = insert.run('store', null, 'new', '{}', 'new-event')
  assert.equal(Number(result.lastInsertRowid), 43)
  assert.throws(() => insert.run('store', null, 'duplicate', '{}', 'new-event'))
  insert.run('other-store', null, 'new', '{}', 'new-event')
  assert.throws(
    () =>
      db.prepare("UPDATE task_journal_entries SET snapshot_json='{}'").run(),
    /immutable/
  )
  assert.throws(
    () => db.prepare('DELETE FROM task_journal_entries').run(),
    /immutable/
  )
  assert.throws(
    () =>
      db
        .prepare(
          'INSERT OR REPLACE INTO task_journal_entries(store_id,task_id,id,snapshot_json,source_event_id) VALUES(?,?,?,?,?)'
        )
        .run('store', null, 'replacement', '{}', 'new-event'),
    /immutable/
  )
})
