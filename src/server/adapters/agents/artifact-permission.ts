import type { TSchema } from '@sinclair/typebox'
import type {
  RequestPermissionRequest,
  ToolCallUpdate
} from '@agentclientprotocol/sdk'
import { ArtifactToolSchemas } from '../../../shared/artifact-tools/schemas.ts'
import { ARTIFACT_MCP_SERVER_NAME } from '../../../shared/artifacts/mcp-constants.ts'
import { isRecord } from '../../../shared/utils/guards.ts'

// MCP names replace operation dots with underscores on the stdio bridge.
const OPERATIONS = new Map(
  Object.entries(ArtifactToolSchemas).map(([operation, schema]) => [
    operation.replaceAll('.', '_'),
    { operation, schema }
  ])
)
// Claude's qualified name binds an operation to the configured server.
const CLAUDE_PREFIX = `mcp__${ARTIFACT_MCP_SERVER_NAME}__`

export function artifactPermissionCall(
  request: RequestPermissionRequest,
  previous?: ToolCallUpdate,
  presetId?: string
): { operation: string; schema: TSchema; input: unknown } | undefined {
  const call = request.toolCall
  const pi = call['_meta']?.githumanPi
  if (
    pi !== undefined &&
    (!isRecord(pi) ||
      pi.server !== ARTIFACT_MCP_SERVER_NAME ||
      pi.registryGeneration !== 1 ||
      call.name !== `${CLAUDE_PREFIX}${String(pi.tool)}`)
  ) {
    return undefined
  }
  const claude = call['_meta']?.claudeCode
  const metadataName = isRecord(claude) ? claude.toolName : undefined
  const name = call.name ?? metadataName
  if (name !== undefined) {
    if (typeof name !== 'string' || !name.startsWith(CLAUDE_PREFIX)) {
      return undefined
    }
    if (metadataName !== undefined && metadataName !== name) return undefined
    if (
      previous?.name !== undefined &&
      previous.name !== null &&
      previous.name !== name
    ) {
      return undefined
    }
    if (isRecord(claude) && claude.mcpServer !== undefined) {
      if (
        !isRecord(claude.mcpServer) ||
        claude.mcpServer.name !== ARTIFACT_MCP_SERVER_NAME
      ) {
        return undefined
      }
    }
    const operation = OPERATIONS.get(name.slice(CLAUDE_PREFIX.length))
    return operation ? { ...operation, input: call.rawInput } : undefined
  }
  // Cursor supplies MCP identity in the correlated tool update, not the permission card.
  if (presetId === 'cursor' && call.kind === 'other') {
    if (
      call.rawInput !== undefined ||
      request['_meta']?.is_mcp_tool_approval !== undefined ||
      !previous ||
      previous.toolCallId !== call.toolCallId ||
      previous.kind !== 'other' ||
      (previous.name !== undefined && previous.name !== null)
    ) {
      return undefined
    }
    const input = previous.rawInput
    if (
      !isRecord(input) ||
      input.providerIdentifier !== ARTIFACT_MCP_SERVER_NAME ||
      typeof input.toolName !== 'string' ||
      !isRecord(input.args) ||
      Object.keys(input).some(
        key => !['providerIdentifier', 'toolName', 'args'].includes(key)
      )
    ) {
      return undefined
    }
    const operation = OPERATIONS.get(input.toolName)
    return operation ? { ...operation, input: input.args } : undefined
  }
  // Codex omits call details only for a correlated MCP approval, not an elicitation.
  if (
    request['_meta']?.is_mcp_tool_approval !== true ||
    call.rawInput !== undefined ||
    call.kind !== 'execute'
  ) {
    return undefined
  }
  if (
    !previous ||
    previous.toolCallId !== call.toolCallId ||
    previous.kind !== 'execute' ||
    (previous.name !== undefined && previous.name !== null)
  ) {
    return undefined
  }
  const input = previous.rawInput
  if (
    !isRecord(input) ||
    input.server !== ARTIFACT_MCP_SERVER_NAME ||
    typeof input.tool !== 'string'
  ) {
    return undefined
  }
  if (
    Object.keys(input).some(
      key => !['server', 'tool', 'arguments'].includes(key)
    )
  ) {
    return undefined
  }
  const operation = OPERATIONS.get(input.tool)
  return operation ? { ...operation, input: input.arguments } : undefined
}
