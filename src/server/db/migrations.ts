import type { DatabaseSync } from 'node:sqlite'

export function applyMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS note_storages (
      id TEXT PRIMARY KEY,
      root TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS note_catalog (
      storage_id TEXT NOT NULL REFERENCES note_storages(id),
      id TEXT NOT NULL,
      path TEXT NOT NULL,
      presence TEXT NOT NULL,
      version TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      path_changed_at TEXT NOT NULL,
      redirect_id TEXT,
      PRIMARY KEY(storage_id, id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS note_current_path ON note_catalog(storage_id, path) WHERE presence = 'present' AND redirect_id IS NULL;
    CREATE TABLE IF NOT EXISTS note_path_history (
      storage_id TEXT NOT NULL,
      note_id TEXT NOT NULL,
      old_path TEXT NOT NULL,
      new_path TEXT NOT NULL,
      changed_at TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      FOREIGN KEY(storage_id, note_id) REFERENCES note_catalog(storage_id, id)
    );
    CREATE TABLE IF NOT EXISTS note_links (
      storage_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      target_id TEXT,
      data TEXT NOT NULL,
      FOREIGN KEY(storage_id, source_id) REFERENCES note_catalog(storage_id, id),
      FOREIGN KEY(storage_id, target_id) REFERENCES note_catalog(storage_id, id),
      PRIMARY KEY(storage_id, source_id, ordinal)
    );
    CREATE INDEX IF NOT EXISTS note_link_target ON note_links(storage_id, target_id);
    CREATE TABLE IF NOT EXISTS note_issues (
      storage_id TEXT NOT NULL REFERENCES note_storages(id),
      id TEXT NOT NULL,
      note_id TEXT,
      candidate_id TEXT,
      data TEXT NOT NULL,
      PRIMARY KEY(storage_id, id),
      FOREIGN KEY(storage_id,note_id) REFERENCES note_catalog(storage_id,id),
      FOREIGN KEY(storage_id,candidate_id) REFERENCES note_catalog(storage_id,id)
    );
    CREATE TABLE IF NOT EXISTS note_issue_decisions (storage_id TEXT NOT NULL REFERENCES note_storages(id), id TEXT NOT NULL, PRIMARY KEY(storage_id,id));
    CREATE TABLE IF NOT EXISTS note_operations (
      storage_id TEXT NOT NULL REFERENCES note_storages(id),
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY(storage_id, id)
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      repository_path TEXT NOT NULL,
      base_ref TEXT,
      source_type TEXT NOT NULL,
      source_ref TEXT,
      snapshot_data TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      review_id TEXT NOT NULL REFERENCES reviews(id),
      file_path TEXT NOT NULL,
      line_number INTEGER,
      line_type TEXT,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS review_files (
      review_id TEXT NOT NULL REFERENCES reviews(id),
      file_path TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS review_files_file_path_idx
      ON review_files(file_path);
    CREATE INDEX IF NOT EXISTS review_files_review_id_idx
      ON review_files(review_id);
  `)

  const commentColumns = db
    .prepare('PRAGMA table_info(comments)')
    .all() as Array<{ name: string }>
  const commentColumnNames = new Set(commentColumns.map(c => c.name))

  if (!commentColumnNames.has('resolved')) {
    db.exec(
      'ALTER TABLE comments ADD COLUMN resolved INTEGER NOT NULL DEFAULT 0'
    )
  }
  if (!commentColumnNames.has('suggestion')) {
    db.exec('ALTER TABLE comments ADD COLUMN suggestion TEXT')
  }
  if (!commentColumnNames.has('line_number_end')) {
    db.exec('ALTER TABLE comments ADD COLUMN line_number_end INTEGER')
  }

  const reviewColumns = db
    .prepare('PRAGMA table_info(reviews)')
    .all() as Array<{ name: string }>
  const reviewColumnNames = new Set(reviewColumns.map(c => c.name))

  if (!reviewColumnNames.has('name')) {
    db.exec('ALTER TABLE reviews ADD COLUMN name TEXT')
  }
  if (!reviewColumnNames.has('branch')) {
    db.exec('ALTER TABLE reviews ADD COLUMN branch TEXT')
  }

  // NULL is never considered equal to NULL by SQLite's UNIQUE constraint,
  // so pre-existing reviews with name/branch = NULL don't collide with
  // each other or block this index from being created (see ADR 0017).
  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS reviews_name_branch_uq ON reviews(name, branch)'
  )
}
