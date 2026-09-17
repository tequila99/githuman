import type { DatabaseSync } from 'node:sqlite'

export function applyMigrations(db: DatabaseSync): void {
  db.exec(`
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
