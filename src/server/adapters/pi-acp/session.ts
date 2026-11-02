import { piFailureReason } from './errors.ts'
import { promptToPiMessage } from './vendor/prompt.ts'
import { randomUUID } from 'node:crypto'
import type {
  StopReason,
  ContentBlock,
  McpServer,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionConfigOption,
  SessionUpdate
} from '@agentclientprotocol/sdk'
import { McpRegistry } from './mcp.ts'
import { PiProcess } from './process.ts'
import type { PiProfile } from './compatibility.ts'
import type { ControlFrame } from './control.ts'
import { BRIDGE_TIMEOUT_MS, MAX_PENDING_CALLS } from './control.ts'
import { ARTIFACT_TASK_INSTRUCTIONS } from '../../../shared/artifact-tools/instructions.ts'
import { isRecord } from '../../../shared/utils/guards.ts'

interface Callbacks {
  update: (sessionId: string, update: SessionUpdate) => Promise<void>
  permission: (
    request: RequestPermissionRequest,
    signal: AbortSignal
  ) => Promise<RequestPermissionResponse>
  failure: () => void
}

export class PiSession {
  readonly id = randomUUID()
  readonly registry = new McpRegistry()
  readonly process = new PiProcess()
  #generation = 0
  #turn?: AbortController
  #seen = new Set<string>()
  #pending = 0
  #ready = false
  #closed = false
  #cancelled = false
  #stopReason: StopReason = 'end_turn'
  #agentStarted = false
  #thinking: string[] = []
  #completion?: { resolve: () => void; reject: (error: Error) => void }
  #begun?: () => void
  #models: { id: string; provider: string; name: string }[] = []
  #state: Record<string, unknown> = {}
  readonly profile: PiProfile
  readonly callbacks: Callbacks
  constructor(profile: PiProfile, callbacks: Callbacks) {
    this.profile = profile
    this.callbacks = callbacks
    const failure = () => {
      const wasReady = this.#ready
      this.close()
      if (wasReady) callbacks.failure()
    }
    this.process.onFailure = failure
    this.registry.onFailure = failure
    this.process.onControl = frame => {
      if (
        frame.type === 'begun' &&
        frame.generation === this.#generation &&
        this.#begun
      ) {
        this.#begun()
        this.#begun = undefined
      } else if (frame.type === 'call') {
        void this.call(frame).catch(failure)
      } else {
        failure()
      }
    }
    this.process.onEvent = event => {
      void this.event(event).catch(failure)
    }
  }

  async start(cwd: string, servers: McpServer[]): Promise<void> {
    try {
      await this.registry.connect(servers)
      if (this.#closed) throw new Error('Pi bridge closed during discovery')
      await this.process.start(cwd, this.profile, {
        tools: this.registry.tools,
        instructions: `${this.registry.instructions}\n\n${ARTIFACT_TASK_INSTRUCTIONS}`
      })
      this.#state = await this.process.request('get_state')
      if (!isRecord(this.#state.model)) {
        throw new Error(
          'Pi bridge requires a configured model and authorization in the installed pi'
        )
      }
      const available = await this.process.request('get_available_models')
      if (!Array.isArray(available.models)) {
        throw new Error('Pi runtime did not return its model catalog')
      }
      this.#models = available.models.filter(isRecord).flatMap(model =>
        typeof model.id === 'string' && typeof model.provider === 'string'
          ? [
              {
                id: model.id,
                provider: model.provider,
                name: typeof model.name === 'string' ? model.name : model.id
              }
            ]
          : []
      )
      await this.refreshThinking()
      this.#ready = true
    } catch (error) {
      this.close()
      throw error
    }
  }

  assertSession(id: string): void {
    if (!this.#ready || this.#closed || id !== this.id) {
      throw new Error('Unknown or unavailable pi session')
    }
  }

  get config(): SessionConfigOption[] {
    const model = this.#state.model
    const options: SessionConfigOption[] = [
      {
        type: 'select',
        id: 'thought_level',
        category: 'thought_level',
        name: 'Thinking',
        currentValue: String(this.#state.thinkingLevel),
        options: this.#thinking.map(value => ({ value, name: value }))
      }
    ]
    if (!isRecord(model) || !this.#models.length) return options
    return [
      ...options,
      {
        type: 'select',
        id: 'model',
        category: 'model',
        name: 'Model',
        currentValue: `${String(model.provider)}/${String(model.id)}`,
        options: this.#models.map(value => ({
          value: `${value.provider}/${value.id}`,
          name: value.name
        }))
      }
    ]
  }

  async setConfig(id: string, value: string): Promise<void> {
    if (this.#turn) {
      throw new Error('Pi setting is unavailable')
    }
    if (id === 'thought_level' && this.#thinking.includes(value)) {
      await this.process.request('set_thinking_level', { level: value })
      this.#state = await this.process.request('get_state')
      return
    }
    if (id !== 'model') throw new Error('Unknown pi setting')
    const model = this.#models.find(
      candidate => `${candidate.provider}/${candidate.id}` === value
    )
    if (!model) throw new Error('Unknown pi model')
    await this.process.request('set_model', {
      provider: model.provider,
      modelId: model.id
    })
    this.#state = await this.process.request('get_state')
    await this.refreshThinking()
  }

  private async refreshThinking(): Promise<void> {
    const thinking = await this.process.request('get_available_thinking_levels')
    if (
      !Array.isArray(thinking.levels) ||
      !thinking.levels.every(value => typeof value === 'string')
    ) {
      throw new Error('Pi thinking levels unavailable')
    }
    this.#thinking = thinking.levels
  }

  async prompt(blocks: ContentBlock[]) {
    if (this.#turn || !this.#ready || this.#closed) {
      throw new Error('Pi session is not ready for a prompt')
    }
    const { message, images } = promptToPiMessage(blocks)
    if (this.profile === 'validator' && message.trimStart().startsWith('/')) {
      throw new Error('Validator slash commands are unavailable')
    }
    if (/^\s*\/reload(?:\s|$)/.test(message)) {
      throw new Error('Pi bridge reload requires a new chat')
    }
    const turn = new AbortController()
    this.#turn = turn
    this.#generation++
    this.#cancelled = false
    this.#agentStarted = false
    this.#stopReason = 'end_turn'
    this.#seen.clear()
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.#begun = undefined
          reject(new Error('Pi turn control acknowledgement timed out'))
        }, BRIDGE_TIMEOUT_MS)
        this.#begun = () => {
          clearTimeout(timer)
          resolve()
        }
        this.process.send('begin', { generation: this.#generation })
      })
      if (turn.signal.aborted) return { stopReason: 'cancelled' as const }
      const completion = new Promise<void>((resolve, reject) => {
        this.#completion = { resolve, reject }
      })
      completion.catch(() => {})
      const deadline = setTimeout(() => {
        this.#completion?.reject(new Error('Pi turn deadline exceeded'))
        this.close()
      }, 300000)
      try {
        await this.process.request('prompt', { message, images })
        if (message.trimStart().startsWith('/') && !this.#agentStarted) {
          this.#completion?.resolve()
        }
        await completion
      } finally {
        clearTimeout(deadline)
        this.#completion = undefined
      }
      return {
        stopReason: this.#cancelled ? ('cancelled' as const) : this.#stopReason
      }
    } catch (error) {
      if (this.#cancelled) return { stopReason: 'cancelled' as const }
      throw error
    } finally {
      turn.abort()
      this.#turn = undefined
      this.#seen.clear()
    }
  }

  async cancel(): Promise<void> {
    if (!this.#turn) return
    this.#cancelled = true
    this.#turn.abort()
    this.process.send('cancel', { generation: this.#generation })
    await this.process.request('abort')
  }

  private async call(frame: ControlFrame): Promise<void> {
    const turn = this.#turn
    if (
      !turn ||
      turn.signal.aborted ||
      frame.generation !== this.#generation ||
      typeof frame.id !== 'string' ||
      typeof frame.name !== 'string' ||
      this.#seen.has(frame.id) ||
      this.#seen.size >= 10000 ||
      this.#pending >= MAX_PENDING_CALLS
    ) {
      throw new Error('Invalid, repeated or stale pi call')
    }
    this.#seen.add(frame.id)
    this.#pending++
    const generation = this.#generation
    const id = frame.id
    let result: unknown
    try {
      const snapshot = this.registry.snapshot(frame.name, frame.arguments)
      const signal = AbortSignal.any([
        turn.signal,
        AbortSignal.timeout(BRIDGE_TIMEOUT_MS)
      ])
      const permissionRequest = this.callbacks.permission(
        {
          sessionId: this.id,
          toolCall: {
            toolCallId: id,
            title: snapshot.descriptor.name,
            name: snapshot.descriptor.name,
            kind: 'execute',
            rawInput: structuredClone(snapshot.arguments),
            _meta: {
              githumanPi: {
                server: snapshot.descriptor.server,
                tool: snapshot.descriptor.originalName,
                registryGeneration: 1
              }
            }
          },
          options: [
            { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
            {
              optionId: 'reject_once',
              name: 'Reject once',
              kind: 'reject_once'
            }
          ]
        },
        signal
      )
      let abortPermission: (() => void) | undefined
      let permission: RequestPermissionResponse
      try {
        permission = await Promise.race([
          permissionRequest,
          new Promise<never>((_resolve, reject) => {
            abortPermission = () =>
              reject(
                new Error('Pi permission deadline exceeded or call cancelled')
              )
            if (signal.aborted) {
              abortPermission()
            } else {
              signal.addEventListener('abort', abortPermission, { once: true })
            }
          })
        ])
      } finally {
        if (abortPermission) {
          signal.removeEventListener('abort', abortPermission)
        }
      }
      if (
        signal.aborted ||
        turn !== this.#turn ||
        generation !== this.#generation ||
        permission.outcome.outcome !== 'selected' ||
        permission.outcome.optionId !== 'allow_once'
      ) {
        throw new Error('Pi MCP permission denied or cancelled')
      }
      result = await this.registry.call(frame.name, snapshot.arguments, signal)
    } catch {
      result = {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'Pi MCP call failed, was denied, or was cancelled.'
          }
        ]
      }
    } finally {
      this.#pending--
    }
    if (
      !this.#closed &&
      turn === this.#turn &&
      !turn.signal.aborted &&
      generation === this.#generation
    ) {
      this.process.send('result', { id, generation, result })
    }
  }

  private async event(event: Record<string, unknown>): Promise<void> {
    if (!this.#turn) return
    if (event.type === 'agent_start') this.#agentStarted = true
    if (event.type === 'message_end' && isRecord(event.message)) {
      if (event.message.stopReason === 'length') this.#stopReason = 'max_tokens'
      if (event.message.stopReason === 'refusal') this.#stopReason = 'refusal'
    }
    if (event.type === 'agent_end') {
      this.#completion?.resolve()
      return
    }
    if (
      event.type === 'message_end' &&
      isRecord(event.message) &&
      event.message.stopReason === 'error'
    ) {
      this.#completion?.reject(
        new Error(piFailureReason(event.message.errorMessage))
      )
      return
    }
    if (this.#turn.signal.aborted) return
    let update: SessionUpdate | undefined
    if (
      event.type === 'message_update' &&
      isRecord(event.assistantMessageEvent)
    ) {
      const delta = event.assistantMessageEvent
      if (
        (delta.type === 'text_delta' || delta.type === 'thinking_delta') &&
        typeof delta.delta === 'string'
      ) {
        update = {
          sessionUpdate:
            delta.type === 'text_delta'
              ? 'agent_message_chunk'
              : 'agent_thought_chunk',
          content: { type: 'text', text: delta.delta }
        }
      }
    } else if (
      event.type === 'tool_execution_start' &&
      typeof event.toolCallId === 'string'
    ) {
      update = {
        sessionUpdate: 'tool_call',
        toolCallId: event.toolCallId,
        title: String(event.toolName),
        name: String(event.toolName),
        rawInput: event.args,
        status: 'in_progress',
        kind: 'execute'
      }
    } else if (
      event.type === 'tool_execution_end' &&
      typeof event.toolCallId === 'string'
    ) {
      const result = event.result
      const content =
        isRecord(result) && Array.isArray(result.content)
          ? result.content.filter(isRecord).flatMap(block =>
              block.type === 'text' && typeof block.text === 'string'
                ? [
                    {
                      type: 'content' as const,
                      content: { type: 'text' as const, text: block.text }
                    }
                  ]
                : []
            )
          : []
      update = {
        sessionUpdate: 'tool_call_update',
        toolCallId: event.toolCallId,
        status: event.isError ? 'failed' : 'completed',
        content
      }
    }
    if (update) await this.callbacks.update(this.id, update)
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#turn?.abort()
    this.#completion?.reject(new Error('Pi session closed'))
    this.process.close()
    void this.registry.close()
  }
}
