import type { DatabaseSync } from 'node:sqlite'
import { protectArtifactTables } from './artifact-migrations.ts'

export function applyArtifactGraphMigrations(db: DatabaseSync): void {
  db.exec(`
 CREATE TABLE IF NOT EXISTS artifact_store_changes (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, store_id TEXT NOT NULL,
 entity_kind TEXT NOT NULL, entity_id TEXT NOT NULL, request_id TEXT NOT NULL,
 UNIQUE(store_id,entity_kind,request_id));
 CREATE TABLE IF NOT EXISTS artifact_revision_parents (
 store_id TEXT NOT NULL, child_id TEXT NOT NULL, parent_id TEXT NOT NULL,
 PRIMARY KEY(store_id,child_id));
 CREATE INDEX IF NOT EXISTS artifact_revision_children ON artifact_revision_parents(store_id,parent_id,child_id);
 CREATE TABLE IF NOT EXISTS artifact_definition_operations (
 store_id TEXT NOT NULL, request_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
 result_json TEXT NOT NULL, PRIMARY KEY(store_id,request_id));
 CREATE TABLE IF NOT EXISTS artifact_type_versions (
 store_id TEXT NOT NULL, id TEXT NOT NULL, version INTEGER NOT NULL,
 request_id TEXT NOT NULL, snapshot_json TEXT NOT NULL, actor_json TEXT NOT NULL,
 created_at TEXT NOT NULL, PRIMARY KEY(store_id,id,version), UNIQUE(store_id,request_id));
 CREATE TABLE IF NOT EXISTS artifact_type_current (
 store_id TEXT NOT NULL, id TEXT NOT NULL, snapshot_json TEXT NOT NULL,
 PRIMARY KEY(store_id,id));
 CREATE TABLE IF NOT EXISTS task_versions (
 store_id TEXT NOT NULL, id TEXT NOT NULL, version INTEGER NOT NULL,
 request_id TEXT NOT NULL, snapshot_json TEXT NOT NULL, actor_json TEXT NOT NULL,
 created_at TEXT NOT NULL, PRIMARY KEY(store_id,id,version), UNIQUE(store_id,request_id));
 CREATE TABLE IF NOT EXISTS task_current (
 store_id TEXT NOT NULL, id TEXT NOT NULL, snapshot_json TEXT NOT NULL,
 PRIMARY KEY(store_id,id));
 CREATE TABLE IF NOT EXISTS task_chat_link_events (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,store_id TEXT NOT NULL,session_id TEXT NOT NULL,
 version INTEGER NOT NULL,request_id TEXT NOT NULL, task_ids_json TEXT NOT NULL,
 chat_title_snapshot TEXT NOT NULL,actor_json TEXT NOT NULL,created_at TEXT NOT NULL,
 UNIQUE(store_id,session_id,version),UNIQUE(store_id,request_id));
 `)
  const columns = db
    .prepare('PRAGMA table_info(artifact_store_changes)')
    .all() as { name: string }[]
  if (!columns.some(column => column.name === 'validation_relevant')) {
    // Older changes conservatively invalidate validations after upgrade.
    db.exec(
      'ALTER TABLE artifact_store_changes ADD COLUMN validation_relevant INTEGER NOT NULL DEFAULT 1'
    )
  }
  db.exec(
    'CREATE INDEX IF NOT EXISTS artifact_validation_changes ON artifact_store_changes(store_id,validation_relevant,seq)'
  )
  // Copy an 0088 history once: the journal is empty only before the first copy.
  // Events that older code adds after this point are not copied.
  db.exec(`INSERT INTO artifact_store_changes(seq,store_id,entity_kind,entity_id,request_id)
 SELECT seq,store_id,'artifact',artifact_id,request_id FROM artifact_events e
 WHERE NOT EXISTS(SELECT 1 FROM artifact_store_changes);`)
  protectArtifactTables(db, {
    artifact_store_changes:
      'seq=NEW.seq OR (store_id=NEW.store_id AND entity_kind=NEW.entity_kind AND request_id=NEW.request_id)',
    artifact_revision_parents:
      'store_id=NEW.store_id AND child_id=NEW.child_id',
    artifact_definition_operations:
      'store_id=NEW.store_id AND request_id=NEW.request_id',
    artifact_type_versions:
      'store_id=NEW.store_id AND ((id=NEW.id AND version=NEW.version) OR request_id=NEW.request_id)',
    task_versions:
      'store_id=NEW.store_id AND ((id=NEW.id AND version=NEW.version) OR request_id=NEW.request_id)',
    task_chat_link_events:
      'seq=NEW.seq OR (store_id=NEW.store_id AND ((session_id=NEW.session_id AND version=NEW.version) OR request_id=NEW.request_id))'
  })
}
