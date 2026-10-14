import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { NoteIssue, NoteRecord } from '../../shared/notes/types.ts'
import type { NoteReference } from '../../shared/notes/references.ts'

export interface CatalogNote extends NoteRecord {
  redirectId: string | null
}
export interface CatalogLink {
  reference: NoteReference
  targetId: string | null
  targetPath: string | null
  anchor: string
  ambiguous: boolean
}
export interface NoteOperation {
  id: string
  moves: { id: string; from: string; to: string; version?: string }[]
  source: string
  target: string
  folder: boolean
  moved: boolean
  committed: boolean
  temporary?: string
  sourceFingerprint?: string
  restore?: {
    previousId: string
    candidateId: string
    version: string
    links: CatalogLink[]
  }
  writes: {
    id: string
    path: string
    before: string
    after: string
    done: boolean
  }[]
}
interface NoteRow {
  id: string
  path: string
  presence: NoteRecord['presence']
  version: string
  created_at: string
  updated_at: string
  redirect_id: string | null
}
function toNote(row: NoteRow): CatalogNote {
  return {
    id: row.id,
    path: row.path,
    presence: row.presence,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    redirectId: row.redirect_id
  }
}

export class NotesCatalogRepository {
  readonly storageId: string
  readonly db: DatabaseSync
  constructor(db: DatabaseSync, root: string) {
    this.db = db
    const row = db
      .prepare('SELECT id FROM note_storages WHERE root = ?')
      .get(root) as { id: string } | undefined
    this.storageId = row?.id ?? randomUUID()
    if (!row) {
      db.prepare('INSERT INTO note_storages(id,root) VALUES(?,?)').run(
        this.storageId,
        root
      )
    }
  }
  transaction<T>(run: () => T): T {
    this.db.exec('SAVEPOINT notes_catalog')
    try {
      const value = run()
      this.db.exec('RELEASE notes_catalog')
      return value
    } catch (error) {
      this.db.exec('ROLLBACK TO notes_catalog; RELEASE notes_catalog')
      throw error
    }
  }
  all(): CatalogNote[] {
    return (
      this.db
        .prepare(
          'SELECT * FROM note_catalog WHERE storage_id = ? ORDER BY path, id'
        )
        .all(this.storageId) as unknown as NoteRow[]
    ).map(toNote)
  }
  get(id: string): CatalogNote | undefined {
    const row = this.db
      .prepare('SELECT * FROM note_catalog WHERE storage_id = ? AND id = ?')
      .get(this.storageId, id) as NoteRow | undefined
    return row ? toNote(row) : undefined
  }
  put(note: CatalogNote) {
    this.db
      .prepare(`INSERT INTO note_catalog(storage_id,id,path,presence,version,created_at,updated_at,path_changed_at,redirect_id) VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(storage_id,id) DO UPDATE SET path=excluded.path,presence=excluded.presence,version=excluded.version,updated_at=excluded.updated_at,path_changed_at=CASE WHEN note_catalog.path != excluded.path THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE note_catalog.path_changed_at END,redirect_id=excluded.redirect_id`)
      .run(
        this.storageId,
        note.id,
        note.path,
        note.presence,
        note.version,
        note.createdAt,
        note.updatedAt,
        note.updatedAt,
        note.redirectId
      )
  }
  links(id: string): CatalogLink[] {
    const rows = this.db
      .prepare(
        'SELECT data FROM note_links WHERE storage_id = ? AND source_id = ? ORDER BY ordinal'
      )
      .all(this.storageId, id) as { data: string }[]
    return rows.map(row => JSON.parse(row.data) as CatalogLink)
  }
  setLinks(id: string, links: CatalogLink[]) {
    this.transaction(() => {
      this.db
        .prepare(
          'DELETE FROM note_links WHERE storage_id = ? AND source_id = ?'
        )
        .run(this.storageId, id)
      const stmt = this.db.prepare(
        'INSERT INTO note_links(storage_id,source_id,ordinal,target_id,data) VALUES(?,?,?,?,?)'
      )
      links.forEach((link, ordinal) =>
        stmt.run(
          this.storageId,
          id,
          ordinal,
          link.targetId,
          JSON.stringify(link)
        )
      )
    })
  }
  history(id: string, from: string, to: string, operationId: string) {
    this.db
      .prepare('INSERT INTO note_path_history VALUES(?,?,?,?,?,?)')
      .run(this.storageId, id, from, to, new Date().toISOString(), operationId)
  }
  historical(path: string): string[] {
    const rows = this.db
      .prepare(
        'SELECT DISTINCT note_id FROM note_path_history WHERE storage_id = ? AND old_path = ?'
      )
      .all(this.storageId, path) as { note_id: string }[]
    return rows.map(row => row.note_id)
  }
  issues(): NoteIssue[] {
    const rows = this.db
      .prepare('SELECT data FROM note_issues WHERE storage_id = ? ORDER BY id')
      .all(this.storageId) as { data: string }[]
    return rows.map(row => JSON.parse(row.data) as NoteIssue)
  }
  issue(issue: NoteIssue) {
    if (
      this.db
        .prepare(
          'SELECT 1 FROM note_issue_decisions WHERE storage_id = ? AND id = ?'
        )
        .get(this.storageId, issue.id)
    ) {
      return
    }
    this.db
      .prepare(
        'INSERT OR REPLACE INTO note_issues(storage_id,id,note_id,candidate_id,data) VALUES(?,?,?,?,?)'
      )
      .run(
        this.storageId,
        issue.id,
        issue.noteId,
        issue.candidateId,
        JSON.stringify(issue)
      )
  }
  reopen(id: string) {
    this.db
      .prepare(
        'DELETE FROM note_issue_decisions WHERE storage_id = ? AND id = ?'
      )
      .run(this.storageId, id)
  }
  dismiss(id: string, permanent = false) {
    if (permanent) {
      this.db
        .prepare('INSERT OR IGNORE INTO note_issue_decisions VALUES(?,?)')
        .run(this.storageId, id)
    }
    this.db
      .prepare('DELETE FROM note_issues WHERE storage_id = ? AND id = ?')
      .run(this.storageId, id)
  }
  operations(): NoteOperation[] {
    const rows = this.db
      .prepare(
        'SELECT data FROM note_operations WHERE storage_id = ? ORDER BY rowid'
      )
      .all(this.storageId) as { data: string }[]
    return rows.map(row => JSON.parse(row.data) as NoteOperation)
  }
  operation(operation: NoteOperation) {
    this.db
      .prepare('INSERT OR REPLACE INTO note_operations VALUES(?,?,?)')
      .run(this.storageId, operation.id, JSON.stringify(operation))
  }
  finishOperation(id: string) {
    this.db
      .prepare('DELETE FROM note_operations WHERE storage_id = ? AND id = ?')
      .run(this.storageId, id)
  }
}
