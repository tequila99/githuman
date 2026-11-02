import { test } from 'node:test'
import assert from 'node:assert/strict'
import type {
  RequestPermissionRequest,
  ToolCallUpdate
} from '@agentclientprotocol/sdk'
import { artifactPermissionCall } from '../../../../src/server/adapters/agents/artifact-permission.ts'

const request: RequestPermissionRequest = {
  sessionId: 'session',
  toolCall: {
    toolCallId: 'call',
    name: 'mcp__githuman_artifacts__validations_get',
    rawInput: { id: 'validation' }
  },
  options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }]
}

test('Claude resolves a qualified name or matching adapter metadata, never the title', () => {
  assert.equal(artifactPermissionCall(request)?.operation, 'validations.get')
  const metadata = {
    ...request,
    toolCall: {
      ...request.toolCall,
      name: undefined,
      _meta: { claudeCode: { toolName: request.toolCall.name } }
    }
  }
  assert.deepEqual(
    artifactPermissionCall(metadata),
    artifactPermissionCall(request)
  )
  for (const toolCall of [
    {
      toolCallId: 'call',
      title: 'mcp__githuman_artifacts__validations_get',
      rawInput: { id: 'validation' }
    },
    { ...request.toolCall, name: 'Bash', title: request.toolCall.name },
    { ...request.toolCall, name: 'mcp__other__validations_get' },
    {
      ...request.toolCall,
      name: 'mcp__githuman_artifacts__validations_get_extra'
    },
    { ...request.toolCall, _meta: { claudeCode: { toolName: 'Bash' } } },
    {
      ...request.toolCall,
      _meta: { claudeCode: { mcpServer: { name: 'other' } } }
    }
  ]) {
    assert.equal(artifactPermissionCall({ ...request, toolCall }), undefined)
  }
})

test('Codex requires an MCP approval marker and matching structured tool context', () => {
  const codex: RequestPermissionRequest = {
    ...request,
    _meta: { is_mcp_tool_approval: true },
    toolCall: { toolCallId: 'call', kind: 'execute' }
  }
  const previous: ToolCallUpdate = {
    toolCallId: 'call',
    kind: 'execute',
    rawInput: {
      server: 'githuman_artifacts',
      tool: 'validations_get',
      arguments: { id: 'validation' }
    }
  }
  assert.equal(
    artifactPermissionCall(codex, previous)?.operation,
    'validations.get'
  )
  assert.deepEqual(artifactPermissionCall(codex, previous)?.input, {
    id: 'validation'
  })
  assert.equal(artifactPermissionCall(codex), undefined)
  assert.equal(
    artifactPermissionCall({ ...codex, _meta: {} }, previous),
    undefined
  )
  for (const context of [
    { ...previous, toolCallId: 'other' },
    { ...previous, name: 'Bash' },
    { ...previous, kind: 'edit' as const },
    {
      ...previous,
      rawInput: { server: 'other', tool: 'validations_get', arguments: {} }
    },
    {
      ...previous,
      rawInput: {
        server: 'githuman_artifacts',
        tool: 'validations_get',
        arguments: {},
        command: 'sh'
      }
    }
  ]) {
    assert.equal(artifactPermissionCall(codex, context), undefined)
  }
  assert.equal(
    artifactPermissionCall(
      {
        ...codex,
        toolCall: { ...codex.toolCall, rawInput: { id: 'changed' } }
      },
      previous
    ),
    undefined
  )
})

test('Cursor resolves only preset-bound, correlated structured MCP calls', () => {
  const cursor: RequestPermissionRequest = {
    sessionId: 'session',
    toolCall: { toolCallId: 'call', kind: 'other', title: 'Untrusted title' },
    options: request.options
  }
  const previous: ToolCallUpdate = {
    toolCallId: 'call',
    kind: 'other',
    rawInput: {
      providerIdentifier: 'githuman_artifacts',
      toolName: 'validations_manifest',
      args: { id: 'validation' }
    }
  }
  const resolve = (
    value?: RequestPermissionRequest,
    context?: ToolCallUpdate,
    preset = 'cursor'
  ) => artifactPermissionCall(value ?? cursor, context ?? previous, preset)
  assert.equal(resolve()?.operation, 'validations.manifest')
  assert.deepEqual(resolve()?.input, { id: 'validation' })
  assert.equal(artifactPermissionCall(cursor, undefined, 'cursor'), undefined)
  assert.equal(artifactPermissionCall(cursor, previous), undefined)
  assert.equal(resolve(cursor, previous, 'codex'), undefined)
  for (const context of [
    { ...previous, toolCallId: 'another-call' },
    { ...previous, kind: 'execute' as const },
    { ...previous, name: 'Bash' },
    { ...previous, rawInput: undefined },
    {
      ...previous,
      rawInput: {
        providerIdentifier: 'foreign',
        toolName: 'validations_manifest',
        args: {}
      }
    },
    {
      ...previous,
      rawInput: {
        providerIdentifier: 'githuman_artifacts',
        toolName: 'unknown',
        args: {}
      }
    },
    {
      ...previous,
      rawInput: {
        providerIdentifier: 'githuman_artifacts',
        toolName: 'validations_manifest',
        args: 'json'
      }
    },
    {
      ...previous,
      rawInput: {
        providerIdentifier: 'githuman_artifacts',
        toolName: 'validations_manifest',
        args: {},
        command: 'sh'
      }
    }
  ]) {
    assert.equal(resolve(cursor, context), undefined)
  }
  for (const value of [
    { ...cursor, _meta: { is_mcp_tool_approval: true } },
    { ...cursor, toolCall: { ...cursor.toolCall, kind: 'execute' as const } },
    {
      ...cursor,
      toolCall: { ...cursor.toolCall, rawInput: { id: 'changed' } }
    },
    { ...cursor, toolCall: { ...cursor.toolCall, name: 'Bash' } }
  ]) {
    assert.equal(resolve(value), undefined)
  }
})
