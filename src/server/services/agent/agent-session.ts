import {
  AgentSessionError,
  AgentSessionStateError,
  AgentConfigError
} from '../../errors/agents.ts'
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
const MAX_BUFFERED_EVENTS = 5_000
const STDERR_TAIL_CHARS = 2_000
/** How long a closed connection waits for the `exit` event that carries the reason. */
const EXIT_GRACE_MS = 500

export type AgentEventListener = (envelope: AgentChatEnvelope) => void

export interface AgentSessionOptions {
  preset: AgentPreset
  /** What the chat is called in the UI. */
  name: string
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

  #status: AgentSessionStatus = 'starting'
  /** Set when the user (or the server) ends the session: its exit is no failure. */
  #closing = false
  #error: string | null = null
  #autoApprove = false
  #child: ChildProcess | undefined
  #connection: acp.ClientConnection | undefined
  #acpSessionId: string | undefined
  #embeddedContext = false
  #image = false
  #config: AgentConfigOption[] = []
  #stderrTail = ''
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
  }

  get status(): AgentSessionStatus {
    return this.#status
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
      presetId: this.presetId,
      name: this.name,
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
        const message = errorMessage(error)
        this.#error = message
        this.#emit({ type: 'error', message })
      }
      this.close()
    }
  }

  async #start(): Promise<void> {
    const { preset, cwd } = this.#options
    const child = spawn(preset.command, preset.args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...preset.env }
    })
    this.#child = child
    this.#exited = new Promise(resolve => child.once('exit', resolve))
    child.stderr.setEncoding('utf-8')
    child.stderr.on('data', (chunk: string) => {
      this.#stderrTail = (this.#stderrTail + chunk).slice(-STDERR_TAIL_CHARS)
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

    const created = await connection.agent.request(
      acp.methods.agent.session.new,
      {
        cwd: this.#options.cwd,
        mcpServers: []
      }
    )
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
   */
  /** `value` is `unknown`: the route schema gives it no type (see ConfigBody). */
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
      throw new AgentSessionError(errorMessage(error), { cause: error })
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

  #exitMessage(code: number | null, signal: NodeJS.Signals | null): string {
    const tail = this.#stderrTail.trim()
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
    this.#setStatus('busy')
    this.#emit({
      type: 'user',
      text: display.text,
      context: display.context ?? []
    })
    void this.#runPrompt(connection, sessionId, blocks)
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
    blocks: ContentBlock[]
  ): Promise<void> {
    try {
      const response = await connection.agent.request(
        acp.methods.agent.session.prompt,
        { sessionId, prompt: blocks }
      )
      this.#emit({ type: 'stop', stopReason: response.stopReason })
    } catch (error) {
      // A failure of the transport comes before the `exit` event, and only
      // that event can say why the agent died: let it report first.
      if (!(error instanceof acp.RequestError)) {
        await Promise.race([
          this.#exited,
          delay(EXIT_GRACE_MS, undefined, { ref: false })
        ])
      }
      if (!this.#isClosed() && this.#error === null) {
        this.#emit({ type: 'error', message: errorMessage(error) })
      }
    } finally {
      // A request still open once the turn is over (it ended in an error, say)
      // is dead: answering it later would still make the agent act on it.
      this.#cancelPendingPermissions()
      if (this.#status === 'busy') {
        this.#setStatus('ready')
      }
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
    try {
      await this.#connection.agent.notify(acp.methods.agent.session.cancel, {
        sessionId: this.#acpSessionId
      })
    } catch (error) {
      // The connection closed since the check above: the turn is over anyway.
      if (!this.#isClosed()) {
        throw new AgentSessionError(errorMessage(error), { cause: error })
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

  #onUpdate(update: Parameters<typeof mapSessionUpdate>[0]): void {
    // Agents may speak outside a turn — pi greets with its version and skill
    // list right after session/new. That is noise in a chat transcript.
    if (
      this.#status !== 'busy' &&
      update.sessionUpdate === 'agent_message_chunk'
    ) {
      return
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
    this.#setStatus('closed', this.#error ?? undefined)
    void rm(this.attachmentDir, { recursive: true, force: true }).catch(
      () => {}
    )
    // Unanswered permission requests must not leave the agent blocked forever.
    this.#cancelPendingPermissions()
  }

  #cancelPendingPermissions(): void {
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
