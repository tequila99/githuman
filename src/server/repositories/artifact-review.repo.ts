import type { DatabaseSync } from 'node:sqlite'
import { Value } from '@sinclair/typebox/value'
import type {
  ArtifactReviewEvent,
  ArtifactThreadCurrent,
  ArtifactThreadView
} from '../../shared/artifacts/types.ts'
import { ArtifactReviewEventSchema } from '../../shared/artifacts/schemas.ts'
import { canonicalJson } from '../../shared/utils/canonical-json.ts'
import { withSavepoint } from '../db/transaction.ts'
import {
  ArtifactConflictError,
  ArtifactInputError,
  ArtifactIntegrityError,
  ArtifactNotFoundError
} from '../errors/artifacts.ts'
import type { ArtifactCatalogRepository } from './artifact-catalog.repo.ts'
import { ArtifactGraphRepository } from './artifact-graph.repo.ts'

interface ReviewRow {
  seq: number
  data_json: string
}

function readEvent(row: ReviewRow): ArtifactReviewEvent {
  return { ...JSON.parse(row.data_json), seq: row.seq }
}

function applyEvent(
  current: ArtifactThreadCurrent | undefined,
  event: ArtifactReviewEvent
): ArtifactThreadCurrent {
  const payload = event.payload
  if (event.expectedThreadVersion !== (current?.version ?? 0)) {
    throw new ArtifactConflictError('Review thread version changed.')
  }
  if (!current) {
    if (payload.kind !== 'created') {
      throw new ArtifactInputError(
        'The first review event must create a thread.'
      )
    }
    if (
      payload.anchor &&
      payload.anchor.artifactId !== event.originArtifactId
    ) {
      throw new ArtifactInputError(
        'Review anchor must reference the origin artifact.'
      )
    }
    return {
      threadId: event.threadId,
      originArtifactId: event.originArtifactId,
      anchor: payload.anchor,
      blocking: payload.blocking,
      version: 1,
      comments: [
        {
          id: event.threadId,
          text: payload.text,
          hidden: false,
          actor: event.actor,
          createdAt: event.createdAt,
          updatedAt: event.createdAt
        }
      ],
      resolutions: []
    }
  }
  if (event.originArtifactId !== current.originArtifactId) {
    throw new ArtifactInputError('Review thread origin cannot change.')
  }
  if (payload.kind === 'created') {
    throw new ArtifactConflictError('Review thread already exists.')
  }
  if (payload.kind === 'replied') {
    if (current.comments.some(comment => comment.id === payload.commentId)) {
      throw new ArtifactConflictError('Review comment already exists.')
    }
    current.comments.push({
      id: payload.commentId,
      text: payload.text,
      hidden: false,
      actor: event.actor,
      createdAt: event.createdAt,
      updatedAt: event.createdAt
    })
  } else if (payload.kind === 'content_edited' || payload.kind === 'hidden') {
    const comment = current.comments.find(item => item.id === payload.commentId)
    if (!comment) {
      throw new ArtifactInputError(
        'Review comment does not exist in this thread.'
      )
    }
    if (payload.kind === 'content_edited') {
      if (comment.hidden) {
        throw new ArtifactConflictError(
          'Hidden review comments cannot be edited.'
        )
      }
      comment.text = payload.text
    } else {
      comment.hidden = true
    }
    comment.updatedAt = event.createdAt
  } else if (payload.kind === 'blocking_changed') {
    current.blocking = payload.blocking
  } else {
    current.resolutions = current.resolutions.filter(
      resolution =>
        resolution.scope.appliesToArtifactId !==
        payload.scope.appliesToArtifactId
    )
    current.resolutions.push({
      scope: payload.scope,
      resolved: payload.kind === 'resolved',
      seq: event.seq
    })
  }
  current.version++
  return current
}

function viewThread(
  current: ArtifactThreadCurrent,
  artifactId: string,
  lineage: ReadonlySet<string>
): ArtifactThreadView {
  const decision = current.resolutions
    .filter(resolution => lineage.has(resolution.scope.appliesToArtifactId))
    .sort((a, b) => b.seq - a.seq)[0]
  return {
    ...current,
    inheritedFrom:
      current.originArtifactId === artifactId ? null : current.originArtifactId,
    effectiveResolved: decision?.resolved ?? false
  }
}

// This repository stores verified domain events; it does not authorize user commands.
export class ArtifactReviewRepository {
  private readonly db: DatabaseSync
  private readonly catalog: ArtifactCatalogRepository
  private readonly graph: ArtifactGraphRepository

  constructor(db: DatabaseSync, catalog: ArtifactCatalogRepository) {
    this.db = db
    this.catalog = catalog
    this.graph = new ArtifactGraphRepository(db, catalog)
  }

  get(threadId: string): ArtifactThreadCurrent | undefined {
    const row = this.db
      .prepare(
        'SELECT snapshot_json FROM artifact_thread_current WHERE store_id=? AND thread_id=?'
      )
      .get(this.catalog.storeId, threadId) as
      | { snapshot_json: string }
      | undefined
    return row
      ? (JSON.parse(row.snapshot_json) as ArtifactThreadCurrent)
      : undefined
  }

  request(requestId: string): ArtifactReviewEvent | undefined {
    const row = this.db
      .prepare(
        'SELECT seq,data_json FROM artifact_review_events WHERE store_id=? AND request_id=?'
      )
      .get(this.catalog.storeId, requestId) as ReviewRow | undefined
    return row ? readEvent(row) : undefined
  }

  append(
    requestId: string,
    input: Omit<ArtifactReviewEvent, 'storeId' | 'seq'>
  ): ArtifactReviewEvent {
    const data = { ...input, storeId: this.catalog.storeId }
    if (
      !requestId ||
      !Value.Check(ArtifactReviewEventSchema, { ...data, seq: 1 })
    ) {
      throw new ArtifactInputError('Invalid review event.')
    }
    const serialized = canonicalJson(data)
    return withSavepoint(this.db, () => {
      const replay = this.request(requestId)
      if (replay) {
        const { seq: _seq, ...previous } = replay
        if (canonicalJson(previous) !== serialized) {
          throw new ArtifactConflictError(
            'Review request identifier was reused with different input.'
          )
        }
        return replay
      }
      if (!this.catalog.get(input.originArtifactId)) {
        throw new ArtifactNotFoundError()
      }
      if (
        'scope' in input.payload &&
        !this.catalog.get(input.payload.scope.appliesToArtifactId)
      ) {
        throw new ArtifactNotFoundError()
      }
      const current = this.get(input.threadId)
      const inserted = this.db
        .prepare(
          'INSERT INTO artifact_review_events(store_id,thread_id,origin_artifact_id,version,request_id,data_json) VALUES(?,?,?,?,?,?)'
        )
        .run(
          this.catalog.storeId,
          input.threadId,
          input.originArtifactId,
          (current?.version ?? 0) + 1,
          requestId,
          serialized
        )
      const event = { ...data, seq: Number(inserted.lastInsertRowid) }
      const affectsValidation =
        Boolean(current?.blocking) ||
        (event.payload.kind === 'created' && event.payload.blocking) ||
        ['resolved', 'reopened', 'blocking_changed'].includes(
          event.payload.kind
        )
      const next = applyEvent(current, event)
      this.writeCurrent(next)
      this.catalog.recordChange(
        'artifact_review',
        input.threadId,
        requestId,
        affectsValidation
      )
      return event
    })
  }

  history(
    threadId: string,
    afterSeq: number,
    limit: number
  ): ArtifactReviewEvent[] {
    return (
      this.db
        .prepare(
          'SELECT seq,data_json FROM artifact_review_events WHERE store_id=? AND thread_id=? AND seq>? ORDER BY seq LIMIT ?'
        )
        .all(
          this.catalog.storeId,
          threadId,
          afterSeq,
          limit
        ) as unknown as ReviewRow[]
    ).map(readEvent)
  }

  getThreadsByOrigins(origins: ReadonlySet<string>): ArtifactThreadCurrent[] {
    const rows = this.db
      .prepare(`SELECT snapshot_json FROM artifact_thread_current
      WHERE store_id=? AND origin_artifact_id IN (SELECT value FROM json_each(?)) ORDER BY thread_id`)
      .all(this.catalog.storeId, JSON.stringify([...origins])) as {
      snapshot_json: string
    }[]
    return rows.map(
      row => JSON.parse(row.snapshot_json) as ArtifactThreadCurrent
    )
  }

  getThreads(
    artifactId: string,
    includeInherited = true,
    includeResolvedInherited = false
  ): ArtifactThreadView[] {
    return withSavepoint(this.db, () => {
      if (!this.catalog.get(artifactId)) throw new ArtifactNotFoundError()
      const lineage = new Set([artifactId, ...this.graph.ancestors(artifactId)])
      const result: ArtifactThreadView[] = []
      for (const originId of includeInherited ? lineage : [artifactId]) {
        const rows = this.db
          .prepare(
            'SELECT snapshot_json FROM artifact_thread_current WHERE store_id=? AND origin_artifact_id=? ORDER BY thread_id'
          )
          .all(this.catalog.storeId, originId) as { snapshot_json: string }[]
        for (const row of rows) {
          const current = JSON.parse(row.snapshot_json) as ArtifactThreadCurrent
          const view = viewThread(current, artifactId, lineage)
          if (
            !includeResolvedInherited &&
            originId !== artifactId &&
            view.effectiveResolved
          ) {
            continue
          }
          result.push(view)
        }
      }
      return result
    })
  }

  rebuild(): void {
    withSavepoint(this.db, () => {
      this.db
        .prepare('DELETE FROM artifact_thread_current WHERE store_id=?')
        .run(this.catalog.storeId)
      const rows = this.db
        .prepare(
          'SELECT seq,data_json FROM artifact_review_events WHERE store_id=? ORDER BY seq'
        )
        .all(this.catalog.storeId) as unknown as ReviewRow[]
      for (const row of rows) {
        const event = readEvent(row)
        try {
          this.writeCurrent(applyEvent(this.get(event.threadId), event))
        } catch (cause) {
          throw new ArtifactIntegrityError(
            'Review history cannot rebuild its current projection.',
            { cause }
          )
        }
      }
    })
  }

  private writeCurrent(current: ArtifactThreadCurrent): void {
    this.db
      .prepare(`INSERT INTO artifact_thread_current VALUES(?,?,?,?,?)
      ON CONFLICT(store_id,thread_id) DO UPDATE SET version=excluded.version,snapshot_json=excluded.snapshot_json`)
      .run(
        this.catalog.storeId,
        current.threadId,
        current.originArtifactId,
        current.version,
        JSON.stringify(current)
      )
  }
}
