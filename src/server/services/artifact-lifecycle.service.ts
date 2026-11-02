import { errorMessage } from '../../shared/utils/error-message.ts'
import type {
  ArtifactActionInspection,
  ArtifactValidationInspection
} from '../../shared/artifacts/types.ts'
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
import { HEARTBEAT_STALE_MS } from '../../shared/artifact-transitions/constants.ts'
import { hasErrorCode } from '../utils/system-error.ts'
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
import {
  ArtifactAuthorizationService,
  artifactActionDigest
} from './artifact-authorization.service.ts'
import type { AgentSessionRegistry } from './agent/session-registry.ts'
import { ArtifactValidationJobsService } from './artifact-validation-jobs.service.ts'
import { ArtifactTransitionRepository } from '../repositories/artifact-transition.repo.ts'
import { ArtifactTransitionService } from './artifact-transition.service.ts'

// Manifest changes invalidate all earlier semantic conclusions.
const VALIDATION_RULES_VERSION = 2

export function artifactSessionId(actor: ArtifactActor): string {
  return actor.kind === 'user' ? `user:${actor.id}` : actor.id
}

export class ArtifactLifecycleService {
  readonly repository: ArtifactValidationRepository
  readonly authorization: ArtifactAuthorizationService
  readonly jobs: ArtifactValidationJobsService
  readonly transitions: ArtifactTransitionService
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
    this.transitions = new ArtifactTransitionService(
      this,
      new ArtifactTransitionRepository(db, storage.storeId),
      now
    )
  }
  /**
   * True when the process of `owner` exists and its heartbeat is fresh. A
   * missing heartbeat counts as alive, so old data keeps its behavior. The own
   * instance is always alive (ADR 0108).
   */
  ownerAlive(owner: string, pid: number): boolean {
    if (owner === this.jobs.ownerId) {
      return true
    }
    try {
      process.kill(pid, 0)
    } catch (error) {
      if (hasErrorCode(error, 'ESRCH')) {
        return false
      }
    }
    const beat = this.repository.heartbeat(owner)
    return beat === undefined || this.now() - beat <= HEARTBEAT_STALE_MS
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
    return this.storage.catalog.transaction(() =>
      this.proposeInTransaction(input, actor)
    )
  }
  /** Proposes inside a transaction owned by the caller. */
  proposeInTransaction(
    input: ArtifactChangeSetProposal,
    actor: ArtifactActor
  ): StoredChangeSet {
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
  }
  inspectValidation(id: string): ArtifactValidationInspection {
    return this.storage.catalog.readSnapshot(() => {
      const validation = this.jobs.get(id)
      const proposal = this.repository.proposalVersion(
        validation.changeSetId,
        validation.version
      )
      const preview = this.preview(proposal.changeSet)
      let ready = false
      let problem: string | null = null
      try {
        this.checkAction({
          kind: 'lifecycle',
          changeSetId: proposal.id,
          version: proposal.version,
          validationId: id
        })
        ready = true
      } catch (error) {
        problem = errorMessage(error)
      }
      return {
        storeId: this.storage.storeId,
        validation,
        proposal,
        preview,
        ready,
        problem
      }
    })
  }
  inspectAction(id: string, actor: ArtifactActor): ArtifactActionInspection {
    return this.storage.catalog.readSnapshot(() => {
      const value = this.authorization.describe(id)
      const action = value.pending.action
      const proposal = this.repository.proposalVersion(
        action.changeSetId,
        action.version
      )
      const validation = this.jobs.get(action.validationId)
      const preview = this.preview(proposal.changeSet)
      let ready = false
      let problem: string | null = null
      if (value.phase !== 'consumed') {
        try {
          const binding = this.checkAction(action)
          if (
            binding.actionDigest !== value.pending.actionDigest ||
            binding.manifestDigest !== value.pending.manifestDigest
          ) {
            throw new ArtifactConflictError('Action scope changed.')
          }
          ready = true
        } catch (error) {
          problem = errorMessage(error)
        }
      }
      const canExecute = value.pending.sessionId === artifactSessionId(actor)
      // Project only the original request fields; grants also hold private audit bindings.
      const {
        id: pendingId,
        sessionId,
        action: pendingAction,
        actionDigest,
        manifestDigest,
        expiresAt
      } = value.pending
      return {
        storeId: this.storage.storeId,
        pending: {
          id: pendingId,
          sessionId,
          action: pendingAction,
          actionDigest,
          manifestDigest,
          expiresAt
        },
        phase: value.phase,
        canExecute,
        ready,
        problem,
        proposal,
        validation,
        preview,
        authorizationId: canExecute ? value.authorizationId : null
      }
    })
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
    return this.storage.catalog.transaction(() =>
      this.prepareInTransaction(changeSetId, version)
    )
  }
  /** Prepares inside a transaction owned by the caller. */
  prepareInTransaction(changeSetId: string, version: number): StoredValidation {
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
    return {
      rulesVersion: VALIDATION_RULES_VERSION,
      validationEpoch: this.storage.catalog.validationEpoch(),
      changeDigest: proposal.changeDigest,
      changeSet: proposal.changeSet,
      artifacts,
      requiredContentIds: artifacts.map(item => item.id)
    }
  }
  assertFresh(validation: StoredValidation): StoredChangeSet {
    const proposal = this.repository.proposal(validation.changeSetId)
    if (
      validation.manifest.rulesVersion !== VALIDATION_RULES_VERSION ||
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
    return {
      actionDigest: proposal.changeDigest,
      manifestDigest: validation.manifestDigest
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
      const value = this.applyChangeSet(
        id,
        input.version,
        input.requestId,
        payloadHash,
        actor
      )
      this.authorization.consume(input.authorizationId)
      return value
    })
    this.storage.pollChanges()
    return result
  }
  /**
   * Commits a proposal on the strength of a stored prior consent instead of a
   * session grant. The caller checks the consent; `inTransaction` writes the
   * consumption and the operation result atomically with the status changes.
   */
  commitConfirmed(
    input: {
      changeSetId: string
      version: number
      validationId: string
      requestId: string
    },
    actor: ArtifactActor,
    inTransaction: () => void
  ) {
    const payloadHash = sha256Hex(canonicalJson({ input, actor }))
    const result = this.storage.catalog.transaction(() => {
      const replay = this.repository.commitRequest(input.requestId)
      if (replay) {
        if (replay.payloadHash !== payloadHash) {
          throw new ArtifactConflictError('Commit request ID was reused.')
        }
        return replay.result
      }
      this.checkAction({
        kind: 'lifecycle',
        changeSetId: input.changeSetId,
        version: input.version,
        validationId: input.validationId
      })
      const value = this.applyChangeSet(
        input.changeSetId,
        input.version,
        input.requestId,
        payloadHash,
        actor
      )
      inTransaction()
      return value
    })
    this.storage.pollChanges()
    return result
  }
  private applyChangeSet(
    id: string,
    version: number,
    requestId: string,
    payloadHash: string,
    actor: ArtifactActor
  ) {
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
        `lifecycle:${sha256Hex(canonicalJson([requestId, node.id]))}`,
        actor,
        'metadata_updated'
      )
      updated.push({ id: next.id, metadataVersion: next.metadataVersion })
    }
    const value = {
      storeId: this.storage.storeId,
      changeSetId: id,
      version,
      affectedIds: updated.map(item => item.id),
      metadataVersions: updated,
      includedIn: preview.includedIn,
      storeEpoch: this.storage.catalog.epoch()
    }
    const eventSeq = this.repository.appendCommit(requestId, payloadHash, value)
    return { ...value, eventSeq }
  }
}
