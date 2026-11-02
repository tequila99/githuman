import type { DatabaseSync } from 'node:sqlite'
import { protectArtifactTables } from './artifact-migrations.ts'

export function applyArtifactReviewMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS artifact_review_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, store_id TEXT NOT NULL,
      thread_id TEXT NOT NULL, origin_artifact_id TEXT NOT NULL,
      version INTEGER NOT NULL CHECK(version >= 1), request_id TEXT NOT NULL,
      data_json TEXT NOT NULL,
      UNIQUE(store_id,thread_id,version), UNIQUE(store_id,request_id)
    );
    CREATE INDEX IF NOT EXISTS artifact_review_history
      ON artifact_review_events(store_id,thread_id,seq);
    CREATE TABLE IF NOT EXISTS artifact_thread_current (
      store_id TEXT NOT NULL, thread_id TEXT NOT NULL,
      origin_artifact_id TEXT NOT NULL, version INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL, PRIMARY KEY(store_id,thread_id)
    );
    CREATE INDEX IF NOT EXISTS artifact_thread_origin
      ON artifact_thread_current(store_id,origin_artifact_id,thread_id);
  `)
  protectArtifactTables(db, {
    artifact_review_events:
      'seq=NEW.seq OR (store_id=NEW.store_id AND ((thread_id=NEW.thread_id AND version=NEW.version) OR request_id=NEW.request_id))'
  })
}
