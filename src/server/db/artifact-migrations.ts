import type { DatabaseSync } from 'node:sqlite'

// Authoritative records remain append-only even when a caller bypasses the repository.
const IMMUTABLE_KEYS: Record<string, string> = {
  artifact_stores:
    'id=NEW.id OR (canonical_root=NEW.canonical_root AND db_namespace=NEW.db_namespace)',
  artifacts: 'store_id=NEW.store_id AND (id=NEW.id OR file_name=NEW.file_name)',
  artifact_metadata_versions:
    'store_id=NEW.store_id AND ((artifact_id=NEW.artifact_id AND version=NEW.version) OR request_id=NEW.request_id)',
  artifact_events:
    'seq=NEW.seq OR (store_id=NEW.store_id AND request_id=NEW.request_id)',
  artifact_operations: 'store_id=NEW.store_id AND request_id=NEW.request_id',
  artifact_operation_events: 'seq=NEW.seq'
}

export function applyArtifactMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS artifact_stores (
      id TEXT PRIMARY KEY, canonical_root TEXT NOT NULL, db_namespace TEXT NOT NULL,
      schema_version INTEGER NOT NULL, UNIQUE(canonical_root, db_namespace)
    );
    CREATE TABLE IF NOT EXISTS artifacts (
      store_id TEXT NOT NULL, id TEXT NOT NULL, file_name TEXT NOT NULL,
      sha256 TEXT NOT NULL, bytes INTEGER NOT NULL, body_start_line INTEGER NOT NULL,
      created_at TEXT NOT NULL, PRIMARY KEY(store_id,id), UNIQUE(store_id,file_name)
    );
    CREATE INDEX IF NOT EXISTS artifact_catalog_order ON artifacts(store_id,created_at,id);
    CREATE TABLE IF NOT EXISTS artifact_metadata_versions (
      store_id TEXT NOT NULL, artifact_id TEXT NOT NULL, version INTEGER NOT NULL,
      request_id TEXT NOT NULL, snapshot_json TEXT NOT NULL,
      PRIMARY KEY(store_id,artifact_id,version), UNIQUE(store_id,request_id)
    );
    CREATE TABLE IF NOT EXISTS artifact_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, store_id TEXT NOT NULL,
      artifact_id TEXT NOT NULL, request_id TEXT NOT NULL, data_json TEXT NOT NULL,
      UNIQUE(store_id,request_id)
    );
    CREATE INDEX IF NOT EXISTS artifact_history ON artifact_events(store_id,artifact_id,seq);
    CREATE TABLE IF NOT EXISTS artifact_current (
      store_id TEXT NOT NULL, artifact_id TEXT NOT NULL, version INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL, PRIMARY KEY(store_id,artifact_id)
    );
    CREATE TABLE IF NOT EXISTS artifact_store_epochs (
      store_id TEXT PRIMARY KEY, store_epoch INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS artifact_operations (
      store_id TEXT NOT NULL, request_id TEXT NOT NULL, kind TEXT NOT NULL,
      payload_hash TEXT NOT NULL, artifact_id TEXT NOT NULL, data_json TEXT NOT NULL,
      PRIMARY KEY(store_id,request_id)
    );
    CREATE TABLE IF NOT EXISTS artifact_operation_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, store_id TEXT NOT NULL,
      request_id TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS artifact_operation_history ON artifact_operation_events(store_id,request_id,seq);
    CREATE TABLE IF NOT EXISTS artifact_operation_leases (
      store_id TEXT NOT NULL, request_id TEXT NOT NULL, owner TEXT NOT NULL,
      expires_at INTEGER NOT NULL, PRIMARY KEY(store_id,request_id)
    );
  `)
  for (const [table, keys] of Object.entries(IMMUTABLE_KEYS)) {
    // REPLACE can bypass DELETE triggers when recursive triggers are disabled.
    // The rowid test stops REPLACE with an explicit rowid in tables without an
    // integer primary key. SQLite does not define NEW.rowid when it assigns the rowid.
    db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_no_replace BEFORE INSERT ON ${table}
      WHEN EXISTS(SELECT 1 FROM ${table} WHERE rowid=NEW.rowid OR (${keys}))
      BEGIN SELECT RAISE(ABORT, 'Artifact history is immutable'); END;`)
    for (const action of ['UPDATE', 'DELETE']) {
      db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_no_${action.toLowerCase()}
        BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT, 'Artifact history is immutable'); END;`)
    }
  }
}
