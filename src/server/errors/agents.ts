import createError from '@fastify/error'

export const AgentSessionError = createError<
  [message?: string, options?: ErrorOptions]
>('GHT_AGENT_SESSION', '%s', 502)
export type AgentSessionError = InstanceType<typeof AgentSessionError>

export const AgentSessionStateError = createError<
  [message?: string, options?: ErrorOptions]
>(
  'GHT_AGENT_STATE',
  '%s',
  409,
  // Node's ErrorConstructor requires static fields; createError only reads Base.prototype.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- @fastify/error's Base type is stricter than its runtime contract
  AgentSessionError as unknown as ErrorConstructor
)
export type AgentSessionStateError = InstanceType<typeof AgentSessionStateError>

export const AgentConfigError = createError<
  [message?: string, options?: ErrorOptions]
>(
  'GHT_AGENT_CONFIG',
  '%s',
  400,
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same Base.prototype contract as AgentSessionStateError
  AgentSessionError as unknown as ErrorConstructor
)
export type AgentConfigError = InstanceType<typeof AgentConfigError>

export const AgentContextError = createError<
  [message?: string, options?: ErrorOptions]
>('GHT_AGENT_CONTEXT', '%s', 400)
export type AgentContextError = InstanceType<typeof AgentContextError>

export const UnknownAgentPresetError = createError<
  [message?: string, options?: ErrorOptions]
>('GHT_AGENT_PRESET_NOT_FOUND', '%s', 404)
export type UnknownAgentPresetError = InstanceType<
  typeof UnknownAgentPresetError
>

export const TooManyAgentSessionsError = createError<
  [message?: string, options?: ErrorOptions]
>('GHT_AGENT_SESSION_LIMIT', '%s', 409)
export type TooManyAgentSessionsError = InstanceType<
  typeof TooManyAgentSessionsError
>
