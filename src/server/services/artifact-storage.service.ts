import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { stringify } from 'yaml'
import { Value } from '@sinclair/typebox/value'
import type {
  Artifact,
  ArtifactActor,
  ArtifactContent,
  ArtifactHistory,
  ArtifactList,
  ArtifactMetadataInput
} from '../../shared/artifacts/types.ts'
import {
  ArtifactActorSchema,
  ArtifactMetadataInputSchema
} from '../../shared/artifacts/schemas.ts'
import {
  MAX_ARTIFACT_BODY_BYTES,
  MAX_ARTIFACT_BYTES,
  MAX_ARTIFACT_CHUNK_BYTES,
  MAX_ARTIFACT_METADATA_BYTES,
  MAX_ARTIFACT_PAGE_SIZE
} from '../../shared/artifacts/constants.ts'
import { isUuid } from '../../shared/utils/is-uuid.ts'
import {
  ArtifactConflictError,
  ArtifactInputError,
  ArtifactIntegrityError,
  ArtifactNotFoundError,
  ArtifactTooLargeError
} from '../errors/artifacts.ts'
import {
  ArtifactCatalogRepository,
  type ArtifactOperation,
  type ArtifactReservation
} from '../repositories/artifact-catalog.repo.ts'
import { ArtifactFilesRepository } from '../repositories/artifact-files.repo.ts'
import { sha256Hex } from '../utils/hash.ts'
import type { EventBus } from '../event-bus.ts'

// Recover a stopped owner without taking an active writer's operation.
const OPERATION_LEASE_MS = 30_000

export type ArtifactCheckpoint =
  | 'reserved'
  | 'temp_synced'
  | 'published'
  | 'before_commit'
  | 'after_commit'
export interface ArtifactStorageOptions {
  db: DatabaseSync
  repositoryPath: string
  prefix: string
  eventBus?: EventBus
  now?: () => number
  checkpoint?: (
    phase: ArtifactCheckpoint,
    reservation: ArtifactReservation
  ) => void
}
export interface CreateArtifactInput {
  requestId: string
  body: string
  metadata: ArtifactMetadataInput
}

// Fix the property order so equal identities give equal payload hashes.
function canonicalActor(actor: ArtifactActor): ArtifactActor {
  return { kind: actor.kind, id: actor.id }
}

export class ArtifactStorageService {
  readonly files: ArtifactFilesRepository
  readonly catalog: ArtifactCatalogRepository
  private readonly owner = randomUUID()
  private readonly options: ArtifactStorageOptions
  private readonly now: () => number
  private observedEpoch: number

  constructor(options: ArtifactStorageOptions) {
    this.options = options
    this.now = options.now ?? Date.now
    this.files = new ArtifactFilesRepository(
      options.repositoryPath,
      options.prefix
    )
    this.catalog = new ArtifactCatalogRepository(
      options.db,
      this.files.repositoryPath,
      options.prefix
    )
    this.observedEpoch = this.catalog.epoch()
  }

  get storeId(): string {
    return this.catalog.storeId
  }

  private validate(
    requestId: string,
    metadata: ArtifactMetadataInput,
    actor: ArtifactActor
  ): void {
    if (
      typeof requestId !== 'string' ||
      requestId.length < 1 ||
      requestId.length > 128
    ) {
      throw new ArtifactInputError('Invalid artifact request identifier.')
    }
    if (
      !Value.Check(ArtifactMetadataInputSchema, metadata) ||
      !metadata.title.trim()
    ) {
      throw new ArtifactInputError('Invalid artifact metadata.')
    }
    if (!Value.Check(ArtifactActorSchema, actor)) {
      throw new ArtifactInputError('Invalid artifact actor.')
    }
    if (
      Buffer.byteLength(JSON.stringify(metadata)) > MAX_ARTIFACT_METADATA_BYTES
    ) {
      throw new ArtifactTooLargeError()
    }
  }

  private fileName(id: string): string {
    if (!isUuid(id)) {
      throw new ArtifactInputError('Invalid artifact identifier.')
    }
    return `${this.files.prefix}${id}.md`
  }

  private document(artifact: Artifact, body: string): Buffer {
    const header = stringify({
      schema_version: 1,
      store_id: this.storeId,
      artifact_id: artifact.id,
      title: artifact.title,
      type_id: artifact.typeId,
      status: artifact.status,
      created_at: artifact.createdAt,
      metadata_updated_at: artifact.createdAt,
      task_ids: [],
      tags: artifact.tags,
      relations: [],
      revision_of: []
    })
    return Buffer.from(`---\n${header}---\n${body}`, 'utf8')
  }

  create(input: CreateArtifactInput, suppliedActor: ArtifactActor): Artifact {
    this.validate(input.requestId, input.metadata, suppliedActor)
    const actor = canonicalActor(suppliedActor)
    if (typeof input.body !== 'string' || input.body.includes('\0')) {
      throw new ArtifactInputError(
        'Artifact body must be valid UTF-8 text without NUL.'
      )
    }
    if (Buffer.byteLength(input.body) > MAX_ARTIFACT_BODY_BYTES) {
      throw new ArtifactTooLargeError()
    }
    if (Buffer.from(input.body).toString('utf8') !== input.body) {
      throw new ArtifactInputError('Artifact body must be valid UTF-8 text.')
    }
    const payloadHash = sha256Hex(
      JSON.stringify({
        kind: 'create',
        body: input.body,
        title: input.metadata.title,
        tags: input.metadata.tags,
        actor
      })
    )
    const operation = this.catalog.transaction(() => {
      const previous = this.catalog.operation(input.requestId)
      if (previous) {
        this.checkReplay(previous, payloadHash)
        if (previous.state !== 'committed') {
          this.catalog.claim(
            input.requestId,
            this.owner,
            this.now(),
            OPERATION_LEASE_MS
          )
        }
        return previous
      }
      const now = new Date(this.now()).toISOString()
      const artifact: Artifact = {
        storeId: this.storeId,
        id: randomUUID(),
        sha256: '',
        bytes: 0,
        bodyStartLine: 0,
        createdAt: now,
        metadataVersion: 1,
        metadataUpdatedAt: now,
        title: input.metadata.title,
        tags: [...input.metadata.tags],
        typeId: 'generic',
        status: 'draft'
      }
      const content = this.document(artifact, input.body)
      if (content.length > MAX_ARTIFACT_BYTES) throw new ArtifactTooLargeError()
      const headerBytes = content.length - Buffer.byteLength(input.body)
      artifact.sha256 = sha256Hex(content)
      artifact.bytes = content.length
      artifact.bodyStartLine = content
        .subarray(0, headerBytes)
        .toString('utf8')
        .split('\n').length
      const fileName = this.fileName(artifact.id)
      const data: ArtifactReservation = {
        artifact,
        actor: { ...actor },
        fileName,
        tempName: `${fileName}.${randomUUID()}.tmp`
      }
      const created: ArtifactOperation = {
        requestId: input.requestId,
        payloadHash,
        artifactId: artifact.id,
        kind: 'create',
        data,
        state: 'pending'
      }
      this.catalog.reserve(created, now)
      this.catalog.claim(
        input.requestId,
        this.owner,
        this.now(),
        OPERATION_LEASE_MS
      )
      return created
    })
    if (operation.state === 'committed') {
      this.files.verify(
        operation.data.fileName,
        operation.data.artifact.sha256,
        operation.data.artifact.bytes
      )
      return operation.data.artifact
    }
    this.checkpoint('reserved', operation.data)
    const content = this.document(operation.data.artifact, input.body)
    if (sha256Hex(content) !== operation.data.artifact.sha256) {
      throw new ArtifactIntegrityError(
        'Reserved artifact content cannot be reproduced.'
      )
    }
    return this.finish(operation, content)
  }

  private checkReplay(operation: ArtifactOperation, payloadHash: string): void {
    if (operation.payloadHash !== payloadHash) {
      throw new ArtifactConflictError(
        'Request identifier was already used for a different operation.'
      )
    }
    if (operation.state === 'failed') {
      throw new ArtifactIntegrityError(
        'Artifact operation failed; inspect storage diagnostics.'
      )
    }
  }

  private checkpoint(
    phase: ArtifactCheckpoint,
    data: ArtifactReservation
  ): void {
    this.options.checkpoint?.(phase, data)
  }

  private finish(operation: ArtifactOperation, supplied?: Buffer): Artifact {
    const data = operation.data
    const { artifact } = data
    this.catalog.assertOwner(operation.requestId, this.owner, this.now())
    const final = this.files.read(data.fileName)
    if (final) {
      this.files.verify(data.fileName, artifact.sha256, artifact.bytes)
      this.files.syncFile(data.fileName)
    } else {
      const temp = this.files.read(data.tempName)
      if (
        !temp ||
        temp.length !== artifact.bytes ||
        sha256Hex(temp) !== artifact.sha256
      ) {
        if (!supplied) {
          throw new ArtifactInputError(
            'Artifact content must be supplied again.'
          )
        }
        this.catalog.assertOwner(operation.requestId, this.owner, this.now())
        if (temp) this.files.removeTemp(data.tempName)
        this.files.writeTemp(data.tempName, supplied)
      }
      this.checkpoint('temp_synced', data)
      this.catalog.assertOwner(operation.requestId, this.owner, this.now())
      this.files.publish(
        data.tempName,
        data.fileName,
        artifact.sha256,
        artifact.bytes
      )
    }
    this.checkpoint('published', data)
    this.checkpoint('before_commit', data)
    this.catalog.transaction(() => {
      this.catalog.assertOwner(operation.requestId, this.owner, this.now())
      this.files.verify(data.fileName, artifact.sha256, artifact.bytes)
      this.catalog.insertArtifact(data)
      this.catalog.appendMetadata(
        artifact,
        operation.requestId,
        data.actor,
        'created'
      )
      this.catalog.transition(
        operation.requestId,
        'committed',
        new Date(this.now()).toISOString()
      )
      this.catalog.release(operation.requestId, this.owner)
    })
    this.checkpoint('after_commit', data)
    this.files.removeTemp(data.tempName)
    this.pollChanges()
    return artifact
  }

  recover(cleanupCommitted = true): {
    recovered: string[]
    awaitingRetry: string[]
    failed: string[]
    busy: string[]
  } {
    const result = {
      recovered: [] as string[],
      awaitingRetry: [] as string[],
      failed: [] as string[],
      busy: [] as string[]
    }
    const failures: Error[] = []
    for (const operation of this.catalog.operations(cleanupCommitted)) {
      try {
        this.recoverOne(operation, result)
      } catch (error) {
        // One failed operation must not block the operations after it.
        const cause = error instanceof Error ? error : new Error(String(error))
        failures.push(
          new Error(
            `Artifact operation ${operation.requestId}: ${cause.message}`,
            {
              cause
            }
          )
        )
      }
    }
    if (failures.length === 1) throw failures[0].cause
    if (failures.length > 1) {
      throw new AggregateError(
        failures.map(failure => failure.cause),
        failures.map(failure => failure.message).join('; ')
      )
    }
    return result
  }

  private recoverOne(
    listed: ArtifactOperation,
    result: Record<'recovered' | 'awaitingRetry' | 'failed' | 'busy', string[]>
  ): void {
    let operation = listed
    if (operation.state === 'failed') {
      result.failed.push(operation.artifactId)
      return
    }
    if (operation.state === 'committed') {
      this.files.removeTemp(operation.data.tempName)
      return
    }
    try {
      operation = this.catalog.transaction(() => {
        const current = this.catalog.operation(operation.requestId)!
        if (current.state !== 'committed' && current.state !== 'failed') {
          this.catalog.claim(
            current.requestId,
            this.owner,
            this.now(),
            OPERATION_LEASE_MS
          )
        }
        return current
      })
      if (operation.state === 'committed' || operation.state === 'failed') {
        return
      }
    } catch (error) {
      if (!(error instanceof ArtifactConflictError)) throw error
      result.busy.push(operation.artifactId)
      return
    }
    try {
      this.finish(operation)
      result.recovered.push(operation.artifactId)
    } catch (error) {
      if (this.catalog.operation(operation.requestId)?.state === 'committed') {
        throw error
      }
      if (
        !(error instanceof ArtifactInputError) &&
        !(error instanceof ArtifactIntegrityError)
      ) {
        try {
          this.catalog.release(operation.requestId, this.owner)
        } catch {
          // The original failure is the useful one; the lease expires by itself.
        }
        throw error
      }
      const state =
        error instanceof ArtifactInputError ? 'awaiting_retry' : 'failed'
      this.catalog.transaction(() => {
        this.catalog.assertOwner(operation.requestId, this.owner, this.now())
        if (operation.state !== state) {
          this.catalog.transition(
            operation.requestId,
            state,
            new Date(this.now()).toISOString()
          )
        }
        this.catalog.release(operation.requestId, this.owner)
      })
      result[state === 'awaiting_retry' ? 'awaitingRetry' : 'failed'].push(
        operation.artifactId
      )
    }
  }

  diagnostics(): {
    orphanFiles: string[]
    operations: { artifactId: string; state: string }[]
  } {
    const operations = this.catalog.operations()
    const known = new Set(
      operations.flatMap(operation => [
        operation.data.fileName,
        operation.data.tempName
      ])
    )
    return {
      orphanFiles: this.files.names().filter(name => !known.has(name)),
      operations: operations.map(operation => ({
        artifactId: operation.artifactId,
        state: operation.state
      }))
    }
  }

  get(id: string): Artifact {
    this.fileName(id)
    const artifact = this.catalog.get(id)
    if (!artifact) throw new ArtifactNotFoundError()
    return artifact
  }

  readContent(
    id: string,
    offset = 0,
    limit = MAX_ARTIFACT_CHUNK_BYTES
  ): ArtifactContent {
    const artifact = this.get(id)
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isInteger(limit) ||
      limit < 4 ||
      limit > MAX_ARTIFACT_CHUNK_BYTES
    ) {
      throw new ArtifactInputError('Invalid content range.')
    }
    const content = this.files.verify(
      this.fileName(id),
      artifact.sha256,
      artifact.bytes
    )
    if (
      offset > content.length ||
      (offset < content.length && (content[offset] & 0xc0) === 0x80)
    ) {
      throw new ArtifactInputError('Content offset must be a UTF-8 boundary.')
    }
    let end = Math.min(offset + limit, content.length)
    while (end < content.length && (content[end] & 0xc0) === 0x80) end--
    return {
      storeId: this.storeId,
      id,
      sha256: artifact.sha256,
      bodyStartLine: artifact.bodyStartLine,
      totalBytes: content.length,
      offset,
      nextOffset: end < content.length ? end : null,
      text: content.subarray(offset, end).toString('utf8')
    }
  }

  list(limit = 50, cursor?: string): ArtifactList {
    return this.catalog.readSnapshot(() => this.listSnapshot(limit, cursor))
  }

  private listSnapshot(limit: number, cursor?: string): ArtifactList {
    this.assertLimit(limit)
    const epoch = this.catalog.epoch()
    let after: { createdAt: string; id: string } | undefined
    if (cursor) {
      let decoded: {
        storeId?: unknown
        epoch?: unknown
        createdAt?: unknown
        id?: unknown
      }
      try {
        decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
      } catch {
        throw new ArtifactInputError('Invalid artifact cursor.')
      }
      if (
        !decoded ||
        decoded.storeId !== this.storeId ||
        typeof decoded.createdAt !== 'string' ||
        !isUuid(decoded.id)
      ) {
        throw new ArtifactInputError('Invalid artifact cursor.')
      }
      if (decoded.epoch !== epoch) {
        throw new ArtifactConflictError(
          'Artifact catalog changed. Restart pagination.'
        )
      }
      after = { createdAt: decoded.createdAt, id: decoded.id }
    }
    const rows = this.catalog.list(limit + 1, after)
    const items = rows.slice(0, limit)
    const last = items.at(-1)
    const nextCursor =
      rows.length > limit && last
        ? Buffer.from(
            JSON.stringify({
              storeId: this.storeId,
              epoch,
              createdAt: last.createdAt,
              id: last.id
            })
          ).toString('base64url')
        : null
    return { storeId: this.storeId, storeEpoch: epoch, items, nextCursor }
  }

  history(id: string, afterSeq = 0, limit = 50): ArtifactHistory {
    this.get(id)
    this.assertLimit(limit)
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) {
      throw new ArtifactInputError('Invalid history sequence.')
    }
    const rows = this.catalog.history(id, afterSeq, limit + 1)
    const items = rows.slice(0, limit)
    return {
      storeId: this.storeId,
      items,
      nextAfterSeq: rows.length > limit ? items.at(-1)!.seq : null
    }
  }

  updateMetadata(
    id: string,
    input: {
      requestId: string
      expectedVersion: number
      metadata: ArtifactMetadataInput
    },
    suppliedActor: ArtifactActor
  ): Artifact {
    this.validate(input.requestId, input.metadata, suppliedActor)
    const actor = canonicalActor(suppliedActor)
    this.fileName(id)
    if (
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 1
    ) {
      throw new ArtifactInputError('Invalid metadata version.')
    }
    const payloadHash = sha256Hex(
      JSON.stringify({
        kind: 'metadata',
        id,
        expectedVersion: input.expectedVersion,
        title: input.metadata.title,
        tags: input.metadata.tags,
        actor
      })
    )
    const result = this.catalog.transaction(() => {
      const existing = this.catalog.operation(input.requestId)
      if (existing) {
        this.checkReplay(existing, payloadHash)
        return existing.data.artifact
      }
      const previous = this.get(id)
      if (previous.metadataVersion !== input.expectedVersion) {
        throw new ArtifactConflictError('Artifact metadata version changed.')
      }
      this.files.verify(this.fileName(id), previous.sha256, previous.bytes)
      const updated: Artifact = {
        ...previous,
        title: input.metadata.title,
        tags: [...input.metadata.tags],
        metadataVersion: previous.metadataVersion + 1,
        metadataUpdatedAt: new Date(this.now()).toISOString()
      }
      this.catalog.reserve(
        {
          requestId: input.requestId,
          kind: 'metadata',
          payloadHash,
          artifactId: id,
          data: {
            artifact: updated,
            actor,
            fileName: this.fileName(id),
            tempName: ''
          }
        },
        updated.metadataUpdatedAt
      )
      this.catalog.appendMetadata(
        updated,
        input.requestId,
        actor,
        'metadata_updated'
      )
      this.catalog.transition(
        input.requestId,
        'committed',
        updated.metadataUpdatedAt
      )
      return updated
    })
    this.pollChanges()
    return result
  }

  private assertLimit(limit: number): void {
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > MAX_ARTIFACT_PAGE_SIZE
    ) {
      throw new ArtifactInputError('Invalid page size.')
    }
  }

  pollChanges(): void {
    const epoch = this.catalog.epoch()
    if (epoch === this.observedEpoch) return
    this.observedEpoch = epoch
    this.options.eventBus?.publish({
      type: 'artifacts:changed',
      storeId: this.storeId,
      storeEpoch: epoch
    })
  }
}
