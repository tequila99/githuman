import type { DatabaseSync } from 'node:sqlite'
import { protectArtifactTables } from './artifact-migrations.ts'
import { withSavepoint } from './transaction.ts'

export function applyTaskJournalMigrations(db: DatabaseSync): void {
  withSavepoint(db, () => {
    const columns = db.prepare('PRAGMA table_info(task_journal_entries)').all()
    if (
      columns.some(column => column.name === 'task_id' && column.notnull === 1)
    ) {
      // Rebuild the table to allow project events without inventing a task.
      db.exec(`CREATE TABLE task_journal_entries_nullable (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, store_id TEXT NOT NULL, task_id TEXT,
        id TEXT NOT NULL, snapshot_json TEXT NOT NULL, source_event_id TEXT,
        UNIQUE(store_id,id), UNIQUE(store_id,task_id,source_event_id));
        INSERT INTO task_journal_entries_nullable SELECT * FROM task_journal_entries;
        DROP TABLE task_journal_entries;
        ALTER TABLE task_journal_entries_nullable RENAME TO task_journal_entries;`)
    }
    db.exec(`CREATE TABLE IF NOT EXISTS task_journal_entries (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, store_id TEXT NOT NULL, task_id TEXT,
    id TEXT NOT NULL, snapshot_json TEXT NOT NULL, source_event_id TEXT,
    UNIQUE(store_id,id), UNIQUE(store_id,task_id,source_event_id));
    CREATE INDEX IF NOT EXISTS task_journal_source ON task_journal_entries(store_id,source_event_id);
    CREATE INDEX IF NOT EXISTS task_journal_session ON task_journal_entries(store_id,json_extract(snapshot_json,'$.sessionId'),seq);
    CREATE INDEX IF NOT EXISTS task_journal_store ON task_journal_entries(store_id,seq);
    CREATE INDEX IF NOT EXISTS task_journal_task ON task_journal_entries(store_id,task_id,seq);
    CREATE INDEX IF NOT EXISTS task_journal_supersedes ON task_journal_entries(store_id,json_extract(snapshot_json,'$.supersedesEntryId'));
    CREATE UNIQUE INDEX IF NOT EXISTS task_journal_unassigned_fact ON task_journal_entries(store_id,source_event_id) WHERE task_id IS NULL;

    CREATE TABLE IF NOT EXISTS task_journal_operations (
    store_id TEXT NOT NULL, request_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
    result_json TEXT NOT NULL, PRIMARY KEY(store_id,request_id));
    CREATE TABLE IF NOT EXISTS task_handoff_operations (
    store_id TEXT NOT NULL, id TEXT NOT NULL, request_id TEXT NOT NULL,
    payload_hash TEXT NOT NULL, actor_json TEXT NOT NULL, owner_id TEXT NOT NULL,
    snapshot_json TEXT NOT NULL, PRIMARY KEY(store_id,id), UNIQUE(store_id,request_id));`)
    protectArtifactTables(db, {
      task_journal_entries:
        'seq=NEW.seq OR (store_id=NEW.store_id AND (id=NEW.id OR (task_id IS NEW.task_id AND source_event_id=NEW.source_event_id)))',
      task_journal_operations:
        'store_id=NEW.store_id AND request_id=NEW.request_id'
    })
  })
}
