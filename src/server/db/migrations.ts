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
  `)

  const columns = db.prepare('PRAGMA table_info(comments)').all() as Array<{
    name: string
  }>
  const columnNames = new Set(columns.map(c => c.name))

  if (!columnNames.has('resolved')) {
    db.exec(
      'ALTER TABLE comments ADD COLUMN resolved INTEGER NOT NULL DEFAULT 0'
    )
  }
  if (!columnNames.has('suggestion')) {
    db.exec('ALTER TABLE comments ADD COLUMN suggestion TEXT')
  }
}
