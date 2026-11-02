import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import { Value } from '@sinclair/typebox/value'
import { ARTIFACT_TASK_INSTRUCTIONS } from '../../shared/artifact-tools/instructions.ts'
import { ARTIFACT_TOOL_DESCRIPTIONS } from '../../shared/artifact-tools/descriptions.ts'
import { ArtifactToolSchemas } from '../../shared/artifact-tools/schemas.ts'
import {
  ARTIFACT_AGENT_KEY_ENV,
  ARTIFACT_AGENT_KEY_PATTERN,
  ARTIFACT_AGENT_URL_ENV,
  ARTIFACT_BRIDGE_PATH_PREFIX,
  ARTIFACT_MCP_MAX_MESSAGE_BYTES
} from '../../shared/artifacts/mcp-constants.ts'
import { isRecord } from '../../shared/utils/guards.ts'
import { getAppVersion } from '../../server/app-version.ts'

// Fail boundedly when serve disappears; retries use the original request ID.
const REQUEST_TIMEOUT_MS = 30_000
// MCP tool names allow no dots, so operation names map dots to underscores.
const TOOLS = new Map(
  Object.entries(ArtifactToolSchemas).map(([operation, schema]) => [
    operation.replaceAll('.', '_'),
    {
      operation,
      schema,
      description: ARTIFACT_TOOL_DESCRIPTIONS[operation] ?? schema.description
    }
  ])
)

function toolError(text: string) {
  return { isError: true, content: [{ type: 'text' as const, text }] }
}

export async function runMcp(argv: string[]): Promise<void> {
  if (argv.length !== 1 || argv[0] !== '--stdio') {
    throw new Error('Usage: githuman mcp --stdio')
  }
  const endpoint = process.env[ARTIFACT_AGENT_URL_ENV]
  const key = process.env[ARTIFACT_AGENT_KEY_ENV]
  if (!endpoint || !key || !ARTIFACT_AGENT_KEY_PATTERN.test(key)) {
    throw new Error('Artifact MCP requires a running GitHuman agent session.')
  }
  const url = new URL(endpoint)
  if (
    url.protocol !== 'http:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Invalid GitHuman server address.')
  }
  const server = new Server(
    { name: 'githuman-artifacts', version: getAppVersion() },
    { capabilities: { tools: {} }, instructions: ARTIFACT_TASK_INSTRUCTIONS }
  )
  const active = new AbortController()
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [...TOOLS].map(([name, { schema, description }]) => ({
      name,
      description,
      inputSchema: { ...schema, type: 'object' as const }
    }))
  }))
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const tool = TOOLS.get(request.params.name)
    if (!tool) {
      return toolError(`Unknown artifact tool "${request.params.name}".`)
    }
    const args = request.params.arguments ?? {}
    // The message names the field and the rule, never the rejected value.
    const invalid = Value.Errors(tool.schema, args).First()
    if (invalid) {
      return toolError(
        `Invalid parameters for ${request.params.name}: ${invalid.path || '/'} ${invalid.message}.`
      )
    }
    let response: Response
    try {
      response = await fetch(
        new URL(`${ARTIFACT_BRIDGE_PATH_PREFIX}${tool.operation}`, url),
        {
          method: 'POST',
          redirect: 'error',
          headers: {
            authorization: `Bearer ${key}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify(args),
          signal: AbortSignal.any([
            active.signal,
            extra.signal,
            AbortSignal.timeout(REQUEST_TIMEOUT_MS)
          ])
        }
      )
    } catch (error) {
      const name = error instanceof Error ? error.name : ''
      return toolError(
        name === 'TimeoutError' || name === 'AbortError'
          ? 'The GitHuman artifact request timed out or was cancelled.'
          : 'GitHuman artifact server is unavailable.'
      )
    }
    let result: unknown
    try {
      result = await response.json()
    } catch {
      result = undefined
    }
    if (!isRecord(result)) {
      return toolError(
        `GitHuman artifact server returned an unreadable response (HTTP ${response.status}).`
      )
    }
    return {
      isError: !response.ok,
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      structuredContent: result
    }
  })
  const transport = new StdioServerTransport(undefined, undefined, {
    maxBufferSize: ARTIFACT_MCP_MAX_MESSAGE_BYTES
  })
  // oxlint-disable-next-line unicorn/prefer-add-event-listener -- MCP SDK exposes a callback property, not EventTarget
  server.onclose = () => active.abort()
  process.stdin.once('end', () => {
    active.abort()
    void server.close()
  })
  await server.connect(transport)
}
