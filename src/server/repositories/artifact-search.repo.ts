import { MAX_SEARCH_WORD_CODEPOINTS } from '../../shared/artifacts/constants.ts'
import type { DatabaseSync, SQLInputValue, StatementSync } from 'node:sqlite'
import type {
  Artifact,
  ArtifactSearchInput
} from '../../shared/artifacts/types.ts'
import {
  searchCopy,
  searchTokens,
  searchGrams,
  type SearchOffset
} from '../../shared/artifacts/search.ts'
import { ArtifactSearchUnavailableError } from '../errors/artifacts.ts'

export class ArtifactSearchRepository {
  private readonly db: DatabaseSync
  private readonly statements = new Map<string, StatementSync>()
  readonly storeId: string
  constructor(db: DatabaseSync, storeId: string) {
    this.db = db
    this.storeId = storeId
  }
  private statement(sql: string): StatementSync {
    let prepared = this.statements.get(sql)
    if (!prepared) {
      prepared = this.db.prepare(sql)
      this.statements.set(sql, prepared)
    }
    return prepared
  }
  available(): boolean {
    if (
      !this.statement(
        "SELECT 1 FROM sqlite_master WHERE name='artifact_search_capabilities'"
      ).get()
    ) {
      return false
    }
    return Boolean(
      (
        this.statement(
          'SELECT available FROM artifact_search_capabilities WHERE id=1'
        ).get() as { available: number } | undefined
      )?.available
    )
  }
  assertAvailable(): void {
    if (!this.available()) throw new ArtifactSearchUnavailableError()
  }
  epoch(): number {
    return (
      (
        this.statement(
          'SELECT COALESCE(SUM(epoch),0) epoch FROM artifact_search_epochs'
        ).get() as { epoch: number } | undefined
      )?.epoch ?? 0
    )
  }
  private changed(): void {
    this.statement(
      'INSERT INTO artifact_search_epochs VALUES(?,1) ON CONFLICT(store_id) DO UPDATE SET epoch=epoch+1'
    ).run(this.storeId)
  }
  pending(): string[] {
    return (
      this.statement(
        `SELECT c.artifact_id FROM artifact_current c LEFT JOIN artifact_search_documents d ON d.store_id=c.store_id AND d.artifact_id=c.artifact_id LEFT JOIN artifact_search_suppressed s ON s.store_id=c.store_id AND s.artifact_id=c.artifact_id WHERE c.store_id=? AND s.artifact_id IS NULL AND (d.version IS NULL OR d.version<>c.version) ORDER BY c.artifact_id`
      ).all(this.storeId) as { artifact_id: string }[]
    ).map(row => row.artifact_id)
  }
  document(id: string) {
    return this.statement(
      'SELECT rowid,version,sha256,title,body,title_offsets,body_offsets FROM artifact_search_documents WHERE store_id=? AND artifact_id=?'
    ).get(this.storeId, id) as
      | {
          rowid: number
          version: number
          sha256: string
          title: string
          body: string
          title_offsets: string
          body_offsets: string
        }
      | undefined
  }
  index(artifact: Artifact, body: () => string): void {
    if (!this.available()) return
    if (
      this.statement(
        'SELECT 1 FROM artifact_search_suppressed WHERE store_id=? AND artifact_id=?'
      ).get(this.storeId, artifact.id)
    ) {
      return
    }
    const old = this.document(artifact.id)
    const title = searchCopy(artifact.title)
    if (
      old &&
      old.sha256 === artifact.sha256 &&
      old.title === title.text &&
      old.title_offsets === JSON.stringify(title.offsets)
    ) {
      this.statement(
        'UPDATE artifact_search_documents SET version=? WHERE rowid=?'
      ).run(artifact.metadataVersion, old.rowid)
      return
    }
    const normalizedBody =
      old && old.sha256 === artifact.sha256
        ? {
            text: old.body,
            offsets: JSON.parse(old.body_offsets) as SearchOffset[]
          }
        : searchCopy(body())
    this.removeDocument(artifact.id)
    const inserted = this.statement(
      'INSERT INTO artifact_search_documents(store_id,artifact_id,version,sha256,title,body,title_offsets,body_offsets) VALUES(?,?,?,?,?,?,?,?)'
    ).run(
      this.storeId,
      artifact.id,
      artifact.metadataVersion,
      artifact.sha256,
      title.text,
      normalizedBody.text,
      JSON.stringify(title.offsets),
      JSON.stringify(normalizedBody.offsets)
    )
    const rowid = Number(inserted.lastInsertRowid)
    for (const table of ['artifact_search_fts', 'artifact_search_trigrams']) {
      this.statement(
        `INSERT INTO ${table}(rowid,title,body) VALUES(?,?,?)`
      ).run(rowid, title.text, normalizedBody.text)
    }
    for (const token of searchTokens(`${title.text}\n${normalizedBody.text}`)) {
      const length = Array.from(token).length
      if (length > MAX_SEARCH_WORD_CODEPOINTS) continue
      const frequency = this.statement(
        'INSERT INTO artifact_search_words VALUES(?,?,?,1) ON CONFLICT(store_id,token) DO UPDATE SET frequency=frequency+1 RETURNING frequency'
      ).get(this.storeId, token, length)
      const fresh = frequency?.frequency === 1
      this.statement(
        'INSERT INTO artifact_search_document_words VALUES(?,?,?)'
      ).run(this.storeId, artifact.id, token)
      if (fresh) {
        for (const width of [1, 2]) {
          for (const gram of searchGrams(token, width)) {
            this.statement(
              'INSERT INTO artifact_search_word_grams VALUES(?,?,?,?)'
            ).run(this.storeId, gram, width, token)
          }
        }
      }
    }
    this.changed()
  }
  private removeDocument(id: string): boolean {
    const old = this.document(id)
    if (!old) return false
    for (const table of ['artifact_search_fts', 'artifact_search_trigrams']) {
      this.statement(`DELETE FROM ${table} WHERE rowid=?`).run(old.rowid)
    }
    this.statement(
      `UPDATE artifact_search_words SET frequency=frequency-1 WHERE store_id=? AND token IN (SELECT token FROM artifact_search_document_words WHERE store_id=? AND artifact_id=?)`
    ).run(this.storeId, this.storeId, id)
    this.statement(
      'DELETE FROM artifact_search_word_grams WHERE store_id=? AND token IN (SELECT token FROM artifact_search_words WHERE store_id=? AND frequency=0)'
    ).run(this.storeId, this.storeId)
    this.statement(
      'DELETE FROM artifact_search_words WHERE store_id=? AND frequency=0'
    ).run(this.storeId)
    this.statement(
      'DELETE FROM artifact_search_document_words WHERE store_id=? AND artifact_id=?'
    ).run(this.storeId, id)
    this.statement('DELETE FROM artifact_search_documents WHERE rowid=?').run(
      old.rowid
    )
    return true
  }
  remove(id: string): void {
    if (this.removeDocument(id)) this.changed()
  }
  suppress(id: string, reason: string): void {
    this.removeDocument(id)
    this.statement(
      'INSERT INTO artifact_search_suppressed VALUES(?,?,?) ON CONFLICT(store_id,artifact_id) DO UPDATE SET reason=excluded.reason'
    ).run(this.storeId, id, reason)
    this.changed()
  }
  reset(): void {
    for (const row of this.statement(
      'SELECT artifact_id FROM artifact_search_documents WHERE store_id=?'
    ).all(this.storeId) as { artifact_id: string }[]) {
      this.removeDocument(row.artifact_id)
    }
    this.statement(
      'DELETE FROM artifact_search_suppressed WHERE store_id=?'
    ).run(this.storeId)
    this.changed()
  }
  candidates(token: string, edits: number, limit: number) {
    const width = Array.from(token).length >= 8 ? 2 : 1
    return this.statement(
      `SELECT w.token,w.frequency,COUNT(*) overlap FROM artifact_search_word_grams g JOIN artifact_search_words w ON w.store_id=g.store_id AND w.token=g.token WHERE g.store_id=? AND g.width=? AND g.gram IN (SELECT value FROM json_each(?)) AND w.length BETWEEN ? AND ? GROUP BY w.token ORDER BY overlap DESC,w.frequency DESC,w.token LIMIT ?`
    ).all(
      this.storeId,
      width,
      JSON.stringify(searchGrams(token, width)),
      Array.from(token).length - edits,
      Array.from(token).length + edits,
      limit
    ) as { token: string; frequency: number; overlap: number }[]
  }
  select(
    input: ArtifactSearchInput,
    normalized: string,
    exactExpression: string,
    fuzzyExpression: string,
    offset: number,
    limit: number
  ) {
    const params: SQLInputValue[] = []
    const hits: string[] = []
    if (normalized) {
      if (Array.from(normalized).length >= 3) {
        hits.push(
          'SELECT rowid,bm25(artifact_search_trigrams,5,1) score,0 tier FROM artifact_search_trigrams WHERE artifact_search_trigrams MATCH ?'
        )
        params.push('"' + normalized.replaceAll('"', '""') + '"')
      } else {
        hits.push(
          "SELECT rowid,0 score,0 tier FROM artifact_search_documents WHERE store_id=? AND (title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')"
        )
        const literal = '%' + normalized.replace(/[\\%_]/g, '\\$&') + '%'
        params.push(this.storeId, literal, literal)
      }
      if (exactExpression) {
        hits.push(
          'SELECT rowid,bm25(artifact_search_fts,5,1) score,1 tier FROM artifact_search_fts WHERE artifact_search_fts MATCH ?'
        )
        params.push(exactExpression)
      }
      if (fuzzyExpression) {
        hits.push(
          'SELECT rowid,bm25(artifact_search_fts,5,1) score,2 tier FROM artifact_search_fts WHERE artifact_search_fts MATCH ?'
        )
        params.push(fuzzyExpression)
      }
    } else {
      hits.push('SELECT rowid,0 score,0 tier FROM artifact_search_documents')
    }
    const filters = input.filters ?? {}
    const where = [
      'd.store_id=?',
      "json_extract(c.snapshot_json,'$.status') IN (SELECT value FROM json_each(?))"
    ]
    params.push(this.storeId, JSON.stringify(filters.statuses ?? ['accepted']))
    if (filters.typeIds) {
      where.push(
        "json_extract(c.snapshot_json,'$.typeId') IN (SELECT value FROM json_each(?))"
      )
      params.push(JSON.stringify(filters.typeIds))
    }
    if (filters.taskIds) {
      where.push(
        "EXISTS(SELECT 1 FROM json_each(c.snapshot_json,'$.taskIds') WHERE value IN (SELECT value FROM json_each(?)))"
      )
      params.push(JSON.stringify(filters.taskIds))
    }
    if (filters.tags) {
      where.push(
        "NOT EXISTS(SELECT 1 FROM json_each(?) f WHERE f.value NOT IN (SELECT value FROM json_each(c.snapshot_json,'$.tags')))"
      )
      params.push(JSON.stringify(filters.tags))
    }
    const sort =
      input.sort === 'createdAt'
        ? "json_extract(c.snapshot_json,'$.createdAt') DESC"
        : input.sort === 'metadataUpdatedAt'
          ? "json_extract(c.snapshot_json,'$.metadataUpdatedAt') DESC"
          : 'h.tier,h.score'
    params.push(limit, offset)
    return this.statement(
      `WITH hits AS MATERIALIZED (${hits.join(' UNION ALL ')}), ranked AS (SELECT rowid,tier,score FROM (SELECT rowid,tier,score,ROW_NUMBER() OVER (PARTITION BY rowid ORDER BY tier,score) n FROM hits) WHERE n=1) SELECT d.artifact_id id,c.snapshot_json,h.tier,h.score FROM ranked h JOIN artifact_search_documents d ON d.rowid=h.rowid JOIN artifact_current c ON c.store_id=d.store_id AND c.artifact_id=d.artifact_id WHERE ${where.join(' AND ')} ORDER BY ${sort},d.artifact_id LIMIT ? OFFSET ?`
    ).all(...params) as {
      id: string
      snapshot_json: string
      tier: number
      score: number
    }[]
  }
  diagnostics() {
    const available = this.available()
    if (!available) return { available, documents: 0, suppressed: [] }
    return {
      available,
      documents: (
        this.statement(
          'SELECT COUNT(*) count FROM artifact_search_documents WHERE store_id=?'
        ).get(this.storeId) as { count: number }
      ).count,
      suppressed: this.statement(
        'SELECT artifact_id id,reason FROM artifact_search_suppressed WHERE store_id=? ORDER BY artifact_id'
      ).all(this.storeId) as { id: string; reason: string }[]
    }
  }
}
