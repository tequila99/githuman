import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { Value } from '@sinclair/typebox/value'
import type {
  ArtifactActor,
  ArtifactAuthorizationRequest,
  ArtifactChangeSetProposal,
  ArtifactLifecycleCommit
} from '../../shared/artifacts/types.ts'
import {
  ArtifactChangeSetProposeBody,
  ArtifactAuthorizationRequestBody,
  ArtifactLifecycleCommitBody
} from '../../shared/artifacts/schemas.ts'
import { canonicalJson } from '../../shared/utils/canonical-json.ts'
import { sha256Hex } from '../utils/hash.ts'
import {
  ArtifactConflictError,
  ArtifactInputError
} from '../errors/artifacts.ts'
import type { ArtifactStorageService } from './artifact-storage.service.ts'
import {
  canonicalChangeSet,
  previewArtifactChangeSet
} from './artifact-graph-validation.ts'
import {
  ArtifactValidationRepository,
  type StoredChangeSet,
  type StoredValidation,
  type ValidationManifest
} from '../repositories/artifact-validation.repo.ts'
import { ArtifactReviewRepository } from '../repositories/artifact-review.repo.ts'
import { reviewSources, isReviewThreadOpen } from './artifact-review-scope.ts'
import {
  ArtifactAuthorizationService,
  artifactActionDigest
} from './artifact-authorization.service.ts'
import type { AgentSessionRegistry } from './agent/session-registry.ts'
import { ArtifactValidationJobsService } from './artifact-validation-jobs.service.ts'

// Manifest changes invalidate all earlier semantic conclusions.
const VALIDATION_RULES_VERSION = 1

export function artifactSessionId(actor: ArtifactActor): string {
  return actor.kind === 'user' ? `user:${actor.id}` : actor.id
}

export class ArtifactLifecycleService {
  readonly repository: ArtifactValidationRepository
  readonly authorization: ArtifactAuthorizationService
  readonly jobs: ArtifactValidationJobsService
  private readonly reviews: ArtifactReviewRepository
  private registry?: AgentSessionRegistry

  readonly storage: ArtifactStorageService
  readonly now: () => number
  constructor(
    storage: ArtifactStorageService,
    db: DatabaseSync,
    now: () => number = Date.now
  ) {
    this.storage = storage
    this.now = now
    this.repository = new ArtifactValidationRepository(db, storage.storeId)
    this.reviews = new ArtifactReviewRepository(db, storage.catalog)
    this.authorization = new ArtifactAuthorizationService(
      this.repository,
      now,
      action => this.checkAction(action),
      id =>
        id.startsWith('user:') ||
        Boolean(
          this.registry?.get(id) && this.registry.get(id)!.status !== 'closed'
        ),
      () => this.registry?.notifyArtifactActionsChanged?.()
    )
    this.jobs = new ArtifactValidationJobsService(this, now)
  }
  attachSessions(registry: AgentSessionRegistry): void {
    this.registry = registry
    this.jobs.attachSessions(registry)
  }

  propose(
    input: ArtifactChangeSetProposal,
    actor: ArtifactActor
  ): StoredChangeSet {
    if (
      !Value.Check(ArtifactChangeSetProposeBody, input) ||
      !input.changeSet.reason.trim()
    ) {
      throw new ArtifactInputError('Invalid change set proposal.')
    }
    if (Buffer.byteLength(JSON.stringify(input.changeSet)) > 48 * 1024) {
      throw new ArtifactInputError(
        'Change set exceeds the bounded proposal size.'
      )
    }
    return this.storage.catalog.transaction(() => {
      const changeDigest = artifactActionDigest(
        canonicalChangeSet(input.changeSet)
      )
      const requestDigest = artifactActionDigest({
        id: input.id ?? null,
        expectedVersion: input.expectedVersion ?? null,
        changeDigest,
        actor
      })
      const replay = this.repository.proposalRequest(input.requestId)
      if (replay) {
        if (
          replay.requestDigest !== requestDigest ||
          canonicalJson(replay.actor) !== canonicalJson(actor) ||
          (input.id && replay.id !== input.id)
        ) {
          throw new ArtifactConflictError('Proposal request ID was reused.')
        }
        return replay
      }
      const preview = this.preview(input.changeSet)
      if (preview.errors.length) {
        throw new ArtifactInputError(
          preview.errors.map(item => item.message).join(' ')
        )
      }
      const previous = input.id ? this.repository.proposal(input.id) : undefined
      if (
        (previous && previous.version !== input.expectedVersion) ||
        (!previous && input.expectedVersion)
      ) {
        throw new ArtifactConflictError('Change set version changed.')
      }
      const proposal = {
        id: previous?.id ?? randomUUID(),
        version: (previous?.version ?? 0) + 1,
        requestId: input.requestId,
        requestDigest,
        actor,
        changeSet: preview.canonical,
        changeDigest: preview.changeDigest
      }
      this.repository.appendProposal(proposal)
      return proposal
    })
  }
  reviewSnapshot(id: string) {
    return this.reviews.get(id)
  }
  get(id: string) {
    return this.repository.proposal(id)
  }
  preview(changeSet: StoredChangeSet['changeSet']) {
    return previewArtifactChangeSet(
      this.storage.catalog.all(),
      changeSet,
      this.storage.catalog.supersededArtifactIds()
    )
  }
  prepare(changeSetId: string, version: number): StoredValidation {
    return this.storage.catalog.transaction(() => {
      const proposal = this.repository.proposal(changeSetId)
      if (proposal.version !== version) {
        throw new ArtifactConflictError('Change set version changed.')
      }
      const manifest = this.manifest(proposal)
      const value: StoredValidation = {
        id: randomUUID(),
        changeSetId,
        version,
        manifest,
        manifestDigest: artifactActionDigest(manifest),
        state: 'prepared',
        validatorSessionId: null,
        owner: null,
        expiresAt: null
      }
      this.repository.appendValidation(value)
      return value
    })
  }
  private manifest(proposal: StoredChangeSet): ValidationManifest {
    const preview = this.preview(proposal.changeSet)
    if (preview.errors.length) {
      throw new ArtifactConflictError(
        preview.errors.map(item => item.message).join(' ')
      )
    }
    const artifacts = preview.affectedIds.map(
      id => this.storage.readVerifiedFile(id).artifact
    )
    const threads = this.reviews.getThreadsByOrigins(
      new Set(preview.affectedIds)
    )
    return {
      rulesVersion: VALIDATION_RULES_VERSION,
      validationEpoch: this.storage.catalog.validationEpoch(),
      changeDigest: proposal.changeDigest,
      changeSet: proposal.changeSet,
      artifacts,
      requiredContentIds: artifacts.map(item => item.id),
      threads: threads.map(item => ({
        threadId: item.threadId,
        version: item.version
      }))
    }
  }
  assertFresh(validation: StoredValidation): StoredChangeSet {
    const proposal = this.repository.proposal(validation.changeSetId)
    if (
      proposal.version !== validation.version ||
      artifactActionDigest(this.manifest(proposal)) !==
        validation.manifestDigest
    ) {
      throw new ArtifactConflictError(
        'VALIDATION_STALE: manifest changed; prepare a new validation.'
      )
    }
    return proposal
  }
  checkAction(action: ArtifactAuthorizationRequest) {
    if (!Value.Check(ArtifactAuthorizationRequestBody, action)) {
      throw new ArtifactInputError('Invalid authorization action.')
    }
    if (action.kind === 'lifecycle') {
      const validation = this.repository.validation(action.validationId)
      const proposal = this.assertFresh(validation)
      if (
        validation.state !== 'pass' ||
        proposal.id !== action.changeSetId ||
        proposal.version !== action.version
      ) {
        throw new ArtifactConflictError(
          'A fresh matching validation pass is required.'
        )
      }
      this.assertNoBlockers(proposal)
      return {
        actionDigest: proposal.changeDigest,
        manifestDigest: validation.manifestDigest
      }
    }
    const thread = this.reviews.get(action.threadId)
    if (
      !thread ||
      thread.version !== action.input.expectedThreadVersion ||
      !reviewSources(
        action.input.scope.appliesToArtifactId,
        this.storage
      ).origins.has(thread.originArtifactId)
    ) {
      throw new ArtifactConflictError(
        'Review action version or scope is stale.'
      )
    }
    return { actionDigest: artifactActionDigest(action), manifestDigest: null }
  }
  private assertNoBlockers(proposal: StoredChangeSet): void {
    if (proposal.changeSet.command !== 'accept') return
    const post = new Map(
      this.preview(proposal.changeSet).postState.map(item => [item.id, item])
    )
    for (const id of proposal.changeSet.subjectIds) {
      const view = {
        get: (nodeId: string) => post.get(nodeId) ?? this.storage.get(nodeId),
        graphRepository: this.storage.graphRepository
      }
      const sources = reviewSources(id, view)
      const currentSources = reviewSources(id, this.storage)
      if (
        this.reviews
          .getThreadsByOrigins(currentSources.origins)
          .some(
            thread =>
              thread.blocking && isReviewThreadOpen(thread, currentSources)
          )
      ) {
        throw new ArtifactConflictError(
          'Open blocking review threads prevent acceptance.'
        )
      }
      if (
        this.reviews
          .getThreadsByOrigins(sources.origins)
          .some(
            thread => thread.blocking && isReviewThreadOpen(thread, sources)
          )
      ) {
        throw new ArtifactConflictError(
          'Open blocking review threads prevent acceptance.'
        )
      }
    }
  }
  commit(id: string, input: ArtifactLifecycleCommit, actor: ArtifactActor) {
    if (!Value.Check(ArtifactLifecycleCommitBody, input)) {
      throw new ArtifactInputError('Invalid commit request.')
    }
    const payloadHash = sha256Hex(canonicalJson({ id, input, actor }))
    const result = this.storage.catalog.transaction(() => {
      const replay = this.repository.commitRequest(input.requestId)
      if (replay) {
        if (replay.payloadHash !== payloadHash) {
          throw new ArtifactConflictError('Commit request ID was reused.')
        }
        return replay.result
      }
      const action: ArtifactAuthorizationRequest = {
        kind: 'lifecycle',
        changeSetId: id,
        version: input.version,
        validationId: input.validationId
      }
      this.authorization.assert(
        input.authorizationId,
        artifactSessionId(actor),
        action
      )
      const proposal = this.repository.proposal(id)
      const preview = this.preview(proposal.changeSet)
      if (preview.errors.length) {
        throw new ArtifactConflictError('Change set post-state is invalid.')
      }
      const updated = []
      for (const node of preview.postState) {
        const previous = this.storage.get(node.id)
        if (canonicalJson(node) === canonicalJson(previous)) continue
        const next = {
          ...node,
          metadataVersion: previous.metadataVersion + 1,
          metadataUpdatedAt: new Date(this.now()).toISOString()
        }
        this.storage.catalog.appendMetadata(
          next,
          `lifecycle:${sha256Hex(canonicalJson([input.requestId, node.id]))}`,
          actor,
          'metadata_updated'
        )
        updated.push({ id: next.id, metadataVersion: next.metadataVersion })
      }
      this.authorization.consume(input.authorizationId)
      const value = {
        storeId: this.storage.storeId,
        changeSetId: id,
        version: input.version,
        affectedIds: updated.map(item => item.id),
        metadataVersions: updated,
        includedIn: preview.includedIn,
        storeEpoch: this.storage.catalog.epoch()
      }
      const eventSeq = this.repository.appendCommit(
        input.requestId,
        payloadHash,
        value
      )
      return { ...value, eventSeq }
    })
    this.storage.pollChanges()
    return result
  }
  executeReview(
    action: Extract<ArtifactAuthorizationRequest, { kind: 'review' }>,
    authorizationId: string,
    actor: ArtifactActor
  ) {
    const result = this.storage.catalog.transaction(() => {
      const replay = this.reviews.request(action.input.requestId)
      // Review event idempotency checks the exact action and actor before returning.
      if (replay) {
        const expectedPayload =
          action.input.kind === 'blocking_changed'
            ? {
                kind: action.input.kind,
                blocking: action.input.blocking,
                scope: action.input.scope
              }
            : { kind: action.input.kind, scope: action.input.scope }
        if (
          replay.threadId !== action.threadId ||
          replay.expectedThreadVersion !== action.input.expectedThreadVersion ||
          canonicalJson(replay.actor) !== canonicalJson(actor) ||
          canonicalJson(replay.payload) !== canonicalJson(expectedPayload)
        ) {
          throw new ArtifactConflictError('Review request ID was reused.')
        }
        return replay
      }
      this.authorization.assert(
        authorizationId,
        artifactSessionId(actor),
        action
      )
      const thread = this.reviews.get(action.threadId)!
      const payload =
        action.input.kind === 'blocking_changed'
          ? {
              kind: action.input.kind,
              blocking: action.input.blocking,
              scope: action.input.scope
            }
          : { kind: action.input.kind, scope: action.input.scope }
      const event = this.reviews.append(action.input.requestId, {
        threadId: action.threadId,
        originArtifactId: thread.originArtifactId,
        expectedThreadVersion: action.input.expectedThreadVersion,
        actor,
        createdAt: new Date(this.now()).toISOString(),
        payload
      })
      this.authorization.consume(authorizationId)
      return event
    })
    this.storage.pollChanges()
    return result
  }
}
