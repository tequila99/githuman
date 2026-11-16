import { parseIsoTimestamp, toIsoString } from '../../shared/utils/date.ts'
import { journalEventText } from './agent/journal-event.ts'
import { takeWithinBytes } from '../utils/take-within-bytes.ts'
import { randomUUID } from 'node:crypto'
import { Value } from '@sinclair/typebox/value'
import type { ArtifactActor } from '../../shared/artifacts/types.ts'
import {
  SessionJournalQuery,
  JournalAppendBody,
  JournalQuery,
  JournalSearchQuery
} from '../../shared/task-journal/schemas.ts'
import {
  DEFAULT_JOURNAL_PAGE_LIMIT,
  MAX_JOURNAL_ENTRY_BYTES,
  MAX_JOURNAL_PAGE_BYTES
} from '../../shared/task-journal/constants.ts'
import type {
  SessionJournalInput,
  JournalAppend,
  JournalContext,
  JournalProvenance,
  JournalEntry,
  JournalEventType,
  JournalListQuery,
  JournalPage,
  JournalSearchInput,
  JournalSearchPage
} from '../../shared/task-journal/types.ts'
import { canonicalJson } from '../../shared/utils/canonical-json.ts'
import {
  ArtifactConflictError,
  ArtifactInputError,
  ArtifactNotFoundError,
  TaskClosedError
} from '../errors/artifacts.ts'
import { ForbiddenError } from '../errors/http.ts'
import { TaskJournalRepository } from '../repositories/task-journal.repo.ts'
import {
  assertRequestIdFree,
  otherReceiptTables
} from '../repositories/request-ids.ts'
import { sha256Hex } from '../utils/hash.ts'
import type { ArtifactStorageService } from './artifact-storage.service.ts'
import type { EventBus } from '../event-bus.ts'
import type { AgentSessionRegistry } from './agent/session-registry.ts'
import type { TurnTaskContext } from './agent/turn-task-context.ts'

// Server facts have their own author; they are not user or agent statements.
const SERVER_ACTOR: ArtifactActor = { kind: 'system', id: 'server' }

export class TaskJournalService {
  private registry?: AgentSessionRegistry
  readonly storage: ArtifactStorageService
  readonly repository: TaskJournalRepository
  private readonly events?: EventBus
  constructor(
    storage: ArtifactStorageService,
    repository: TaskJournalRepository,
    events?: EventBus
  ) {
    this.storage = storage
    this.repository = repository
    this.events = events
  }
  attachSessions(registry: AgentSessionRegistry): void {
    this.registry = registry
  }
  list(taskId: string, query: JournalListQuery): JournalPage {
    if (
      !Value.Check(JournalQuery, query) ||
      query.storeId !== this.storage.storeId
    ) {
      throw new ArtifactInputError('Journal store or query is invalid.')
    }
    this.storage.tasks.get(taskId)
    const through = query.throughSeq ?? this.repository.newest(taskId)
    const limit = query.limit ?? DEFAULT_JOURNAL_PAGE_LIMIT
    const rows = this.repository.page(
      taskId,
      through,
      query.beforeSeq ?? Number.MAX_SAFE_INTEGER,
      limit + 1
    )
    const items = takeWithinBytes(rows, limit, MAX_JOURNAL_PAGE_BYTES)
    return {
      items,
      throughSeq: through,
      nextBeforeSeq: rows.length > items.length ? items.at(-1)!.seq : null
    }
  }
  session(query: SessionJournalInput): JournalPage {
    if (
      !Value.Check(SessionJournalQuery, query) ||
      query.storeId !== this.storage.storeId
    ) {
      throw new ArtifactInputError('Journal store or session query is invalid.')
    }
    const through =
      query.throughSeq ?? this.repository.sessionNewest(query.sessionId)
    const limit = query.limit ?? DEFAULT_JOURNAL_PAGE_LIMIT
    const rows = this.repository.sessionPage(
      query.sessionId,
      through,
      query.beforeSeq ?? Number.MAX_SAFE_INTEGER,
      limit + 1
    )
    const items = takeWithinBytes(rows, limit, MAX_JOURNAL_PAGE_BYTES)
    return {
      items,
      throughSeq: through,
      nextBeforeSeq: rows.length > items.length ? items.at(-1)!.seq : null
    }
  }
  search(query: JournalSearchInput): JournalSearchPage {
    if (
      !Value.Check(JournalSearchQuery, query) ||
      (query.storeId !== undefined && query.storeId !== this.storage.storeId) ||
      ((query.beforeSeq !== undefined || query.throughSeq !== undefined) &&
        !query.storeId) ||
      query.query?.includes('\0')
    ) {
      throw new ArtifactInputError('Journal store or search query is invalid.')
    }
    const input = { ...query, query: query.query?.trim() }
    for (const key of ['createdFrom', 'createdTo'] as const) {
      const bound = input[key]
      if (bound !== undefined) {
        const parsed = parseIsoTimestamp(bound)
        if (parsed === null) {
          throw new ArtifactInputError('Invalid journal creation time filter.')
        }
        input[key] = toIsoString(parsed)
      }
    }
    if (
      input.createdFrom &&
      input.createdTo &&
      input.createdFrom > input.createdTo
    ) {
      throw new ArtifactInputError('Journal creation time range is reversed.')
    }
    return this.storage.catalog.transaction(() => {
      const through = input.throughSeq ?? this.repository.newestInStore()
      const limit = input.limit ?? DEFAULT_JOURNAL_PAGE_LIMIT
      const rows = this.repository.search(input, through, limit + 1)
      const items = takeWithinBytes(rows, limit, MAX_JOURNAL_PAGE_BYTES)
      return {
        storeId: this.storage.storeId,
        ...this.repository.filterOptions(input.taskId),
        items,
        throughSeq: through,
        nextBeforeSeq: rows.length > items.length ? items.at(-1)!.seq : null
      }
    })
  }
  append(
    taskId: string,
    input: JournalAppend,
    actor: ArtifactActor,
    turnId?: string
  ): JournalEntry {
    if (
      !Value.Check(JournalAppendBody, input) ||
      !input.body.trim() ||
      input.body.includes('\0') ||
      Buffer.byteLength(input.body) > MAX_JOURNAL_ENTRY_BYTES
    ) {
      throw new ArtifactInputError(
        'Journal entry must contain 1–8192 UTF-8 bytes without NUL.'
      )
    }
    const session =
      actor.kind === 'agent' ? this.registry?.get(actor.id) : undefined
    if (
      actor.kind === 'agent' &&
      (!session || session.kind || !session.canUseTools)
    ) {
      throw new ForbiddenError('A writable ordinary agent session is required.')
    }
    const hash = sha256Hex(
      canonicalJson({ taskId, input, actor, turnId: turnId ?? null })
    )
    const result = this.storage.catalog.transaction(() => {
      const replay = this.repository.replay(input.requestId)
      if (replay) {
        if (replay.hash !== hash) {
          throw new ArtifactConflictError(
            'Journal request identifier already used.'
          )
        }
        return replay.entry
      }
      assertRequestIdFree(
        this.repository.db,
        this.storage.storeId,
        input.requestId,
        otherReceiptTables('task_journal_operations')
      )
      if (
        session &&
        (!turnId ||
          session.turnTaskContext?.turnId !== turnId ||
          !session.turnTaskContext.taskIds.includes(taskId))
      ) {
        throw new ArtifactConflictError(
          'Response task changed. Read tasks.get_context before writing again.'
        )
      }
      if (this.storage.tasks.get(taskId).state !== 'open') {
        throw new TaskClosedError('A closed task journal is read-only.')
      }
      if (input.supersedesEntryId) {
        const previous = this.repository.entry(input.supersedesEntryId)
        if (
          !previous ||
          previous.taskId !== taskId ||
          previous.kind === 'system'
        ) {
          throw new ArtifactInputError(
            'The corrected entry must belong to this task.'
          )
        }
        if (this.repository.isSuperseded(previous.id)) {
          throw new ArtifactConflictError(
            'This entry was already corrected. Refresh the journal.'
          )
        }
      }
      const entry = this.repository.append({
        id: randomUUID(),
        seq: 0,
        storeId: this.storage.storeId,
        taskId,
        kind: input.kind,
        eventType: null,
        body: input.body,
        actor,
        ...(session?.journalContext ? { context: session.journalContext } : {}),
        sessionId: session?.id ?? null,
        turnId: turnId ?? null,
        supersedesEntryId: input.supersedesEntryId ?? null,
        createdAt: new Date().toISOString()
      })
      this.repository.receipt(input.requestId, hash, entry)
      return entry
    })
    this.changed()
    return result
  }
  /** Writes one server fact; a repeated source event writes nothing. */
  fact(
    taskId: string | null,
    sourceEventId: string,
    eventType: JournalEventType,
    body: string,
    turn?: { sessionId: string; turnId?: string },
    context?: JournalContext,
    provenance?: JournalProvenance
  ): void {
    if (taskId !== null) this.storage.tasks.get(taskId)
    if (this.repository.hasFact(taskId, sourceEventId)) return
    this.repository.append(
      {
        id: randomUUID(),
        seq: 0,
        storeId: this.storage.storeId,
        taskId,
        kind: 'system',
        eventType,
        body,
        actor: SERVER_ACTOR,
        ...(context ? { context } : {}),
        ...(provenance ? { provenance } : {}),
        sessionId: turn?.sessionId ?? null,
        turnId: turn?.turnId ?? null,
        supersedesEntryId: null,
        createdAt: new Date().toISOString()
      },
      sourceEventId
    )
  }
  recordEvent(
    turn: TurnTaskContext,
    eventId: number,
    event: unknown,
    redact?: (text: string) => string,
    provenance?: JournalProvenance
  ): void {
    const body = journalEventText(event, redact)
    this.storage.catalog.transaction(() => {
      for (const taskId of turn.taskIds.length ? turn.taskIds : [null]) {
        try {
          this.fact(
            taskId,
            `event:${turn.sessionId}:${turn.turnId}:${eventId}`,
            'agent_event',
            body,
            turn,
            undefined,
            provenance
          )
        } catch (error) {
          if (!(error instanceof ArtifactNotFoundError)) throw error
        }
      }
    })
    this.changed()
  }
  recordTurn(
    turn: TurnTaskContext,
    outcome: 'finished' | 'cancelled' | 'failed',
    context?: JournalContext
  ): void {
    const eventType = `turn_${outcome}` as const
    this.storage.catalog.transaction(() => {
      for (const taskId of turn.taskIds.length ? turn.taskIds : [null]) {
        try {
          this.fact(
            taskId,
            `turn:${turn.sessionId}:${turn.turnId}`,
            eventType,
            eventType,
            turn,
            context
          )
        } catch (error) {
          // A deleted task must not discard the facts of the other tasks.
          if (!(error instanceof ArtifactNotFoundError)) throw error
        }
      }
    })
    this.changed()
  }
  changed(): void {
    this.events?.publish({
      type: 'task-journal:changed',
      storeId: this.storage.storeId
    })
  }
}
