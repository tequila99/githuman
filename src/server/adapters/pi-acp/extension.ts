/// <reference lib="es2024.promise" />

import { Socket } from 'node:net'
import { addAbortListener } from 'node:events'
import type { Readable, Writable } from 'node:stream'
import {
  JsonChannel,
  CONTROL_VERSION,
  BRIDGE_TIMEOUT_MS,
  MAX_PENDING_CALLS
} from './control.ts'
import type { RegistryTool } from './mcp.ts'
import { isRecord } from '../../../shared/utils/guards.ts'

// Bound late-result tracking without retaining call arguments or results.
const MAX_RETIRED_CALLS = 10000

interface PiApi {
  registerTool(tool: {
    name: string
    label: string
    description: string
    parameters: RegistryTool['inputSchema']
    execute: (
      id: string,
      input: unknown,
      signal?: AbortSignal
    ) => Promise<unknown>
  }): void
  on(event: string, handler: (event: Record<string, unknown>) => unknown): void
  getAllTools(): { name: string }[]
  setActiveTools(names: string[]): void
}

export default async function extension(pi: PiApi): Promise<void> {
  const nonce = process.env.GITHUMAN_PI_NONCE ?? ''
  delete process.env.GITHUMAN_PI_NONCE
  if (
    !nonce ||
    typeof pi.registerTool !== 'function' ||
    typeof pi.getAllTools !== 'function'
  ) {
    throw new Error('Pi bridge extension capabilities are unavailable')
  }
  await initializePiExtension(pi, {
    nonce,
    input: new Socket({ fd: 4, readable: true, writable: false }),
    output: new Socket({ fd: 3, readable: false, writable: true }),
    exit: () => process.exit(1)
  })
}

export async function initializePiExtension(
  pi: PiApi,
  options: {
    nonce: string
    input: Readable
    output: Writable
    exit: () => never
  }
): Promise<void> {
  const { nonce } = options
  const pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  const retired = new Set<string>()
  let generation = 0
  let configured = false
  let profile = ''
  let instructions = ''
  let names = new Set<string>()
  let registerTools: (() => void) | undefined
  let ready = false
  const configuration = Promise.withResolvers<void>()
  const shutdown: () => never = () => {
    for (const request of pending.values()) {
      request.reject(new Error('Pi bridge control channel closed'))
    }
    pending.clear()
    return options.exit()
  }
  const channel = new JsonChannel(
    options.input,
    options.output,
    frame => {
      if (frame.nonce !== nonce) shutdown()
      if (frame.type === 'configure') {
        if (
          configured ||
          !Array.isArray(frame.tools) ||
          !['validator', 'chat'].includes(String(frame.profile)) ||
          typeof frame.instructions !== 'string'
        ) {
          shutdown()
        }
        configured = true
        profile = String(frame.profile)
        instructions = frame.instructions
        const tools = frame.tools.filter(isRegistryTool)
        if (
          tools.some(
            tool =>
              !isRecord(tool) ||
              typeof tool.name !== 'string' ||
              typeof tool.description !== 'string' ||
              !isRecord(tool.inputSchema)
          )
        ) {
          shutdown()
        }
        names = new Set(tools.map(tool => tool.name))
        if (names.size !== tools.length) shutdown()
        registerTools = () => {
          for (const tool of tools) {
            pi.registerTool({
              name: tool.name,
              label: tool.name,
              description: tool.description,
              parameters: tool.inputSchema,
              execute: async (id, toolInput, signal) => {
                if (
                  !generation ||
                  pending.size >= MAX_PENDING_CALLS ||
                  signal?.aborted
                ) {
                  throw new Error('Pi bridge call is not active')
                }
                const callGeneration = generation
                const key = `${callGeneration}:${id}`
                if (pending.has(key) || retired.has(key)) {
                  throw new Error('Duplicate pi bridge call ID')
                }
                const response = Promise.withResolvers<unknown>()
                let abortListener: Disposable | undefined
                let settled = false
                const timer = setTimeout(
                  () => reject(new Error('Pi bridge tool deadline exceeded')),
                  BRIDGE_TIMEOUT_MS
                )
                const cleanup = () => {
                  clearTimeout(timer)
                  abortListener?.[Symbol.dispose]()
                  pending.delete(key)
                }
                function reject(error: Error) {
                  if (settled) return
                  settled = true
                  // A timed-out or cancelled call can still receive one backend response.
                  retired.add(key)
                  if (retired.size > MAX_RETIRED_CALLS) {
                    retired.delete(retired.values().next().value!)
                  }
                  cleanup()
                  response.reject(error)
                }
                pending.set(key, {
                  resolve: value => {
                    if (settled) return
                    settled = true
                    cleanup()
                    response.resolve(value)
                  },
                  reject
                })
                let result: unknown
                try {
                  try {
                    if (signal) {
                      abortListener = addAbortListener(signal, () =>
                        reject(new Error('Pi bridge call cancelled'))
                      )
                    }
                    send('call', {
                      id,
                      generation: callGeneration,
                      name: tool.name,
                      arguments: toolInput
                    })
                  } catch (error) {
                    settled = true
                    cleanup()
                    response.reject(error)
                  }
                  result = await response.promise
                } finally {
                  cleanup()
                }
                if (
                  generation !== callGeneration ||
                  signal?.aborted ||
                  !isRecord(result) ||
                  !Array.isArray(result.content)
                ) {
                  throw new Error(
                    'Pi bridge returned a stale or malformed result'
                  )
                }
                if (result.isError === true) {
                  throw new Error(
                    result.content
                      .filter(isRecord)
                      .map(block =>
                        block.type === 'text' ? String(block.text) : ''
                      )
                      .join('\n') || 'MCP tool failed'
                  )
                }
                const content = result.content.filter(isRecord).map(block => {
                  if (block.type === 'text' || block.type === 'image') {
                    return block
                  }
                  if (
                    block.type === 'resource' &&
                    isRecord(block.resource) &&
                    typeof block.resource.text === 'string'
                  ) {
                    return { type: 'text', text: block.resource.text }
                  }
                  return { type: 'text', text: JSON.stringify(block) }
                })
                return {
                  content,
                  details: { structuredContent: result.structuredContent }
                }
              }
            })
          }
        }
        configuration.resolve()
      } else if (frame.type === 'begin') {
        if (
          !configured ||
          !Number.isSafeInteger(frame.generation) ||
          Number(frame.generation) <= generation
        ) {
          shutdown()
        }
        generation = Number(frame.generation)
        send('begun', { generation })
      } else if (frame.type === 'cancel') {
        generation = 0
        for (const request of pending.values()) {
          request.reject(new Error('Pi bridge call cancelled'))
        }
        pending.clear()
      } else if (frame.type === 'result') {
        if (
          typeof frame.id !== 'string' ||
          !Number.isSafeInteger(frame.generation)
        ) {
          shutdown()
        }
        const key = `${String(frame.generation)}:${frame.id}`
        // Only calls already rejected locally may have a harmless late result.
        if (retired.delete(key)) return
        if (frame.generation !== generation) shutdown()
        const request = pending.get(key)
        if (!request) shutdown()
        request.resolve(frame.result)
      } else {
        shutdown()
      }
    },
    shutdown
  )
  function send(type: string, fields: Record<string, unknown> = {}) {
    channel.send({ ...fields, type, nonce, version: CONTROL_VERSION })
  }
  const timer = setTimeout(shutdown, BRIDGE_TIMEOUT_MS)
  try {
    send('hello')
    await configuration.promise
  } finally {
    clearTimeout(timer)
  }
  pi.on('session_start', () => {
    if (ready) {
      send('fatal', { reason: 'reload' })
      shutdown()
    }
    ready = true
    const all = pi.getAllTools().map(tool => tool.name)
    if ([...names].some(name => all.includes(name))) {
      send('fatal', { reason: 'tool_name_collision' })
      shutdown()
    }
    registerTools?.()
    if (profile === 'validator') pi.setActiveTools([...names])
    send('ready', { profile, registryGeneration: 1 })
  })
  // Only validator installs a native/custom tool guard. MCP approval lives in execute.
  if (profile === 'validator') {
    pi.on('tool_call', event =>
      names.has(String(event.toolName))
        ? undefined
        : {
            block: true,
            reason: 'Validator denies tools outside its immutable MCP registry.'
          }
    )
  }
  pi.on('before_agent_start', event => ({
    systemPrompt: `${String(event.systemPrompt)}\n\n${instructions}`
  }))
  pi.on('session_shutdown', shutdown)
}

function isRegistryTool(value: unknown): value is RegistryTool {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.description === 'string' &&
    typeof value.server === 'string' &&
    typeof value.originalName === 'string' &&
    isRecord(value.inputSchema) &&
    value.inputSchema.type === 'object'
  )
}
