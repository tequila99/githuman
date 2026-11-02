import { isLocalPiLaunch } from '../../adapters/pi-acp/launch.ts'
import { isRecord } from '../../../shared/utils/guards.ts'
import type {
  TurnTaskContext,
  ActivatedTaskContext
} from './turn-task-context.ts'
import {
  AgentSessionError,
  AgentSessionStateError,
  AgentConfigError
} from '../../errors/agents.ts'
import { ARTIFACT_TASK_PROMPT_HINT } from '../../../shared/artifact-tools/instructions.ts'
import {
  ARTIFACT_AGENT_KEY_ENV,
  ARTIFACT_MCP_SERVER_NAME
} from '../../../shared/artifacts/mcp-constants.ts'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import { errorMessage } from '../../../shared/utils/error-message.ts'
import * as acp from '@agentclientprotocol/sdk'
import type {
  ContentBlock,
  RequestPermissionRequest,
  RequestPermissionResponse
} from '@agentclientprotocol/sdk'
import type {
  AgentChatEnvelope,
  AgentChatEvent,
  AgentConfigOption,
  AgentPermissionOption,
  AgentPermissionRequest,
  AgentPreset,
  AgentSessionKind,
  AgentSessionState,
  AgentPromptRequest,
  AgentSessionInfo,
  AgentSessionStatus
} from '../../../shared/agents/types.ts'
import {
  mapConfigOptions,
  mapPermissionRequest,
  mapSessionUpdate
} from '../../adapters/agents/event-mapper.ts'

/** `npx` may have to download the adapter first. */
const START_TIMEOUT_MS = 90_000
/** Events that one session keeps for a client that joins late or reconnects. */
export const MAX_BUFFERED_EVENTS = 5_000
const STDERR_TAIL_CHARS = 2_000
/** How long a closed connection waits for the `exit` event that carries the reason. */
const EXIT_GRACE_MS = 500
// Bound pending tool context retained only for server permission policies.
const MAX_PERMISSION_TOOL_CALLS = 64

export type AgentEventListener = (envelope: AgentChatEnvelope) => void

export type AgentPermissionPolicy = (
  request: RequestPermissionRequest,
  previous?: acp.ToolCallUpdate
) => { allow: boolean; reason: string }

export interface AgentSessionOptions {
  preset: AgentPreset
  /** Immutable server policy; takes precedence over the user auto-approve switch. */
  permissionPolicy?: AgentPermissionPolicy
  /** What the chat is called in the UI. */
  name: string
  /** Server-created session kind selects the agent execution profile. */
  kind?: AgentSessionKind
  /** Working directory of the agent — the repository root. */
  cwd: string
  reviewId?: string | null
  /**
   * Source of event ids. The registry hands every session the same counter so
   * one `Last-Event-ID` can resume the single stream carrying all chats.
   */
  nextEventId?: () => number
  /** How many events a session keeps for late subscribers. */
  bufferLimit?: number
  taskIds?: (sessionId: string) => string[]
  taskAssignment?: (sessionId: string) => { version: number; taskIds: string[] }
  /** Trusted server configuration; never populated from an HTTP request. */
  mcpServers?: acp.McpServer[] | ((sessionId: string) => acp.McpServer[])
}

interface PendingPermission {
  request: AgentPermissionRequest
  resolve: (response: RequestPermissionResponse) => void
}

/** The option the server picks for an auto-approved request; never a rejection. */
function autoApproveChoice(
  options: readonly AgentPermissionOption[]
): AgentPermissionOption | undefined {
  return (
    options.find(o => o.kind === 'allow_once') ??
    options.find(o => o.kind === 'allow_always')
  )
}

/**
 * One ACP agent subprocess plus its single session. The server is the only
 * ACP client (browsers can't speak stdio); everything the UI sees goes
 * through `subscribe`, which replays the buffered history so a second tab or
 * a reconnect catches up (ADR 0023). Not declaring the `fs`/`terminal` client
 * capabilities means agents read, write and run things on their own.
 */
export class AgentSession {
  readonly id = randomUUID()
  /** Binary attachments of this session's prompts (see context-builder); removed on close. */
  readonly attachmentDir = join(tmpdir(), 'githuman-agent', this.id)
  readonly presetId: string
  readonly name: string
  readonly reviewId: string | null
  readonly kind?: AgentSessionKind

  #turnTaskContext: TurnTaskContext | undefined
  #status: AgentSessionStatus = 'starting'
  /** Set when the user (or the server) ends the session: its exit is no failure. */
  #closing = false
  #error: string | null = null
  #autoApprove = false
  #permissionToolCalls = new Map<string, acp.ToolCallUpdate>()
  #child: ChildProcess | undefined
  #connection: acp.ClientConnection | undefined
  #acpSessionId: string | undefined
  #embeddedContext = false
  #image = false
  #config: AgentConfigOption[] = []
  #stderrTail = ''
  #mcpSecrets: string[] = []
  #hasArtifactMcp = false
  /** Settles when the agent process has exited. */
  #exited: Promise<unknown> = Promise.resolve()
  #ownEventId = 0
  #buffer: AgentChatEnvelope[] = []
  /** Highest id dropped from the buffer; a client that last saw less has lost events. */
  #evictedId = 0
  #listeners = new Set<AgentEventListener>()
  #pendingPermissions = new Map<string, PendingPermission>()
  readonly #options: AgentSessionOptions

  constructor(options: AgentSessionOptions) {
    this.#options = options
    this.presetId = options.preset.id
    this.name = options.name
    this.reviewId = options.reviewId ?? null
    this.kind = options.kind
  }

  get status(): AgentSessionStatus {
    return this.#status
  }

  get turnTaskContext(): TurnTaskContext | undefined {
    return this.#turnTaskContext
  }

  prepareTaskActivation(
    turnId: string,
    assignmentVersion: number,
    taskId: string,
    requestId: string
  ): { context: ActivatedTaskContext; apply: () => void } {
    // Cancellation clears the context before the agent stops reporting busy.
    if (!this.#turnTaskContext || this.#turnTaskContext.turnId !== turnId) {
      throw new AgentSessionStateError(
        'The response ended or its task context changed.'
      )
    }
    const context: ActivatedTaskContext = Object.freeze({
      sessionId: this.id,
      turnId,
      assignmentVersion,
      taskIds: Object.freeze([taskId]),
      source: 'turn_activation',
      activationRequestId: requestId
    })
    // The caller commits and applies synchronously, without yielding to cancellation or another prompt.
    return {
      context,
      apply: () => {
        this.#turnTaskContext = context
      }
    }
  }

  /** Whether the agent advertised `promptCapabilities.embeddedContext`. */
  get supportsEmbeddedContext(): boolean {
    return this.#embeddedContext
  }

  /** Whether the agent advertised `promptCapabilities.image`. */
  get supportsImages(): boolean {
    return this.#image
  }

  info(): AgentSessionInfo {
    return {
      id: this.id,
      ...(this.#options.taskIds
        ? { taskIds: this.#options.taskIds(this.id) }
        : {}),
      presetId: this.presetId,
      name: this.name,
      ...(this.kind === undefined ? {} : { kind: this.kind }),
      status: this.#status,
      reviewId: this.reviewId,
      autoApprove: this.#autoApprove,
      error: this.#error
    }
  }

  /** What the session is now; see `AgentSessionState`. */
  state(): AgentSessionState {
    return {
      sessionId: this.id,
      status: this.#status,
      autoApprove: this.#autoApprove,
      config: this.#config,
      permissions: [...this.#pendingPermissions.values()].map(p => p.request)
    }
  }

  /**
   * Spawns the agent and runs the handshake. Never rejects: a session that
   * cannot start ends up `closed` with the reason in `info().error` and an
   * `error` event, so the UI can show it on the chat's tab.
   */
  async start(): Promise<void> {
    try {
      await this.#start()
    } catch (error) {
      // An exit during the start already reported itself (`#onExit`).
      if (this.#error === null && !this.#closing) {
        const message = this.#redact(errorMessage(error))
        this.#error = message
        this.#emit({ type: 'error', message })
      }
      this.close()
    }
  }

  async #start(): Promise<void> {
    const { preset, cwd } = this.#options
    const localPi = isLocalPiLaunch(preset)
    if (preset.id === 'pi' && this.kind === 'validation' && !localPi) {
      throw new AgentSessionError(
        'Pi validation requires the trusted local GitHuman pi launcher. The configured command is available for chat only.'
      )
    }
    const child = spawn(preset.command, preset.args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...preset.env,
        ...(localPi
          ? {
              GITHUMAN_PI_PROFILE:
                this.kind === 'validation' ? 'validator' : 'chat'
            }
          : {})
      }
    })
    this.#child = child
    this.#exited = new Promise(resolve => child.once('exit', resolve))
    child.stderr.setEncoding('utf-8')
    child.stderr.on('data', (chunk: string) => {
      this.#stderrTail = this.#redact(this.#stderrTail + chunk).slice(
        -STDERR_TAIL_CHARS
      )
    })
    // Swallow stdin EPIPE after the agent died; the closed connection reports it.
    child.stdin.on('error', () => {})

    const died = new Promise<never>((_, reject) => {
      child.once('error', error => {
        reject(
          new AgentSessionError(
            `Cannot start "${preset.command}": ${error.message}`
          )
        )
      })
      child.once('exit', (code, signal) => {
        reject(new AgentSessionError(this.#exitMessage(code, signal)))
      })
    })
    died.catch(() => {})
    child.once('exit', (code, signal) => {
      this.#onExit(code, signal)
    })

    const timer = new AbortController()
    const timedOut = delay(START_TIMEOUT_MS, undefined, {
      signal: timer.signal
    }).then(() => {
      throw new AgentSessionError(
        `Agent did not become ready within ${START_TIMEOUT_MS / 1000}s`
      )
    })
    timedOut.catch(() => {})

    try {
      await Promise.race([this.#handshake(child), died, timedOut])
    } finally {
      timer.abort()
    }
    this.#setStatus('ready')
  }

  async #handshake(child: ChildProcess): Promise<void> {
    if (child.stdin === null || child.stdout === null) {
      throw new AgentSessionError('Agent process has no stdio')
    }
    const stream = acp.ndJsonStream(
      Writable.toWeb(child.stdin),
      // Node's web-stream typing differs from the DOM one the SDK expects.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same stream, differing lib typings
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
    )
    const connection = acp
      .client({ name: 'githuman' })
      .onRequest(acp.methods.client.session.requestPermission, ctx =>
        this.#requestPermission(ctx.params)
      )
      .onNotification(acp.methods.client.session.update, ctx => {
        this.#onUpdate(ctx.params.update)
      })
      .connect(stream)
    this.#connection = connection
    void connection.closed.finally(() => {
      this.#onConnectionClosed()
    })

    const init = await connection.agent.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {}
    })
    const prompt = init.agentCapabilities?.promptCapabilities
    this.#embeddedContext = prompt?.embeddedContext === true
    this.#image = prompt?.image === true

    const mcpServers =
      typeof this.#options.mcpServers === 'function'
        ? this.#options.mcpServers(this.id)
        : (this.#options.mcpServers ?? [])
    this.#hasArtifactMcp = mcpServers.some(
      server => server.name === ARTIFACT_MCP_SERVER_NAME
    )
    this.#mcpSecrets = mcpServers.flatMap(server =>
      'env' in server
        ? server.env
            .filter(entry => entry.name === ARTIFACT_AGENT_KEY_ENV)
            .map(entry => entry.value)
        : []
    )
    const created = await connection.agent.request(
      acp.methods.agent.session.new,
      {
        cwd: this.#options.cwd,
        mcpServers
      }
    )
    if (isLocalPiLaunch(this.#options.preset)) {
      const ack = created['_meta']?.githumanBridge
      if (
        !isRecord(ack) ||
        ack.version !== 1 ||
        ack.profile !== (this.kind === 'validation' ? 'validator' : 'chat') ||
        ack.registryGeneration !== 1
      ) {
        throw new AgentSessionError(
          'Pi bridge did not confirm its launch profile and MCP registry.'
        )
      }
    }
    this.#acpSessionId = created.sessionId
    this.#setConfig(mapConfigOptions(created.configOptions))
  }

  #setConfig(options: AgentConfigOption[]): void {
    this.#config = options
    this.#emit({ type: 'config', options })
  }

  /**
   * Changes a session setting (model, mode, …) and returns the agent's new
   * full set of options. Validated against what the agent itself offered, so
   * an unknown id or value is rejected here rather than sent on.
   * `value` is `unknown`: the route schema gives it no type (see ConfigBody).
   */
  async setConfig(configId: string, value: unknown): Promise<void> {
    const connection = this.#connection
    const sessionId = this.#acpSessionId
    if (this.#status !== 'ready' || !connection || !sessionId) {
      throw new AgentSessionStateError(
        this.#status === 'busy'
          ? 'Settings cannot be changed while the agent is answering'
          : `The session is ${this.#status}`
      )
    }
    const option = this.#config.find(o => o.id === configId)
    if (!option) {
      throw new AgentConfigError(`Unknown setting "${configId}"`)
    }
    if (
      (typeof value !== 'boolean' && typeof value !== 'string') ||
      (option.type === 'boolean'
        ? typeof value !== 'boolean'
        : !option.options?.some(c => c.value === value))
    ) {
      throw new AgentConfigError(`Invalid value for "${option.name}"`)
    }
    try {
      const response = await connection.agent.request(
        acp.methods.agent.session.setConfigOption,
        typeof value === 'boolean'
          ? { sessionId, configId, type: 'boolean', value }
          : { sessionId, configId, value }
      )
      this.#setConfig(mapConfigOptions(response.configOptions))
    } catch (error) {
      throw new AgentSessionError(this.#redact(errorMessage(error)), {
        cause: error
      })
    }
  }

  /** The agent process ended: report why, unless the session itself ended it. */
  #onExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (!this.#closing && this.#error === null && this.#status !== 'closed') {
      this.#error = this.#exitMessage(code, signal)
      this.#emit({ type: 'error', message: this.#error })
    }
    this.#markClosed()
  }

  /**
   * The connection often closes before the `exit` event, and only that event
   * has the exit code. Wait a short time for it before closing without a reason.
   */
  #onConnectionClosed(): void {
    const child = this.#child
    if (
      this.#closing ||
      !child ||
      child.exitCode !== null ||
      child.signalCode !== null
    ) {
      this.#markClosed()
      return
    }
    void this.#closeAfterGrace()
  }

  async #closeAfterGrace(): Promise<void> {
    await delay(EXIT_GRACE_MS, undefined, { ref: false })
    if (!this.#isClosed() && this.#error === null) {
      this.#error = 'Agent closed the connection'
      this.#emit({ type: 'error', message: this.#error })
    }
    this.#markClosed()
  }

  // Hides the session key in errors and stderr. Messages that the agent itself writes stay as they are.
  #redact(text: string): string {
    for (const secret of this.#mcpSecrets) {
      text = text.replaceAll(secret, '[redacted]')
    }
    return text
  }

  #exitMessage(code: number | null, signal: NodeJS.Signals | null): string {
    const tail = this.#redact(this.#stderrTail.trim())
    return (
      `Agent exited (${signal ?? `code ${code}`})` +
      (tail === '' ? '' : `: ${tail.slice(-400)}`)
    )
  }

  /**
   * Sends a prompt and returns immediately; progress arrives as events and the
   * turn ends with a `stop` event (or `error`). One prompt at a time.
   */
  prompt(blocks: ContentBlock[], display: AgentPromptRequest): void {
    const { connection, sessionId } = this.#readyChannel()
    const assignment = this.#options.taskAssignment?.(this.id)
    const turn = Object.freeze({
      turnId: randomUUID(),
      sessionId: this.id,
      assignmentVersion: assignment?.version ?? 0,
      source: 'turn_assignment' as const,
      taskIds: Object.freeze([...(assignment?.taskIds ?? [])])
    })
    this.#turnTaskContext = turn
    this.#setStatus('busy')
    this.#emit({
      type: 'user',
      text: display.text,
      context: display.context ?? []
    })
    // Append the reminder without changing the user transcript or validator assignments.
    const prompt =
      this.#hasArtifactMcp && !this.#options.permissionPolicy
        ? [
            ...blocks,
            { type: 'text' as const, text: ARTIFACT_TASK_PROMPT_HINT }
          ]
        : blocks
    void this.#runPrompt(connection, sessionId, prompt, turn.turnId)
  }

  /**
   * Throws when the session cannot take a prompt now. The route calls this
   * before it builds the context, which can be slow and writes attachments.
   */
  assertCanPrompt(): void {
    this.#readyChannel()
  }

  #readyChannel(): { connection: acp.ClientConnection; sessionId: string } {
    const connection = this.#connection
    const sessionId = this.#acpSessionId
    if (this.#status !== 'ready' || !connection || !sessionId) {
      throw new AgentSessionStateError(
        this.#status === 'busy'
          ? 'The agent is still answering the previous prompt'
          : `The session is ${this.#status}`
      )
    }
    return { connection, sessionId }
  }

  async #runPrompt(
    connection: acp.ClientConnection,
    sessionId: string,
    blocks: ContentBlock[],
    turnId: string
  ): Promise<void> {
    try {
      const response = await connection.agent.request(
        acp.methods.agent.session.prompt,
        { sessionId, prompt: blocks }
      )
      this.#clearTurnTaskContext(turnId)
      this.#emit({ type: 'stop', stopReason: response.stopReason })
    } catch (error) {
      this.#clearTurnTaskContext(turnId)
      // A failure of the transport comes before the `exit` event, and only
      // that event can say why the agent died: let it report first.
      if (!(error instanceof acp.RequestError)) {
        await Promise.race([
          this.#exited,
          delay(EXIT_GRACE_MS, undefined, { ref: false })
        ])
      }
      if (!this.#isClosed() && this.#error === null) {
        this.#emit({
          type: 'error',
          message: this.#redact(errorMessage(error))
        })
      }
    } finally {
      this.#clearTurnTaskContext(turnId)
      // A request still open once the turn is over (it ended in an error, say)
      // is dead: answering it later would still make the agent act on it.
      this.#cancelPendingPermissions()
      if (this.#status === 'busy') {
        this.#setStatus('ready')
      }
    }
  }

  #clearTurnTaskContext(turnId: string): void {
    if (this.#turnTaskContext?.turnId === turnId) {
      this.#turnTaskContext = undefined
    }
  }

  /** A method, so TypeScript does not keep a stale narrowing across an `await`. */
  #isClosed(): boolean {
    return this.#status === 'closed'
  }

  async cancel(): Promise<void> {
    if (this.#status !== 'busy' || !this.#connection || !this.#acpSessionId) {
      return
    }
    // Stop inheritance immediately; the agent may take time to finish cancellation.
    this.#turnTaskContext = undefined
    try {
      await this.#connection.agent.notify(acp.methods.agent.session.cancel, {
        sessionId: this.#acpSessionId
      })
    } catch (error) {
      // The connection closed since the check above: the turn is over anyway.
      if (!this.#isClosed()) {
        throw new AgentSessionError(this.#redact(errorMessage(error)), {
          cause: error
        })
      }
    }
  }

  /**
   * Returns false when no such request is pending (already answered or
   * cancelled). Throws when `optionId` is not one the agent offered.
   */
  answerPermission(requestId: string, optionId: string | undefined): boolean {
    const pending = this.#pendingPermissions.get(requestId)
    if (!pending) {
      return false
    }
    if (
      optionId !== undefined &&
      !pending.request.options.some(option => option.optionId === optionId)
    ) {
      throw new AgentConfigError(`Unknown option "${optionId}"`)
    }
    pending.resolve(
      optionId === undefined
        ? { outcome: { outcome: 'cancelled' } }
        : { outcome: { outcome: 'selected', optionId } }
    )
    return true
  }

  /**
   * Switches the server answering the agent's permission requests itself (see
   * `autoApproveChoice`), requests already waiting included. Off by default;
   * the UI only turns it on after warning the user.
   */
  setAutoApprove(enabled: boolean): void {
    if (this.#status === 'closed') {
      throw new AgentSessionStateError('The session is closed')
    }
    if (enabled && this.#options.permissionPolicy) {
      throw new AgentSessionStateError(
        'This session uses a fixed permission policy.'
      )
    }
    if (this.#autoApprove === enabled) {
      return
    }
    this.#autoApprove = enabled
    this.#emit({ type: 'auto-approve', enabled })
    if (!enabled) {
      return
    }
    // Resolving removes the entry being visited, which Map iteration allows.
    for (const pending of this.#pendingPermissions.values()) {
      const response = this.#autoApprovePermission(pending.request)
      if (response) {
        pending.resolve(response)
      }
    }
  }

  #autoApprovePermission(request: {
    options: readonly AgentPermissionOption[]
    title: string
  }): RequestPermissionResponse | undefined {
    const choice = autoApproveChoice(request.options)
    if (!choice) {
      return undefined
    }
    this.#emit({ type: 'auto-approved', title: request.title })
    return { outcome: { outcome: 'selected', optionId: choice.optionId } }
  }

  #requestPermission(
    params: RequestPermissionRequest
  ): Promise<RequestPermissionResponse> {
    // Requests belong to a turn; one arriving outside it has nobody to answer it.
    if (this.#status !== 'busy') {
      return Promise.resolve({ outcome: { outcome: 'cancelled' } })
    }
    if (this.#options.permissionPolicy) {
      return Promise.resolve(this.#policyPermission(params))
    }
    const requestId = randomUUID()
    const request = mapPermissionRequest(requestId, params)
    if (this.#autoApprove) {
      const response = this.#autoApprovePermission(request)
      if (response) {
        return Promise.resolve(response)
      }
    }
    return new Promise(resolve => {
      this.#pendingPermissions.set(requestId, {
        request,
        resolve: response => {
          this.#pendingPermissions.delete(requestId)
          this.#emit({ type: 'permission-resolved', requestId })
          resolve(response)
        }
      })
      this.#emit(request)
    })
  }

  #policyPermission(
    params: RequestPermissionRequest
  ): RequestPermissionResponse {
    const previous = this.#permissionToolCalls.get(params.toolCall.toolCallId)
    this.#permissionToolCalls.delete(params.toolCall.toolCallId)
    let decision = {
      allow: false,
      reason: 'Permission policy could not verify this action.'
    }
    try {
      decision = this.#options.permissionPolicy!(params, previous)
    } catch {
      // Policy failures must not create a manual prompt or grant an action.
    }
    const choice = decision.allow
      ? params.options.find(option => option.kind === 'allow_once')
      : undefined
    if (choice) {
      this.#emit({ type: 'auto-approved', title: decision.reason })
      return { outcome: { outcome: 'selected', optionId: choice.optionId } }
    }
    this.#emit({
      type: 'tool',
      toolCallId: params.toolCall.toolCallId,
      title: 'Validation permission denied',
      status: 'failed',
      output: decision.allow
        ? 'Permission policy requires an allow_once option.'
        : decision.reason
    })
    const reject = params.options.find(option => option.kind === 'reject_once')
    return reject
      ? { outcome: { outcome: 'selected', optionId: reject.optionId } }
      : { outcome: { outcome: 'cancelled' } }
  }

  #onUpdate(update: Parameters<typeof mapSessionUpdate>[0]): void {
    // Agents may speak outside a turn — pi greets with its version and skill
    // list right after session/new. That is noise in a chat transcript.
    if (
      this.#status !== 'busy' &&
      update.sessionUpdate === 'agent_message_chunk'
    ) {
      return
    }
    if (
      this.#options.permissionPolicy &&
      this.#status === 'busy' &&
      (update.sessionUpdate === 'tool_call' ||
        update.sessionUpdate === 'tool_call_update')
    ) {
      if (update.status === 'completed' || update.status === 'failed') {
        this.#permissionToolCalls.delete(update.toolCallId)
      } else {
        const previous = this.#permissionToolCalls.get(update.toolCallId)
        this.#permissionToolCalls.set(update.toolCallId, {
          ...previous,
          ...update
        })
        if (this.#permissionToolCalls.size > MAX_PERMISSION_TOOL_CALLS) {
          this.#permissionToolCalls.delete(
            this.#permissionToolCalls.keys().next().value!
          )
        }
      }
    }
    const event = mapSessionUpdate(update)
    if (event?.type === 'config') {
      // Keep `#config` current: `setConfig` checks values against it.
      this.#setConfig(event.options)
    } else if (event) {
      this.#emit(event)
    }
  }

  /**
   * Buffered events newer than `afterId`. `gap` means the buffer no longer
   * reaches back to `afterId`: the client missed events for good and should
   * rebuild this chat from what is left.
   */
  replay(afterId: number): { envelopes: AgentChatEnvelope[]; gap: boolean } {
    return {
      envelopes: this.#buffer.filter(envelope => envelope.id > afterId),
      gap: afterId > 0 && this.#evictedId > afterId
    }
  }

  /** Delivers live events (no replay — see `replay`). Returns an unsubscribe function. */
  onEvent(listener: AgentEventListener): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #emit(event: AgentChatEvent): void {
    const id = this.#options.nextEventId?.() ?? ++this.#ownEventId
    const envelope: AgentChatEnvelope = { id, event }
    this.#buffer.push(envelope)
    const limit = this.#options.bufferLimit ?? MAX_BUFFERED_EVENTS
    if (this.#buffer.length > limit) {
      const dropped = this.#buffer.splice(0, this.#buffer.length - limit)
      this.#evictedId = dropped.at(-1)?.id ?? this.#evictedId
    }
    for (const listener of this.#listeners) {
      listener(envelope)
    }
  }

  #setStatus(status: AgentSessionStatus, error?: string): void {
    if (this.#status === status) {
      return
    }
    this.#status = status
    this.#emit({
      type: 'status',
      status,
      ...(error === undefined ? {} : { error })
    })
  }

  #markClosed(): void {
    if (this.#status === 'closed') {
      return
    }
    this.#turnTaskContext = undefined
    this.#setStatus('closed', this.#error ?? undefined)
    void rm(this.attachmentDir, { recursive: true, force: true }).catch(
      () => {}
    )
    // Unanswered permission requests must not leave the agent blocked forever.
    this.#cancelPendingPermissions()
  }

  #cancelPendingPermissions(): void {
    this.#permissionToolCalls.clear()
    // Each resolver removes itself from the map, which Map iteration allows.
    for (const pending of this.#pendingPermissions.values()) {
      pending.resolve({ outcome: { outcome: 'cancelled' } })
    }
  }

  close(): void {
    this.#closing = true
    this.#markClosed()
    this.#connection?.close()
    if (
      this.#child &&
      this.#child.exitCode === null &&
      this.#child.signalCode === null
    ) {
      this.#child.kill()
    }
  }
}
