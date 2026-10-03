import { readFileSync } from 'node:fs'
import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { isOnPath } from '../utils/executable.ts'
import { isRecord } from '../../shared/utils/guards.ts'
import type { AgentPreset } from '../../shared/agents/types.ts'
import type { AgentPresetInfo } from '../../shared/agents/types.ts'

/**
 * Packages are pinned to the versions the ADR 0023 spike was run against —
 * `npx -y` otherwise executes whatever was published last. Cursor and Codex
 * are not verified yet (Codex's adapter moved to the agentclientprotocol org
 * after zed-industries/codex-acp was archived) and stay unpinned.
 */
export const DEFAULT_AGENT_PRESETS: readonly AgentPreset[] = [
  {
    id: 'claude',
    title: 'Claude Code',
    command: 'npx',
    args: ['-y', '@agentclientprotocol/claude-agent-acp@0.84.0'],
    autoApprovesEdits: false
  },
  {
    id: 'pi',
    title: 'pi',
    command: 'npx',
    args: ['-y', 'pi-acp@0.0.34'],
    requires: 'pi',
    autoApprovesEdits: true
  },
  {
    id: 'cursor',
    title: 'Cursor',
    command: 'agent',
    args: ['acp'],
    autoApprovesEdits: false
  },
  {
    id: 'codex',
    title: 'Codex',
    command: 'npx',
    args: ['-y', '@agentclientprotocol/codex-acp'],
    autoApprovesEdits: false
  }
]

/** The keys the schema allows; named in the "unknown field" message. */
const OVERRIDE_FIELDS = ['command', 'args', 'env']

/**
 * One entry of the user's overrides file. Closed on purpose: a misspelt key
 * (`arg` for `args`) must fail loudly, not be ignored.
 */
const AgentOverrideSchema = Type.Object(
  {
    command: Type.Optional(Type.String({ minLength: 1 })),
    args: Type.Optional(Type.Array(Type.String())),
    env: Type.Optional(Type.Record(Type.String(), Type.String()))
  },
  { additionalProperties: false }
)

export function describePreset(preset: AgentPreset): AgentPresetInfo {
  // The agent starts with `preset.env` on top of ours, so look in its PATH.
  const pathEnv = preset.env?.PATH ?? process.env.PATH
  return {
    id: preset.id,
    title: preset.title,
    available:
      isOnPath(preset.command, pathEnv) &&
      (preset.requires === undefined || isOnPath(preset.requires, pathEnv)),
    autoApprovesEdits: preset.autoApprovesEdits
  }
}

/** A JSON Pointer segment (`~1` is `/`, `~0` is `~`) as the plain field name. */
function fieldOf(pointer: string): string {
  const [segment = ''] = pointer.split('/').filter(part => part !== '')
  return segment.replaceAll('~1', '/').replaceAll('~0', '~')
}

/** Names the first schema violation of one override entry; `pointer` is relative to that entry. */
function overrideProblem(where: string, pointer: string): string {
  const field = fieldOf(pointer)
  if (field === 'command') return `${where} needs a "command" string`
  if (field === 'args') return `${where}: "args" must be an array of strings`
  if (field === 'env') return `${where}: "env" must map names to strings`
  // Any other field name in the path is a key the schema does not allow.
  return `${where} has an unknown field "${field}" (allowed: ${OVERRIDE_FIELDS.join(', ')})`
}

function readOverrides(overridesPath: string): Record<string, unknown> {
  let raw: string
  try {
    raw = readFileSync(overridesPath, 'utf-8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return {}
    }
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`Invalid JSON in ${overridesPath}`, { cause: error })
  }
  if (!isRecord(parsed)) {
    throw new Error(
      `${overridesPath} must contain a JSON object keyed by agent id`
    )
  }
  return parsed
}

/**
 * Applies the user's overrides file (`.githuman/<prefix>agents.json`) over
 * the built-in presets: `{ "<id>": { "command": "...", "args": [...], "env": {...} } }`.
 * A preset id not among the defaults defines a new agent. This file is the
 * only place a launch command can come from besides the defaults — the HTTP
 * API only ever selects a preset by id (ADR 0023).
 */
export function loadAgentPresets(
  overridesPath: string,
  defaults: readonly AgentPreset[] = DEFAULT_AGENT_PRESETS
): AgentPreset[] {
  const merged = new Map(defaults.map(preset => [preset.id, { ...preset }]))
  for (const [id, override] of Object.entries(readOverrides(overridesPath))) {
    const where = `Agent "${id}" in ${overridesPath}`
    if (!isRecord(override)) {
      throw new Error(`${where} must be an object`)
    }
    if (!Value.Check(AgentOverrideSchema, override)) {
      const problem = Value.Errors(AgentOverrideSchema, override).First()
      throw new Error(overrideProblem(where, problem?.path ?? ''))
    }
    const base = merged.get(id)
    const command = override.command ?? base?.command
    if (command === undefined) {
      throw new Error(`${where} needs a "command" string`)
    }
    const args = override.args ?? base?.args ?? []
    const env = override.env ?? base?.env
    merged.set(id, {
      id,
      title: base?.title ?? id,
      command,
      args,
      ...(base?.requires === undefined ? {} : { requires: base.requires }),
      autoApprovesEdits: base?.autoApprovesEdits ?? false,
      ...(env === undefined ? {} : { env })
    })
  }
  return [...merged.values()]
}
