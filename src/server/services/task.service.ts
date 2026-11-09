import { ForbiddenError } from '../errors/http.ts'
import type { AgentSession } from './agent/agent-session.ts'
import { artifactPage } from '../utils/artifact-page.ts'
import { randomUUID } from 'node:crypto'
import type { ArtifactActor } from '../../shared/artifacts/types.ts'
import type {
  Task,
  TaskInput,
  TaskChatLink,
  TaskArtifact,
  TaskArtifacts,
  TaskActivationRequest,
  TaskCreateAndActivateRequest,
  TaskActivationResult,
  TaskContext
} from '../../shared/tasks/types.ts'
import {
  TaskInputSchema,
  SessionTaskBody,
  TaskActivationBody,
  TaskCreateAndActivateBody
} from '../../shared/tasks/schemas.ts'
import { isCredentialFreeWebUrl } from '../../shared/utils/web-url.ts'
import { resolveTaskFields } from '../../shared/tasks/normalize.ts'
import { INACTIVE_ARTIFACT_STATUSES } from '../../shared/artifacts/constants.ts'
import {
  ArtifactConflictError,
  TaskClosedError,
  TaskHasActiveArtifactsError,
  ArtifactInputError,
  ArtifactNotFoundError
} from '../errors/artifacts.ts'
import type { AgentSessionRegistry } from './agent/session-registry.ts'
import {
  ArtifactDefinitionService,
  assertDefinitionInput,
  type DefinitionServiceOptions
} from './artifact-definition.service.ts'

export class TaskService extends ArtifactDefinitionService<Task> {
  private registry: AgentSessionRegistry | undefined
  constructor(options: DefinitionServiceOptions) {
    super(options, 'task')
  }
  private artifactsOf: ((taskId: string) => TaskArtifact[]) | undefined
  attachSessions(registry: AgentSessionRegistry): void {
    this.registry = registry
  }
  attachArtifacts(read: (taskId: string) => TaskArtifact[]): void {
    this.artifactsOf = read
  }
  artifacts(taskId: string): TaskArtifacts {
    this.get(taskId)
    return {
      taskId,
      items: this.options.catalog.readSnapshot(
        () => this.artifactsOf?.(taskId) ?? []
      )
    }
  }
  listByState(
    limit: number | undefined,
    cursor: string | undefined,
    search: string | undefined,
    state: Task['state'] | undefined,
    tags: string[] = [],
    tagMode: 'all' | 'any' = 'all'
  ) {
    const key = [
      state && `state:${state}`,
      tags.length && `tags:${tagMode}:${JSON.stringify(tags)}`
    ]
      .filter(Boolean)
      .join(':')
    const hasTags = (task: Task) =>
      tagMode === 'any'
        ? tags.some(tag => task.tags.includes(tag))
        : tags.every(tag => task.tags.includes(tag))
    return this.options.catalog.readSnapshot(() => {
      const page = this.listPage(
        limit,
        cursor,
        search,
        key
          ? {
              key,
              test: task =>
                (!state || task.state === state) &&
                (!tags.length || hasTags(task))
            }
          : undefined
      )
      const counts = this.options.repository.artifactCounts(
        page.items.map(task => task.id)
      )
      return {
        ...page,
        items: page.items.map(task => ({
          ...task,
          artifactCount: counts.get(task.id) ?? 0
        }))
      }
    })
  }
  create(requestId: string, input: TaskInput, actor: ArtifactActor): Task {
    this.validate(input)
    return this.mutate(requestId, { command: 'create', input }, actor, () =>
      this.newTask(input)
    )
  }
  private newTask(input: TaskInput): Task {
    return {
      storeId: this.options.catalog.storeId,
      id: randomUUID(),
      ...resolveTaskFields(input),
      version: 1,
      createdAt: new Date((this.options.now ?? Date.now)()).toISOString()
    }
  }
  getContext(actor: ArtifactActor): TaskContext {
    const session = this.ownSession(actor)
    return this.options.catalog.readSnapshot(() => {
      const turn = session.turnTaskContext
      return {
        storeId: this.options.catalog.storeId,
        sessionId: session.id,
        turnId: turn?.turnId ?? null,
        assignment: this.options.repository.assignment(session.id),
        taskIds: [...(turn?.taskIds ?? [])],
        source: turn ? (turn.source ?? 'turn_assignment') : null
      }
    })
  }
  activate(
    input: TaskActivationRequest,
    actor: ArtifactActor
  ): TaskActivationResult {
    assertDefinitionInput(TaskActivationBody, input)
    return this.activateCommand(input, actor)
  }
  createAndActivate(
    input: TaskCreateAndActivateRequest,
    actor: ArtifactActor
  ): TaskActivationResult {
    assertDefinitionInput(TaskCreateAndActivateBody, input)
    this.validate(input.input)
    return this.activateCommand(input, actor)
  }
  private ownSession(actor: ArtifactActor): AgentSession {
    const session =
      actor.kind === 'agent' ? this.registry?.get(actor.id) : undefined
    if (!session || session.status === 'closed') {
      throw new ForbiddenError(
        'Task activation requires its own live agent session.'
      )
    }
    return session
  }
  private activateCommand(
    input: TaskActivationRequest | TaskCreateAndActivateRequest,
    actor: ArtifactActor
  ): TaskActivationResult {
    const { requestId, ...payload } = input
    let apply: (() => void) | undefined
    // Keep the transaction and context application synchronous; no response can switch between them.
    const outcome = this.commandWithReplay(
      requestId,
      {
        command: 'input' in input ? 'create_and_activate' : 'activate',
        ...payload
      },
      actor,
      () => {
        const session = this.ownSession(actor)
        const previous = this.options.repository.assignment(session.id)
        if (previous.version !== input.assignmentVersion) {
          throw new ArtifactConflictError(
            'Session task assignment changed. Read tasks.get_context and ask before switching again.'
          )
        }
        const task: Task =
          'input' in input ? this.newTask(input.input) : this.get(input.taskId)
        const version = previous.version + 1
        const prepared = session.prepareTaskActivation(
          input.turnId,
          version,
          task.id,
          requestId
        )
        apply = prepared.apply
        const now = new Date((this.options.now ?? Date.now)()).toISOString()
        if ('input' in input) {
          this.options.repository.append('task', task, requestId, actor, now)
          this.options.catalog.recordChange('task', task.id, requestId)
        }
        this.options.repository.appendAssignment(
          session.id,
          version,
          [task.id],
          session.name,
          requestId,
          actor,
          now
        )
        this.options.catalog.recordChange('task_session', session.id, requestId)
        return {
          task,
          assignment: { sessionId: session.id, version, taskIds: [task.id] },
          activation: {
            sessionId: session.id,
            turnId: input.turnId,
            assignmentVersion: version,
            taskId: task.id,
            requestId
          }
        }
      }
    )
    if (!outcome.replayed) {
      apply!()
      this.options.onChange()
      this.registry?.notifyTasksChanged()
    }
    return { ...outcome.result, replayed: outcome.replayed }
  }
  update(
    id: string,
    requestId: string,
    expectedVersion: number,
    input: TaskInput,
    actor: ArtifactActor
  ): Task {
    this.validate(input)
    return this.mutate(
      requestId,
      { command: 'update', id, expectedVersion, input },
      actor,
      () => {
        const previous = this.get(id)
        this.assertVersion(previous.version, expectedVersion)
        // A closed task stays closed: new work needs a new task.
        if (previous.state === 'closed') {
          throw new TaskClosedError('A closed task cannot be changed.')
        }
        if (input.state === 'closed') this.assertClosable(id)
        return {
          ...previous,
          ...resolveTaskFields(input, previous),
          version: previous.version + 1
        }
      }
    )
  }
  // Artifacts bound only to this task must leave active use before it closes.
  private assertClosable(id: string): void {
    const pending = (this.artifactsOf?.(id) ?? []).filter(
      artifact =>
        artifact.exclusive &&
        !INACTIVE_ARTIFACT_STATUSES.includes(artifact.status)
    )
    if (pending.length) {
      throw new TaskHasActiveArtifactsError(
        `Archive ${pending.length} artifact(s) bound only to this task first.`
      )
    }
  }
  private validate(input: TaskInput): void {
    assertDefinitionInput(TaskInputSchema, input)
    if (!input.title.trim()) {
      throw new ArtifactInputError('Task title is empty.')
    }
    if (input.links !== undefined && input.externalUrl !== undefined) {
      throw new ArtifactInputError(
        'Use links or the deprecated externalUrl, not both.'
      )
    }
    const { links } = resolveTaskFields(input)
    const urls = new Set<string>()
    for (const { url } of links) {
      let valid = false
      try {
        valid = isCredentialFreeWebUrl(new URL(url))
      } catch {
        /* Invalid URLs are rejected below. */
      }
      if (!valid) {
        throw new ArtifactInputError(
          'Task URL must use HTTP or HTTPS without credentials.'
        )
      }
      if (urls.has(url)) {
        throw new ArtifactInputError('Task links must be unique.')
      }
      urls.add(url)
    }
  }
  assignment(sessionId: string) {
    if (!this.registry?.get(sessionId)) throw new ArtifactNotFoundError()
    return this.options.repository.assignment(sessionId)
  }
  assignSession(
    sessionId: string,
    input: { requestId: string; expectedVersion: number; taskIds: string[] },
    actor: ArtifactActor
  ) {
    assertDefinitionInput(SessionTaskBody, input)
    const taskIds = [...input.taskIds].sort()
    const result = this.command(
      input.requestId,
      {
        command: 'session_tasks',
        sessionId,
        expectedVersion: input.expectedVersion,
        taskIds
      },
      actor,
      () => {
        const session = this.registry?.get(sessionId)
        if (!session) throw new ArtifactNotFoundError()
        const previous = this.options.repository.assignment(sessionId)
        if (previous.version !== input.expectedVersion) {
          throw new ArtifactConflictError('Session task assignment changed.')
        }
        for (const id of taskIds) {
          try {
            this.get(id)
          } catch (error) {
            if (error instanceof ArtifactNotFoundError) {
              throw new ArtifactInputError(`Unknown task "${id}".`)
            }
            throw error
          }
        }
        const version = previous.version + 1
        this.options.repository.appendAssignment(
          sessionId,
          version,
          taskIds,
          session.name,
          input.requestId,
          actor,
          new Date((this.options.now ?? Date.now)()).toISOString()
        )
        this.options.catalog.recordChange(
          'task_session',
          sessionId,
          input.requestId
        )
        return { sessionId, version, taskIds }
      }
    )
    this.registry?.notifyTasksChanged()
    return result
  }
  links(taskId: string): TaskChatLink[] {
    this.get(taskId)
    const latest = new Map<string, TaskChatLink>()
    for (const event of this.options.repository.chatHistory()) {
      if (event.taskIds.includes(taskId) || latest.has(event.sessionId)) {
        latest.set(event.sessionId, {
          taskId,
          sessionId: event.sessionId,
          title: event.title,
          linked: event.taskIds.includes(taskId),
          available: Boolean(this.registry?.get(event.sessionId)),
          version: event.version
        })
      }
    }
    return [...latest.values()]
  }
  linksPage(taskId: string, limit = 50, cursor?: string) {
    return this.options.catalog.readSnapshot(() =>
      artifactPage(this.links(taskId), {
        storeId: this.options.catalog.storeId,
        epoch: this.options.catalog.epoch(),
        query: `task:sessions:${taskId}`,
        limit,
        cursor
      })
    )
  }
  linkHistoryPage(taskId: string, limit = 50, cursor?: string) {
    return this.options.catalog.readSnapshot(() =>
      artifactPage(this.linkHistory(taskId), {
        storeId: this.options.catalog.storeId,
        epoch: this.options.catalog.epoch(),
        query: `task:session-history:${taskId}`,
        limit,
        cursor
      })
    )
  }
  linkHistory(taskId: string) {
    this.get(taskId)
    const events = this.options.repository.chatHistory()
    const previous = new Map<string, string[]>()
    return events.flatMap(event => {
      const before = previous.get(event.sessionId) ?? []
      previous.set(event.sessionId, event.taskIds)
      if (!before.includes(taskId) && !event.taskIds.includes(taskId)) return []
      return [
        {
          ...event,
          taskId,
          linked: event.taskIds.includes(taskId),
          available: Boolean(this.registry?.get(event.sessionId))
        }
      ]
    })
  }
}
