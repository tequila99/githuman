import type { DatabaseSync } from 'node:sqlite'
import { withSavepoint } from './transaction.ts'

export function probeArtifactSearch(db: DatabaseSync): boolean {
  try {
    withSavepoint(db, () => {
      db.exec(
        "CREATE VIRTUAL TABLE temp.ght_search_probe_words USING fts5(text,tokenize='unicode61'); CREATE VIRTUAL TABLE temp.ght_search_probe_grams USING fts5(text,tokenize='trigram'); DROP TABLE temp.ght_search_probe_words; DROP TABLE temp.ght_search_probe_grams;"
      )
    })
    return true
  } catch {
    return false
  }
}
export function applyArtifactSearchMigrations(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS artifact_search_capabilities (id INTEGER PRIMARY KEY CHECK(id=1), available INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS artifact_search_documents (
      rowid INTEGER PRIMARY KEY, store_id TEXT NOT NULL, artifact_id TEXT NOT NULL,
      version INTEGER NOT NULL, sha256 TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
      title_offsets TEXT NOT NULL, body_offsets TEXT NOT NULL, UNIQUE(store_id,artifact_id));
    CREATE TABLE IF NOT EXISTS artifact_search_suppressed (store_id TEXT NOT NULL, artifact_id TEXT NOT NULL, reason TEXT NOT NULL, PRIMARY KEY(store_id,artifact_id));
    CREATE TABLE IF NOT EXISTS artifact_search_words (store_id TEXT NOT NULL, token TEXT NOT NULL, length INTEGER NOT NULL, frequency INTEGER NOT NULL, PRIMARY KEY(store_id,token));
    CREATE INDEX IF NOT EXISTS artifact_search_word_length ON artifact_search_words(store_id,length);
    CREATE TABLE IF NOT EXISTS artifact_search_word_grams (store_id TEXT NOT NULL, gram TEXT NOT NULL, width INTEGER NOT NULL, token TEXT NOT NULL, PRIMARY KEY(store_id,width,gram,token));
    CREATE TABLE IF NOT EXISTS artifact_search_document_words (store_id TEXT NOT NULL, artifact_id TEXT NOT NULL, token TEXT NOT NULL, PRIMARY KEY(store_id,artifact_id,token));
    CREATE TABLE IF NOT EXISTS artifact_search_epochs (store_id TEXT PRIMARY KEY, epoch INTEGER NOT NULL DEFAULT 0);
  `)
  const available = probeArtifactSearch(db)
  db.prepare(
    'INSERT INTO artifact_search_capabilities VALUES(1,?) ON CONFLICT(id) DO UPDATE SET available=excluded.available'
  ).run(Number(available))
  if (available) {
    db.exec(
      "CREATE VIRTUAL TABLE IF NOT EXISTS artifact_search_fts USING fts5(title,body, tokenize='unicode61 remove_diacritics 0'); CREATE VIRTUAL TABLE IF NOT EXISTS artifact_search_trigrams USING fts5(title,body, tokenize='trigram');"
    )
  }
}
