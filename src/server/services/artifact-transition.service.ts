import { randomUUID } from 'node:crypto'
import { Value } from '@sinclair/typebox/value'
import { errorMessage } from '../../shared/utils/error-message.ts'
import { canonicalJson } from '../../shared/utils/canonical-json.ts'
import type {
  ArtifactActor,
  ArtifactChangeSet
} from '../../shared/artifacts/types.ts'
import { ArtifactChangeSetSchema } from '../../shared/artifacts/schemas.ts'
import type {
  ArtifactTransitionOperation,
  ArtifactTransitionOperationList,
  ArtifactTransitionOptions,
  ArtifactTransitionPreview,
  ArtifactTransitionStartInput
} from '../../shared/artifact-transitions/types.ts'
import {
  HEARTBEAT_STALE_MS,
  TRANSITION_CONSENT_TTL_MS,
  TRANSITION_PREVIEW_TTL_MS
} from '../../shared/artifact-transitions/constants.ts'
import {
  isTerminalTransitionStage,
  transitionCommand,
  userTransitionTargets
} from '../../shared/artifact-transitions/transitions.ts'
import { sha256Hex } from '../utils/hash.ts'
import {
  ArtifactConflictError,
  ArtifactInputError,
  artifactLeaseBusyError,
  isArtifactBusyError,
  isArtifactLeaseBusyError,
  ArtifactNotFoundError
} from '../errors/artifacts.ts'
import {
  ArtifactTransitionRepository,
  type StoredTransition
} from '../repositories/artifact-transition.repo.ts'
import type { ArtifactLifecycleService } from './artifact-lifecycle.service.ts'
import { graphIssuesMessage } from './artifact-graph-validation.ts'

// Reconcile cadence; other processes cannot call this process, so it polls.
const RECONCILE_INTERVAL_MS = 1000
// Memory bound for unconfirmed previews.
const MAX_PREVIEWS = 200
// Extra time before another process may call a silent owner interrupted.
const OWNER_GRACE_MS = 60_000
// A start that did not reach the validator within this time fails.
const PREPARE_STALL_MS = 10_000
// Heartbeat rows of dead owners are dropped after this time.
const HEARTBEAT_KEEP_MS = 60 * 60_000

interface PreviewRecord {
  id: string
  artifactId: string
  targetStatus: ArtifactTransitionPreview['targetStatus']
  actor: ArtifactActor
  changeSet: ArtifactChangeSet
  changeDigest: string
  view: ArtifactTransitionPreview
}

/**
 * Runs one user-confirmed status change from preview to commit. The server
 * owns the work, so closing the browser does not stop it (ADR 0107).
 */
export class ArtifactTransitionService {
  readonly repository: ArtifactTransitionRepository
  private readonly lifecycle: ArtifactLifecycleService
  private readonly now: () => number
  private isActorActive: (actor: ArtifactActor) => boolean = () => true
  private readonly owner: string
  private readonly previews = new Map<string, PreviewRecord>()
  private onError: (error: unknown) => void = () => {}
  private timer: ReturnType<typeof setInterval> | undefined
  private stopped = false
  private lastBeatError = 0
  private unsubscribe: (() => void) | undefined

  constructor(
    lifecycle: ArtifactLifecycleService,
    repository: ArtifactTransitionRepository,
    now: () => number
  ) {
    this.lifecycle = lifecycle
    this.repository = repository
    this.now = now
    this.owner = lifecycle.jobs.ownerId
  }

  /** Sets the receiver of errors from background work, which has no caller. */
  setErrorHandler(handler: (error: unknown) => void): void {
    this.onError = handler
  }

  private guard(run: () => void): void {
    if (this.stopped) {
      return
    }
    try {
      run()
    } catch (error) {
      this.onError(error)
    }
  }

  /** Sets the check that the confirming actor still has access (device not revoked). */
  setActorGuard(guard: (actor: ArtifactActor) => boolean): void {
    this.isActorActive = guard
  }

  /** Starts listening to validation results; the constructor starts nothing. */
  start(): void {
    this.stopped = false
    this.unsubscribe ??= this.lifecycle.jobs.onSettled(validationId =>
      setImmediate(() => this.guard(() => this.settle(validationId)))
    )
    this.guard(() => this.reconcile())
    this.timer ??= setInterval(
      () => this.guard(() => this.reconcile()),
      RECONCILE_INTERVAL_MS
    )
    this.timer.unref()
  }

  /** Marks own unfinished operations interrupted; it never applies anything. */
  stop(): void {
    this.stopped = true
    clearInterval(this.timer)
    this.timer = undefined
    this.unsubscribe?.()
    this.unsubscribe = undefined
    for (const operation of this.repository.unfinished()) {
      if (operation.owner === this.owner && operation.stage !== 'applying') {
        this.finish(operation.id, 'interrupted', 'Server stopped.')
      }
    }
    try {
      this.lifecycle.repository.forget(this.owner)
    } catch {
      // The row ages out by itself when the database stays busy.
    }
  }

  /** Writes the heartbeat; a failure is reported at most once per stale period. */
  private beat(): void {
    try {
      this.lifecycle.repository.beat(this.owner, this.now(), HEARTBEAT_KEEP_MS)
    } catch (error) {
      if (this.now() - this.lastBeatError > HEARTBEAT_STALE_MS) {
        this.lastBeatError = this.now()
        this.onError(error)
      }
    }
  }

  options(artifactId: string): ArtifactTransitionOptions {
    const artifact = this.lifecycle.storage.get(artifactId)
    const history = this.lifecycle.storage.catalog
      .supersededArtifactIds()
      .has(artifactId)
    const active = this.repository
      .forArtifact(artifactId)
      .find(item => !isTerminalTransitionStage(item.stage))
    return {
      storeId: this.lifecycle.storage.storeId,
      artifactId,
      status: artifact.status,
      targets: userTransitionTargets(artifact.status, history),
      activeOperationId: active?.id ?? null
    }
  }

  preview(
    artifactId: string,
    targetStatus: ArtifactTransitionPreview['targetStatus'],
    actor: ArtifactActor
  ): ArtifactTransitionPreview {
    const built = this.lifecycle.storage.catalog.readSnapshot(() =>
      this.build(artifactId, targetStatus)
    )
    const now = this.now()
    for (const [id, record] of this.previews) {
      if (record.view.expiresAt <= now) {
        this.previews.delete(id)
      }
    }
    // One open preview per document, target and actor; a new one replaces it.
    for (const [key, record] of this.previews) {
      if (
        record.artifactId === artifactId &&
        record.targetStatus === targetStatus &&
        canonicalJson(record.actor) === canonicalJson(actor)
      ) {
        this.previews.delete(key)
      }
    }
    if (this.previews.size >= MAX_PREVIEWS) {
      throw new ArtifactConflictError('Too many open transition previews.')
    }
    const id = randomUUID()
    const view = {
      ...built.view,
      previewId: id,
      expiresAt: now + TRANSITION_PREVIEW_TTL_MS
    }
    this.previews.set(id, {
      id,
      artifactId,
      targetStatus,
      actor,
      changeSet: built.changeSet,
      changeDigest: built.changeDigest,
      view
    })
    return view
  }

  /** The single user confirmation: record consent and start the validator. */
  begin(
    input: ArtifactTransitionStartInput,
    actor: ArtifactActor,
    deviceId?: string
  ): ArtifactTransitionOperation {
    if (this.stopped) {
      throw new ArtifactConflictError('The server is stopping.')
    }
    const requestDigest = sha256Hex(
      canonicalJson({
        previewId: input.previewId,
        presetId: input.presetId,
        actor
      })
    )
    const replay = this.repository.request(input.requestId)
    if (replay) {
      if (replay.payloadHash !== requestDigest) {
        throw new ArtifactConflictError('Transition request ID was reused.')
      }
      return this.view(this.repository.operation(replay.operationId))
    }
    const preview = this.previews.get(input.previewId)
    if (
      !preview ||
      preview.view.expiresAt <= this.now() ||
      canonicalJson(preview.actor) !== canonicalJson(actor)
    ) {
      throw new ArtifactConflictError(
        'The preview expired or is unknown. Refresh the consequences.'
      )
    }
    if (!preview.view.canConfirm) {
      throw new ArtifactConflictError(
        'The transition is blocked: ' +
          graphIssuesMessage(preview.view.blockers)
      )
    }
    const presetState = this.lifecycle.jobs.presetState(input.presetId)
    if (presetState !== 'ok') {
      throw new ArtifactConflictError(
        presetState === 'unknown'
          ? 'The validator agent is unknown. Choose another one.'
          : 'The validator agent is unavailable. Choose another one.'
      )
    }
    this.lifecycle.jobs.recover()
    if (this.lifecycle.repository.lease()) {
      throw artifactLeaseBusyError(
        'Another validation job is active. Try again when it finishes.'
      )
    }
    const operation = this.lifecycle.storage.catalog.transaction(() => {
      if (
        this.repository
          .forArtifact(preview.artifactId)
          .some(item => !isTerminalTransitionStage(item.stage))
      ) {
        throw new ArtifactConflictError(
          'A transition of this artifact is already running.'
        )
      }
      const current = this.build(preview.artifactId, preview.targetStatus)
      if (
        !current.view.canConfirm ||
        current.changeDigest !== preview.changeDigest
      ) {
        throw new ArtifactConflictError(
          'The affected documents changed. Refresh the consequences.'
        )
      }
      const operationId = randomUUID()
      const proposal = this.lifecycle.proposeInTransaction(
        {
          requestId: `transition:${operationId}`,
          changeSet: current.changeSet
        },
        actor
      )
      const validation = this.lifecycle.prepareInTransaction(
        proposal.id,
        proposal.version
      )
      const now = this.now()
      this.repository.appendConsent({
        operationId,
        actor,
        proposalId: proposal.id,
        proposalVersion: proposal.version,
        changeDigest: proposal.changeDigest,
        manifestDigest: validation.manifestDigest,
        validationId: validation.id,
        expiresAt: now + TRANSITION_CONSENT_TTL_MS
      })
      this.repository.appendRequest(input.requestId, requestDigest, operationId)
      const value: StoredTransition = {
        id: operationId,
        artifactId: preview.artifactId,
        title: current.view.title,
        fromStatus: current.view.fromStatus,
        targetStatus: preview.targetStatus,
        presetId: input.presetId,
        stage: 'preparing',
        changes: current.view.changes,
        cancelRequested: false,
        reason: null,
        proposalId: proposal.id,
        proposalVersion: proposal.version,
        validationId: validation.id,
        verdict: null,
        reportArtifactId: null,
        createdAt: now,
        updatedAt: now,
        consentExpiresAt: now + TRANSITION_CONSENT_TTL_MS,
        actor,
        requestDigest,
        owner: this.owner,
        ownerPid: process.pid,
        eventKind: 'started'
      }
      this.write(value)
      return value
    })
    this.previews.delete(input.previewId)
    this.lifecycle.storage.pollChanges()
    try {
      this.lifecycle.jobs.start(
        operation.validationId!,
        input.presetId,
        deviceId
      )
    } catch (error) {
      this.finish(operation.id, 'failed', errorMessage(error))
      // A lost race for the lease is the caller's conflict, not a result.
      if (isArtifactLeaseBusyError(error)) {
        throw error
      }
      return this.view(this.repository.operation(operation.id))
    }
    this.update(
      operation.id,
      'validating',
      current => current.stage === 'preparing',
      'validating'
    )
    return this.view(this.repository.operation(operation.id))
  }

  operation(id: string): ArtifactTransitionOperation {
    return this.view(this.repository.operation(id))
  }

  list(artifactId: string): ArtifactTransitionOperationList {
    this.lifecycle.storage.get(artifactId)
    return {
      storeId: this.lifecycle.storage.storeId,
      items: this.repository
        .forArtifact(artifactId)
        .map(item => this.view(item))
    }
  }

  /** Records a cancel request; the owner process stops the validator. */
  cancel(id: string): ArtifactTransitionOperation {
    const operation = this.lifecycle.storage.catalog.transaction(() => {
      const current = this.repository.operation(id)
      if (isTerminalTransitionStage(current.stage)) {
        return current
      }
      if (current.stage === 'applying') {
        throw new ArtifactConflictError(
          'Cancellation is no longer possible: the change is being applied.'
        )
      }
      if (current.cancelRequested) {
        return current
      }
      const next = {
        ...current,
        cancelRequested: true,
        updatedAt: this.now(),
        eventKind: 'cancel_requested'
      }
      this.write(next)
      return next
    })
    this.lifecycle.storage.pollChanges()
    if (
      operation.owner === this.owner &&
      !isTerminalTransitionStage(operation.stage)
    ) {
      this.runCancel(operation)
    }
    return this.view(this.repository.operation(id))
  }

  /** Advances operations of this process and settles those of dead processes. */
  reconcile(): void {
    if (this.stopped) {
      return
    }
    // The own heartbeat comes first: a stalled loop must not kill its own work.
    this.beat()
    this.lifecycle.jobs.recover()
    for (const operation of this.repository.unfinished()) {
      if (operation.owner === this.owner) {
        // One busy operation must not stop the others in this pass.
        try {
          if (operation.cancelRequested) {
            this.runCancel(operation)
          } else {
            this.advance(operation.id)
          }
        } catch (error) {
          if (!isArtifactBusyError(error)) {
            throw error
          }
        }
        continue
      }
      if (
        !this.lifecycle.ownerAlive(operation.owner, operation.ownerPid) ||
        this.now() > operation.consentExpiresAt + OWNER_GRACE_MS
      ) {
        this.finish(
          operation.id,
          'interrupted',
          'The process that ran this operation stopped.'
        )
      }
    }
  }

  private build(
    artifactId: string,
    targetStatus: ArtifactTransitionPreview['targetStatus']
  ) {
    const storage = this.lifecycle.storage
    const artifact = storage.get(artifactId)
    const history = storage.catalog.supersededArtifactIds().has(artifactId)
    const option = userTransitionTargets(artifact.status, history).find(
      item => item.status === targetStatus
    )
    const command = transitionCommand(artifact.status, targetStatus)
    if (!option || !command) {
      throw new ArtifactInputError(
        `Status ${targetStatus} cannot be chosen from ${artifact.status}.`
      )
    }
    const base: ArtifactChangeSet = {
      storeId: storage.storeId,
      command,
      subjectIds: [artifactId],
      expectedVersions: [],
      relationChanges: [],
      targetStatuses: [{ artifactId, status: targetStatus }],
      supplementDispositions: [],
      reason: `User changed the status of artifact ${artifactId} from ${artifact.status} to ${targetStatus}.`
    }
    if (!Value.Check(ArtifactChangeSetSchema, base)) {
      throw new ArtifactInputError('Invalid transition change set.')
    }
    // First pass discovers the versions; the second pass checks them strictly.
    const discovery = this.lifecycle.preview(base)
    const changeSet: ArtifactChangeSet = {
      ...base,
      expectedVersions: discovery.expectedVersions
    }
    const strict = this.lifecycle.preview(changeSet)
    const blockers: ArtifactTransitionPreview['blockers'] = strict.errors.map(
      item => ({
        code: item.code,
        message: item.message,
        artifactIds: item.artifactIds
      })
    )
    if (!option.available) {
      blockers.unshift({
        code: 'transition_unavailable',
        message: option.reason ?? 'The transition is unavailable.',
        artifactIds: [artifactId]
      })
    }
    if (!Value.Check(ArtifactChangeSetSchema, strict.canonical)) {
      throw new ArtifactInputError('Invalid canonical transition change set.')
    }
    const canonical = strict.canonical
    const changes = strict.postState.flatMap(node => {
      const before = storage.get(node.id)
      return before.status === node.status
        ? []
        : [
            {
              artifactId: node.id,
              title: node.title,
              fromStatus: before.status,
              toStatus: node.status
            }
          ]
    })
    return {
      changeSet: canonical,
      changeDigest: strict.changeDigest,
      view: {
        storeId: storage.storeId,
        previewId: '',
        artifactId,
        title: artifact.title,
        fromStatus: artifact.status,
        targetStatus,
        changes,
        blockers,
        canConfirm: blockers.length === 0,
        expiresAt: 0
      } satisfies ArtifactTransitionPreview
    }
  }

  private view(value: StoredTransition): ArtifactTransitionOperation {
    return {
      storeId: this.lifecycle.storage.storeId,
      id: value.id,
      artifactId: value.artifactId,
      title: value.title,
      fromStatus: value.fromStatus,
      targetStatus: value.targetStatus,
      presetId: value.presetId,
      stage: value.stage,
      changes: value.changes,
      canCancel:
        !isTerminalTransitionStage(value.stage) && value.stage !== 'applying',
      cancelRequested: value.cancelRequested,
      reason: value.reason,
      proposalId: value.proposalId,
      proposalVersion: value.proposalVersion,
      validationId: value.validationId,
      verdict: value.verdict,
      reportArtifactId: value.reportArtifactId,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      consentExpiresAt: value.consentExpiresAt
    }
  }

  /** Appends an event and bumps the store epoch so other processes notice. */
  private write(value: StoredTransition): void {
    this.repository.append(value)
    this.lifecycle.storage.catalog.recordChange(
      'transition',
      value.id,
      randomUUID(),
      false
    )
  }

  private update(
    id: string,
    stage: StoredTransition['stage'],
    when: (current: StoredTransition) => boolean,
    eventKind: string
  ): boolean {
    const changed = this.lifecycle.storage.catalog.transaction(() => {
      const current = this.repository.operation(id)
      if (isTerminalTransitionStage(current.stage) || !when(current)) {
        return false
      }
      this.write({ ...current, stage, updatedAt: this.now(), eventKind })
      return true
    })
    this.lifecycle.storage.pollChanges()
    return changed
  }

  private finish(
    id: string,
    stage: 'failed' | 'cancelled' | 'interrupted',
    reason: string,
    extra: Partial<StoredTransition> = {}
  ): void {
    this.lifecycle.storage.catalog.transaction(() => {
      const current = this.repository.operation(id)
      if (isTerminalTransitionStage(current.stage)) {
        return
      }
      this.write({
        ...current,
        ...extra,
        stage,
        reason,
        updatedAt: this.now(),
        eventKind: stage
      })
    })
    this.lifecycle.storage.pollChanges()
  }

  private settle(validationId: string): void {
    const operation = this.repository
      .unfinished()
      .find(item => item.validationId === validationId)
    if (operation) {
      this.advance(operation.id)
    }
  }

  private runCancel(operation: StoredTransition): void {
    try {
      this.lifecycle.jobs.cancel(operation.validationId!)
    } catch (error) {
      if (!(error instanceof ArtifactNotFoundError)) {
        throw error
      }
    }
    this.advance(operation.id)
  }

  /** Reads the validation outcome and applies, fails or cancels the operation. */
  private advance(id: string): void {
    if (this.stopped) {
      return
    }
    const operation = this.repository.operation(id)
    if (
      isTerminalTransitionStage(operation.stage) ||
      operation.owner !== this.owner
    ) {
      return
    }
    const validation = this.lifecycle.repository.validation(
      operation.validationId!
    )
    const outcome = {
      verdict: validation.report?.verdict ?? validation.state,
      reportArtifactId: validation.report?.reportArtifactId ?? null
    }
    if (validation.state === 'prepared' || validation.state === 'running') {
      if (operation.cancelRequested) {
        this.runCancel(operation)
      } else if (
        operation.stage === 'preparing' &&
        validation.state === 'prepared' &&
        this.now() - operation.updatedAt > PREPARE_STALL_MS
      ) {
        // The start failed and its failure record could not be written (busy).
        this.finish(id, 'failed', 'The validator did not start.')
      }
      return
    }
    if (operation.cancelRequested) {
      this.finish(id, 'cancelled', 'Cancelled by user.', outcome)
      return
    }
    if (validation.state !== 'pass') {
      const reason =
        validation.state === 'conflict'
          ? 'The validator found conflicts; statuses are unchanged.'
          : (validation.reason ??
            'Validation did not finish; statuses are unchanged.')
      this.finish(id, 'failed', reason, outcome)
      return
    }
    this.apply(operation, outcome)
  }

  private apply(
    operation: StoredTransition,
    outcome: { verdict: string; reportArtifactId: string | null }
  ): void {
    const consent = this.repository.consent(operation.id)
    const validation = this.lifecycle.repository.validation(
      operation.validationId!
    )
    const reject = (reason: string) =>
      this.finish(operation.id, 'failed', reason, outcome)
    if (!consent || consent.validationId !== operation.validationId) {
      reject('The prior consent is missing.')
      return
    }
    if (
      consent.manifestDigest !== validation.manifestDigest ||
      consent.changeDigest !== validation.manifest.changeDigest
    ) {
      reject('The confirmed scope changed; statuses are unchanged.')
      return
    }
    const gate = (): string | null => {
      if (this.now() >= consent.expiresAt) {
        return 'The prior consent expired; confirm again.'
      }
      if (!this.isActorActive(consent.actor)) {
        return 'Access of the confirming device ended; statuses are unchanged.'
      }
      return null
    }
    const early = gate()
    if (early) {
      reject(early)
      return
    }
    // Cancel and apply meet in this transaction; the loser sees the winner.
    const started = this.lifecycle.storage.catalog.transaction(() => {
      const current = this.repository.operation(operation.id)
      if (isTerminalTransitionStage(current.stage) || current.cancelRequested) {
        return false
      }
      // A retry after a busy database finds the stage already written.
      if (current.stage !== 'applying') {
        this.write({
          ...current,
          stage: 'applying',
          ...outcome,
          updatedAt: this.now(),
          eventKind: 'applying'
        })
      }
      return true
    })
    if (!started) {
      this.advance(operation.id)
      return
    }
    try {
      this.lifecycle.commitConfirmed(
        {
          changeSetId: consent.proposalId,
          version: consent.proposalVersion,
          validationId: consent.validationId,
          requestId: `transition:${operation.id}`
        },
        consent.actor,
        () => {
          const current = this.repository.operation(operation.id)
          const blocked = gate()
          if (current.stage !== 'applying' || blocked) {
            throw new ArtifactConflictError(
              blocked ?? 'Operation is not applying.'
            )
          }
          this.write({
            ...current,
            stage: 'succeeded',
            reason: null,
            updatedAt: this.now(),
            eventKind: 'succeeded'
          })
        }
      )
    } catch (error) {
      // The commit rolled back; the next reconcile retries it under the same
      // request ID, and the consent gate still bounds the time.
      if (isArtifactBusyError(error)) {
        return
      }
      this.finish(operation.id, 'failed', errorMessage(error), outcome)
    }
  }
}
