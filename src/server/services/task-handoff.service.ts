import { randomUUID } from 'node:crypto'
import type { ArtifactActor } from '../../shared/artifacts/types.ts'
import {
  HANDOFF_PREVIEW_TTL_MS,
  HANDOFF_RETENTION_MS
} from '../../shared/task-journal/constants.ts'
import type {
  Handoff,
  HandoffPreview,
  SessionHandoffPreview
} from '../../shared/task-journal/types.ts'
import { HEARTBEAT_STALE_MS } from '../../shared/artifact-transitions/constants.ts'
import { canonicalJson } from '../../shared/utils/canonical-json.ts'
import { errorMessage } from '../../shared/utils/error-message.ts'
import {
  ArtifactConflictError,
  ArtifactInputError,
  ArtifactNotFoundError,
  TaskClosedError
} from '../errors/artifacts.ts'
import { ForbiddenError } from '../errors/http.ts'
import { TooManyAgentSessionsError } from '../errors/agents.ts'
import {
  assertRequestIdFree,
  otherReceiptTables
} from '../repositories/request-ids.ts'
import { sha256Hex } from '../utils/hash.ts'
import type { StoredHandoff } from '../repositories/task-journal.repo.ts'
import type { ArtifactStorageService } from './artifact-storage.service.ts'
import type { AgentSessionRegistry } from './agent/session-registry.ts'
import type { AgentSession } from './agent/agent-session.ts'
import { buildSessionHandoffContext } from './agent/session-handoff-context-builder.ts'
import { buildHandoffContext } from './agent/handoff-context-builder.ts'

// The target recovers context and continues without asking the stopped source to summarize.
const HANDOFF_CONTINUATION_PROMPT =
  'Continue the work from the source session in the attached handoff snapshot. Recover the original user goal and apply all later corrections. Read additional entries with sessions.journal_list using the provided storeId, sessionId and throughSeq when needed. Briefly summarize the current state, decisions and unfinished steps, then continue from where the previous agent stopped. Verify actual repository state and the results of interrupted actions before repeating them. Do not treat a finished agent response as proof that the user goal is complete.'
// The native adapter has a bounded handshake deadline.
const HANDOFF_START_TIMEOUT_MS = 95_000
// Persist interruptions of dead owners and remove old receipts without a request.
const HANDOFF_MAINTENANCE_INTERVAL_MS = 30_000
// Shown when the owner process of a preparing handoff stopped.
const INTERRUPTED_MESSAGE =
  'The server that prepared this handoff stopped. Continue the task with a new request.'

export class TaskHandoffService {
  private readonly pending = new Set<string>()
  private readonly targets = new Map<string, string>()
  private stopped = false
  private readonly running = new Set<Promise<void>>()
  private readonly timer: ReturnType<typeof setInterval>
  private onError: (error: unknown) => void = () => {}
  setErrorHandler(handler: (error: unknown) => void): void {
    this.onError = handler
  }
  private readonly storage: ArtifactStorageService
  private readonly registry: AgentSessionRegistry
  private readonly repositoryPath: string
  private readonly actorActive: (actor: ArtifactActor) => boolean
  constructor(
    storage: ArtifactStorageService,
    registry: AgentSessionRegistry,
    repositoryPath: string,
    actorActive: (actor: ArtifactActor) => boolean
  ) {
    this.storage = storage
    this.registry = registry
    this.repositoryPath = repositoryPath
    this.actorActive = actorActive
    this.timer = setInterval(() => {
      try {
        this.maintain()
      } catch (error) {
        this.onError(error)
      }
    }, HANDOFF_MAINTENANCE_INTERVAL_MS)
    this.timer.unref()
  }
  private get repository() {
    return this.storage.journal.repository
  }
  private assertActor(actor: ArtifactActor): void {
    if (actor.kind !== 'user' || !this.actorActive(actor)) {
      throw new ForbiddenError('Active user access is required for a handoff.')
    }
  }
  private owned(id: string, actor: ArtifactActor): StoredHandoff {
    this.assertActor(actor)
    const operation = this.repository.handoff(id)
    const request =
      operation && this.repository.handoffReplay(operation.input.requestId)
    if (
      !operation ||
      !request ||
      canonicalJson(request.actor) !== canonicalJson(actor)
    ) {
      throw new ArtifactNotFoundError()
    }
    return operation
  }
  /** A preparing operation is dead when this service does not run it and its owner heartbeat is stale. */
  private abandoned(id: string, owner: string | undefined): boolean {
    if (this.pending.has(id)) return false
    if (owner === undefined) return true
    const beat = this.storage.lifecycle.repository.heartbeat(owner)
    return beat === undefined || Date.now() - beat > HEARTBEAT_STALE_MS
  }
  /** Reads the operation; a dead preparing owner is reported, not written, here. */
  get(id: string, actor: ArtifactActor): Handoff {
    const value = this.owned(id, actor)
    if (
      value.state === 'preparing' &&
      this.abandoned(id, this.repository.handoffOwner(id))
    ) {
      return { ...value, state: 'interrupted', error: INTERRUPTED_MESSAGE }
    }
    return value
  }
  /**
   * Persists interruptions of dead owners and removes old receipts.
   * An interrupted operation is never restarted: the user continues the task with a new request.
   */
  maintain(now = Date.now()): void {
    this.storage.catalog.transaction(() => {
      for (const { value, owner } of this.repository.preparingHandoffs()) {
        if (!this.abandoned(value.id, owner)) continue
        this.repository.updateHandoff({
          ...value,
          state: 'interrupted',
          error: INTERRUPTED_MESSAGE
        })
      }
      this.repository.purgeHandoffs(now, HANDOFF_RETENTION_MS)
    })
  }
  private source(value: StoredHandoff): AgentSession | undefined {
    if (!value.sourceSessionId) return undefined
    const source = this.registry.get(value.sourceSessionId)
    const assignment = this.storage.definitions.assignment(
      value.sourceSessionId
    )
    if (
      !source ||
      source.kind ||
      (source.status !== 'ready' &&
        !(value.sessionTaskIds && source.status === 'closed')) ||
      source.blockedBySessionId ||
      assignment.version !== value.input.sourceAssignmentVersion ||
      (value.sessionTaskIds
        ? canonicalJson(assignment.taskIds) !==
            canonicalJson(value.sessionTaskIds) ||
          this.repository.sessionNewest(source.id) !== value.sourceThroughSeq
        : assignment.taskIds.length !== 1 ||
          assignment.taskIds[0] !== value.taskId)
    ) {
      throw new ArtifactConflictError(
        'Source chat or its selected task changed. Refresh before continuing.'
      )
    }
    return source
  }
  previewSession(
    input: SessionHandoffPreview,
    actor: ArtifactActor
  ): Promise<Handoff> {
    return this.preview(null, input, actor)
  }
  async preview(
    taskId: string | null,
    input: HandoffPreview,
    actor: ArtifactActor
  ): Promise<Handoff> {
    this.assertActor(actor)
    if (input.storeId !== this.storage.storeId) {
      throw new ArtifactInputError('Task store changed.')
    }
    const hash = sha256Hex(canonicalJson({ taskId, input, actor }))
    const replay = this.repository.handoffReplay(input.requestId)
    if (replay) {
      if (replay.hash !== hash) {
        throw new ArtifactConflictError(
          'Handoff request identifier already used.'
        )
      }
      return this.get(replay.value.id, actor)
    }
    if (taskId !== null && this.storage.tasks.get(taskId).state !== 'open') {
      throw new TaskClosedError('A closed task cannot be continued.')
    }
    const sessionTaskIds =
      taskId === null
        ? [
            ...this.storage.definitions.assignment(input.sourceSessionId ?? '')
              .taskIds
          ]
        : undefined
    if (taskId === null) {
      const source =
        input.sourceSessionId && this.registry.get(input.sourceSessionId)
      if (
        !source ||
        source.kind ||
        !['ready', 'closed'].includes(source.status) ||
        source.info().reserved ||
        source.blockedBySessionId
      ) {
        throw new ArtifactConflictError(
          'Source chat is not available for handoff.'
        )
      }
    }
    const sessionContent =
      taskId === null
        ? buildSessionHandoffContext(this.storage, input.sourceSessionId!)
        : undefined
    const content = sessionContent
      ? { snapshot: sessionContent.snapshot, taskVersion: 0 }
      : await buildHandoffContext(this.storage, taskId!, this.repositoryPath)
    this.assertActor(actor)
    const value: StoredHandoff = {
      id: randomUUID(),
      storeId: this.storage.storeId,
      taskId,
      state: 'preview',
      sourceSessionId: input.sourceSessionId ?? null,
      targetSessionId: null,
      snapshot: content.snapshot,
      digest: sha256Hex(content.snapshot),
      capturedAt: new Date().toISOString(),
      expiresAt: Date.now() + HANDOFF_PREVIEW_TTL_MS,
      error: null,
      input,
      taskVersion: content.taskVersion,
      ...(sessionTaskIds
        ? { sessionTaskIds, sourceThroughSeq: sessionContent!.throughSeq }
        : {})
    }
    const checkedSource = this.source(value)
    if (checkedSource?.status !== 'closed') checkedSource?.assertWritable()
    return this.storage.catalog.transaction(() => {
      const previous = this.repository.handoffReplay(input.requestId)
      if (previous) {
        if (previous.hash !== hash) {
          throw new ArtifactConflictError(
            'Handoff request identifier already used.'
          )
        }
        return previous.value
      }
      assertRequestIdFree(
        this.repository.db,
        this.storage.storeId,
        input.requestId,
        otherReceiptTables('task_handoff_operations')
      )
      this.repository.createHandoff(
        value,
        hash,
        actor,
        this.storage.lifecycle.jobs.ownerId
      )
      return value
    })
  }
  confirm(id: string, digest: string, actor: ArtifactActor): Handoff {
    const value = this.owned(id, actor)
    if (value.digest !== digest) {
      throw new ArtifactConflictError('The handoff snapshot changed.')
    }
    if (value.state !== 'preview') return this.get(id, actor)
    if (this.stopped || Date.now() >= value.expiresAt) {
      throw new ArtifactConflictError('Handoff preview expired. Refresh it.')
    }
    const task =
      value.taskId === null ? undefined : this.storage.tasks.get(value.taskId)
    if (task && (task.state !== 'open' || task.version !== value.taskVersion)) {
      throw new ArtifactConflictError('The task changed. Refresh the preview.')
    }
    const source = this.source(value)
    if (source?.info().reserved) {
      throw new ArtifactConflictError(
        'A handoff is already being prepared for this chat.'
      )
    }
    if (source?.status !== 'closed') source?.assertWritable()
    // Fail before any side effect: the preview stays usable after the user closes a chat.
    if (!this.registry.hasFreeSlot()) {
      throw new TooManyAgentSessionsError(
        'All chat slots are in use. Close a chat and create the handoff again.'
      )
    }
    source?.setReserved(true)
    try {
      value.state = 'preparing'
      const claimed = this.storage.catalog.transaction(() =>
        this.repository.claimHandoff(value, this.storage.lifecycle.jobs.ownerId)
      )
      if (!claimed) {
        source?.setReserved(false)
        return this.get(id, actor)
      }
      this.pending.add(id)
      const target = this.registry.create(
        value.input.presetId,
        null,
        value.input.name,
        actor.id === 'local' ? undefined : actor.id
      )
      target.setReserved(true)
      this.targets.set(id, target.id)
      value.targetSessionId = target.id
      this.repository.updateHandoff(value)
      const work = this.finish(value, target, source, actor)
        .catch(error => {
          this.onError(error)
        })
        .finally(() => {
          this.running.delete(work)
        })
      this.running.add(work)
      return value
    } catch (error) {
      const targetId = this.targets.get(id)
      if (targetId) this.registry.close(targetId)
      this.targets.delete(id)
      this.pending.delete(id)
      source?.setReserved(false)
      value.state = 'failed'
      value.error = errorMessage(error)
      this.repository.updateHandoff(value)
      return value
    }
  }
  private async finish(
    value: StoredHandoff,
    target: AgentSession,
    source: AgentSession | undefined,
    actor: ArtifactActor
  ): Promise<void> {
    try {
      await this.waitForReady(target)
      this.assertActor(actor)
      if (this.stopped) {
        throw new ArtifactConflictError('Server stopped during handoff.')
      }
      this.source(value)
      const task =
        value.taskId === null ? undefined : this.storage.tasks.get(value.taskId)
      if (
        task &&
        (task.state !== 'open' || task.version !== value.taskVersion)
      ) {
        throw new ArtifactConflictError('Task changed during handoff.')
      }
      // No await between these checks, persistence, and the in-memory capability switch.
      this.storage.catalog.transaction(() => {
        this.assertActor(actor)
        const currentOperation = this.repository.handoff(value.id)
        if (
          currentOperation?.state !== 'preparing' ||
          currentOperation.targetSessionId !== target.id ||
          this.repository.handoffOwner(value.id) !==
            this.storage.lifecycle.jobs.ownerId
        ) {
          throw new ArtifactConflictError(
            'Handoff was interrupted or its owner changed.'
          )
        }
        this.source(value)
        const currentTask =
          value.taskId === null
            ? undefined
            : this.storage.tasks.get(value.taskId)
        if (
          currentTask &&
          (currentTask.state !== 'open' ||
            currentTask.version !== value.taskVersion)
        ) {
          throw new ArtifactConflictError('Task changed during handoff commit.')
        }
        const assignment = this.storage.definitions.assignment(target.id)
        if (assignment.version !== 0) {
          throw new ArtifactConflictError(
            'Target assignment changed during handoff.'
          )
        }
        this.storage.definitions.appendAssignment(
          target.id,
          1,
          value.sessionTaskIds ?? [task!.id],
          target.name,
          `handoff:${value.id}`,
          actor,
          new Date().toISOString()
        )
        this.storage.catalog.recordChange(
          'task_session',
          target.id,
          `handoff:${value.id}`
        )
        this.storage.journal.fact(
          task?.id ?? null,
          `handoff:${value.id}`,
          'handoff_completed',
          `${source?.name ?? 'task'}${source ? ` (${source.id})` : ''} → ${target.name} (${target.id})`,
          { sessionId: target.id },
          target.journalProvenance
        )
        value.state = 'ready'
        this.repository.updateHandoff(value)
      })
      if (source) {
        source.setBlockedBy(target.id)
        // Revoke only after commit: a failed handoff keeps pending authorizations of the source.
        this.storage.lifecycle.authorization.revokeSession(source.id)
      }
      target.setInitialContext(
        `githuman://task-handoff/${encodeURIComponent(value.storeId)}/${encodeURIComponent(value.id)}`,
        value.snapshot,
        () => {
          const current = this.storage.definitions.assignment(target.id)
          if (value.sessionTaskIds) {
            return (
              current.version === 1 &&
              canonicalJson(current.taskIds) ===
                canonicalJson(value.sessionTaskIds)
            )
          }
          return (
            current.version === 1 &&
            current.taskIds.length === 1 &&
            current.taskIds[0] === value.taskId &&
            this.storage.tasks.get(value.taskId).state === 'open'
          )
        }
      )
      target.setReserved(false)
      this.storage.journal.changed()
      this.registry.notifyTasksChanged()
      if (value.sessionTaskIds) {
        // The persisted ready receipt prevents replay from sending the prompt twice.
        const text =
          HANDOFF_CONTINUATION_PROMPT +
          '\nSource journal: ' +
          JSON.stringify({
            storeId: value.storeId,
            sessionId: value.sourceSessionId,
            throughSeq: value.sourceThroughSeq
          })
        target.prompt([{ type: 'text', text }], { text })
      }
    } catch (error) {
      this.registry.close(target.id)
      this.storage.catalog.transaction(() => {
        const current = this.repository.handoff(value.id)
        if (
          (current?.state === 'preparing' ||
            (value.sessionTaskIds && current?.state === 'ready')) &&
          this.repository.handoffOwner(value.id) ===
            this.storage.lifecycle.jobs.ownerId
        ) {
          if (current.state === 'ready') {
            // The completion fact is immutable. A new fact corrects the history.
            this.storage.journal.fact(
              value.taskId,
              `handoff-failed:${value.id}`,
              'handoff_failed',
              errorMessage(error),
              { sessionId: target.id }
            )
          }
          value.state = 'failed'
          value.error = errorMessage(error)
          this.repository.updateHandoff(value)
        }
      })
    } finally {
      source?.setReserved(false)
      this.targets.delete(value.id)
      this.pending.delete(value.id)
    }
  }
  private waitForReady(target: AgentSession): Promise<void> {
    return new Promise((resolve, reject) => {
      const controls: {
        unsubscribe?: () => void
        timer?: ReturnType<typeof setTimeout>
      } = {}
      const check = () => {
        if (target.status !== 'ready' && target.status !== 'closed') return
        clearTimeout(controls.timer)
        controls.unsubscribe?.()
        if (target.status === 'ready') {
          resolve()
        } else {
          reject(new ArtifactConflictError('Target agent failed to start.'))
        }
      }
      controls.unsubscribe = target.onEvent(() => check())
      controls.timer = setTimeout(() => {
        controls.unsubscribe?.()
        reject(new ArtifactConflictError('Target agent startup timed out.'))
      }, HANDOFF_START_TIMEOUT_MS)
      check()
    })
  }
  async close(): Promise<void> {
    this.stopped = true
    clearInterval(this.timer)
    for (const target of this.targets.values()) this.registry.close(target)
    await Promise.all(this.running)
  }
}
