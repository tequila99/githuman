import type { DatabaseSync } from 'node:sqlite'
import { protectArtifactTables } from './artifact-migrations.ts'

export function applyArtifactValidationMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS artifact_change_set_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, store_id TEXT NOT NULL,
      id TEXT NOT NULL, version INTEGER NOT NULL, request_id TEXT NOT NULL,
      payload_json TEXT NOT NULL, UNIQUE(store_id,id,version), UNIQUE(store_id,request_id)
    );
    CREATE TABLE IF NOT EXISTS artifact_validation_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, store_id TEXT NOT NULL,
      id TEXT NOT NULL, payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS artifact_validation_history ON artifact_validation_events(store_id,id,seq);
    CREATE TABLE IF NOT EXISTS artifact_validation_current (
      store_id TEXT NOT NULL, id TEXT NOT NULL, payload_json TEXT NOT NULL,
      PRIMARY KEY(store_id,id)
    );
    CREATE TABLE IF NOT EXISTS artifact_validation_leases (
      store_id TEXT PRIMARY KEY, validation_id TEXT NOT NULL,
      owner TEXT NOT NULL, owner_pid INTEGER NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS artifact_user_authorizations (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, store_id TEXT NOT NULL,
      id TEXT NOT NULL, payload_json TEXT NOT NULL, UNIQUE(store_id,id)
    );
    CREATE TABLE IF NOT EXISTS artifact_authorization_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, store_id TEXT NOT NULL,
      id TEXT NOT NULL, kind TEXT NOT NULL, payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS artifact_owner_heartbeats (
      store_id TEXT NOT NULL, owner TEXT NOT NULL, beat_at INTEGER NOT NULL,
      PRIMARY KEY(store_id,owner)
    );
    CREATE TABLE IF NOT EXISTS artifact_transition_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, store_id TEXT NOT NULL,
      id TEXT NOT NULL, payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS artifact_transition_history ON artifact_transition_events(store_id,id,seq);
    CREATE TABLE IF NOT EXISTS artifact_transition_current (
      store_id TEXT NOT NULL, id TEXT NOT NULL, artifact_id TEXT NOT NULL,
      payload_json TEXT NOT NULL, PRIMARY KEY(store_id,id)
    );
    CREATE INDEX IF NOT EXISTS artifact_transition_by_artifact ON artifact_transition_current(store_id,artifact_id);
    CREATE TABLE IF NOT EXISTS artifact_transition_requests (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, store_id TEXT NOT NULL,
      request_id TEXT NOT NULL, payload_hash TEXT NOT NULL, operation_id TEXT NOT NULL,
      UNIQUE(store_id,request_id)
    );
    CREATE TABLE IF NOT EXISTS artifact_transition_consents (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, store_id TEXT NOT NULL,
      operation_id TEXT NOT NULL, payload_json TEXT NOT NULL,
      UNIQUE(store_id,operation_id)
    );
    CREATE TABLE IF NOT EXISTS artifact_lifecycle_commits (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, store_id TEXT NOT NULL,
      request_id TEXT NOT NULL, payload_hash TEXT NOT NULL, result_json TEXT NOT NULL,
      UNIQUE(store_id,request_id)
    );
  `)
  protectArtifactTables(db, {
    artifact_change_set_events:
      'seq=NEW.seq OR (store_id=NEW.store_id AND ((id=NEW.id AND version=NEW.version) OR request_id=NEW.request_id))',
    artifact_validation_events: 'seq=NEW.seq',
    artifact_user_authorizations:
      'seq=NEW.seq OR (store_id=NEW.store_id AND id=NEW.id)',
    artifact_authorization_events: 'seq=NEW.seq',
    artifact_transition_events: 'seq=NEW.seq',
    artifact_transition_requests:
      'seq=NEW.seq OR (store_id=NEW.store_id AND request_id=NEW.request_id)',
    artifact_transition_consents:
      'seq=NEW.seq OR (store_id=NEW.store_id AND operation_id=NEW.operation_id)',
    artifact_lifecycle_commits:
      'seq=NEW.seq OR (store_id=NEW.store_id AND request_id=NEW.request_id)'
  })
}
