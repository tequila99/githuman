import { terminateProcesses } from '../../services/terminal/processes.ts'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js'
import type { McpServer } from '@agentclientprotocol/sdk'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { isRecord } from '../../../shared/utils/guards.ts'
import { BRIDGE_TIMEOUT_MS } from './control.ts'

// Bound discovery across pages and servers before exposing any tools.
const MAX_TOOLS = 512
// Repeated or excessive cursors cannot keep session/new pending.
const MAX_PAGES = 32
// pi's built-in tool names must never resolve to MCP backends.
const BUILTIN_NAMES = new Set([
  'read',
  'write',
  'edit',
  'bash',
  'powershell',
  'grep',
  'find',
  'ls',
  'tool_search',
  'codemode'
])

export interface RegistryTool {
  name: string
  description: string
  inputSchema: Tool['inputSchema']
  server: string
  originalName: string
}

function isValidMcpName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(name)
}

export class McpRegistry {
  readonly #entries = new Map<
    string,
    {
      descriptor: RegistryTool
      client: Client
      validate: ReturnType<AjvJsonSchemaValidator['getValidator']>
    }
  >()
  readonly #clients: Client[] = []
  readonly #transports: StdioClientTransport[] = []
  readonly #instructions: string[] = []
  #closed = false
  onFailure: () => void = () => {}

  get tools(): RegistryTool[] {
    return structuredClone(
      [...this.#entries.values()].map(entry => entry.descriptor)
    )
  }
  get instructions(): string {
    return this.#instructions.join('\n\n')
  }

  async connect(servers: McpServer[]): Promise<void> {
    if (servers.length > 8) throw new Error('Too many pi MCP servers')
    const names = new Set<string>()
    const schemas = new AjvJsonSchemaValidator()
    try {
      for (const server of servers) {
        if (
          'type' in server ||
          !isValidMcpName(server.name) ||
          names.has(server.name)
        ) {
          throw new Error(
            'Pi bridge requires unique server-owned stdio MCP descriptors'
          )
        }
        names.add(server.name)
        const env: Record<string, string> = {}
        for (const entry of server.env) {
          if (Object.hasOwn(env, entry.name)) {
            throw new Error('Duplicate MCP environment variable')
          }
          env[entry.name] = entry.value
        }
        const transport = new StdioClientTransport({
          command: server.command,
          args: [...server.args],
          env,
          maxBufferSize: 16 * 1024 * 1024,
          stderr: 'pipe'
        })
        this.#transports.push(transport)
        const client = new Client({ name: 'githuman-pi-bridge', version: '1' })
        this.#clients.push(client)
        // oxlint-disable-next-line unicorn/prefer-add-event-listener -- MCP Client exposes onclose as a callback property.
        client.onclose = () => {
          if (!this.#closed) this.onFailure()
        }
        transport.stderr?.on('data', () => {})
        await client.connect(transport, { timeout: BRIDGE_TIMEOUT_MS })
        const instructions = client.getInstructions()
        if (instructions) this.#instructions.push(instructions)
        const cursors = new Set<string>()
        let cursor: string | undefined
        for (let page = 0; ; page++) {
          if (page >= MAX_PAGES) {
            throw new Error('MCP tools/list page limit exceeded')
          }
          const response = await client.listTools(cursor ? { cursor } : {}, {
            timeout: BRIDGE_TIMEOUT_MS
          })
          for (const tool of response.tools) {
            const name = `mcp__${server.name}__${tool.name}`
            if (
              !isValidMcpName(tool.name) ||
              name.length > 128 ||
              BUILTIN_NAMES.has(tool.name) ||
              this.#entries.has(name) ||
              this.#entries.size >= MAX_TOOLS
            ) {
              throw new Error(
                'MCP tool name collision or registry limit exceeded'
              )
            }
            const descriptor = structuredClone({
              name,
              description: tool.description ?? tool.name,
              inputSchema: tool.inputSchema,
              server: server.name,
              originalName: tool.name
            })
            this.#entries.set(name, {
              descriptor,
              client,
              validate: schemas.getValidator(descriptor.inputSchema)
            })
          }
          cursor = response.nextCursor
          if (!cursor) break
          if (cursors.has(cursor)) {
            throw new Error('MCP tools/list repeated a cursor')
          }
          cursors.add(cursor)
        }
      }
    } catch (error) {
      await this.close()
      throw error
    }
  }

  snapshot(
    name: string,
    input: unknown
  ): { descriptor: RegistryTool; arguments: Record<string, unknown> } {
    const entry = this.#entries.get(name)
    if (!entry || !isRecord(input)) {
      throw new Error('Unknown MCP tool or invalid arguments')
    }
    const args: unknown = JSON.parse(JSON.stringify(input))
    if (!isRecord(args) || !entry.validate(args).valid) {
      throw new Error('MCP arguments do not match the registered schema')
    }
    return { descriptor: structuredClone(entry.descriptor), arguments: args }
  }

  async call(name: string, args: Record<string, unknown>, signal: AbortSignal) {
    const entry = this.#entries.get(name)
    if (!entry || this.#closed || signal.aborted) {
      throw new Error('MCP call is no longer active')
    }
    return entry.client.callTool(
      { name: entry.descriptor.originalName, arguments: args },
      undefined,
      { signal, timeout: BRIDGE_TIMEOUT_MS }
    )
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    await Promise.allSettled(
      this.#transports.map(transport =>
        transport.pid ? terminateProcesses(transport.pid) : Promise.resolve()
      )
    )
    await Promise.allSettled(this.#clients.map(client => client.close()))
    await Promise.allSettled(
      this.#transports.map(transport => transport.close())
    )
    this.#entries.clear()
  }
}
