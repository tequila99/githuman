import { errorMessage } from '../../shared/utils/error-message.ts'
import type {
  ArtifactActionInspection,
  ArtifactActionListItem,
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
  graphIssuesMessage,
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
const VALIDATION_RULES_VERSION = 3
// The server is the author of a proposal version that only follows the grown set (ADR 0121).
const REBASE_ACTOR: ArtifactActor = { kind: 'system', id: 'validation-rebase' }
// Preview errors that a rebase can fix: they only name versions of the set context.
const REBASE_CODES = new Set(['missing_expected_version', 'stale_version'])
// The reason in the request list is cut to this length; the full text stays in the proposal.
const ACTION_REASON_CHARS = 300

export function artifactSessionId(actor: ArtifactActor): string {
  return actor.kind === 'user' ? `user:${actor.id}` : actor.id
}

/**
 * The digest covers the affected set, not the store epoch. A store change outside
 * the set does not make a running validation stale (ADR 0119).
 */
function setDigest(manifest: ValidationManifest): string {
  const { validationEpoch: _epoch, ...content } = manifest
  return artifactActionDigest(content)
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
        graphIssuesMessage(preview.errors, preview.expectedVersions)
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
  /** The pending requests, each with a short summary so the user can tell them apart. */
  listActions(): ArtifactActionListItem[] {
    return this.storage.catalog.readSnapshot(() =>
      this.authorization.list().map(pending => {
        try {
          const { changeSet } = this.repository.proposalVersion(
            pending.action.changeSetId,
            pending.action.version
          )
          return {
            ...pending,
            summary: {
              command: changeSet.command,
              reason: changeSet.reason.slice(0, ACTION_REASON_CHARS),
              documentCount: changeSet.targetStatuses.length
            }
          }
        } catch {
          // A proposal that cannot be read must not hide the request itself.
          return { ...pending, summary: null }
        }
      })
    )
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
      manifestDigest: setDigest(manifest),
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
        graphIssuesMessage(preview.errors, preview.expectedVersions)
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
  /**
   * Gives the next proposal version and manifest of a running validation when only
   * the context of its set changed (ADR 0121). The caller owns the transaction.
   * Returns undefined when the change needs a decision of the proposal author.
   */
  rebaseInTransaction(validation: StoredValidation):
    | {
        proposal: StoredChangeSet
        manifest: ValidationManifest
        digest: string
      }
    | undefined {
    const proposal = this.repository.proposal(validation.changeSetId)
    if (
      proposal.version !== validation.version ||
      validation.manifest.rulesVersion !== VALIDATION_RULES_VERSION
    ) {
      return undefined
    }
    const subjects = new Set(proposal.changeSet.subjectIds)
    const preview = this.preview(proposal.changeSet)
    const decided = proposal.changeSet.supplementDispositions
      .map(item => item.artifactId)
      .sort()
    if (
      !preview.errors.every(
        issue =>
          REBASE_CODES.has(issue.code) &&
          issue.artifactIds.every(id => !subjects.has(id))
      ) ||
      canonicalJson(preview.requiredSupplementDispositions) !==
        canonicalJson(decided)
    ) {
      return undefined
    }
    const command = proposal.changeSet.command
    // A historical command has no current proposal form; its validation stays stale.
    if (command === 'submit_review') {
      return undefined
    }
    let next = proposal
    if (preview.errors.length) {
      next = this.proposeInTransaction(
        {
          requestId: `validation-rebase:${validation.id}:${proposal.version}`,
          id: proposal.id,
          expectedVersion: proposal.version,
          changeSet: {
            ...proposal.changeSet,
            command,
            expectedVersions: preview.expectedVersions
          }
        },
        REBASE_ACTOR
      )
    }
    const manifest = this.manifest(next)
    return { proposal: next, manifest, digest: setDigest(manifest) }
  }
  assertFresh(validation: StoredValidation): StoredChangeSet {
    const proposal = this.repository.proposal(validation.changeSetId)
    let digest: string | undefined
    try {
      digest = setDigest(this.manifest(proposal))
    } catch (error) {
      // A store change can make the change set invalid, for example a new accepted
      // artifact without tasks. That is staleness too, so the caller sees one error.
      if (!(error instanceof ArtifactConflictError)) {
        throw error
      }
      throw new ArtifactConflictError(
        `VALIDATION_STALE: manifest changed (${error.message}); prepare a new validation.`
      )
    }
    if (
      validation.manifest.rulesVersion !== VALIDATION_RULES_VERSION ||
      proposal.version !== validation.version ||
      digest !== validation.manifestDigest
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
