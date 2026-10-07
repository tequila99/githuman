import createError from '@fastify/error'
export const TerminalError = createError<[message?: string]>(
  'GHT_TERMINAL',
  '%s',
  409
)
export const TerminalNotFoundError = createError<[message?: string]>(
  'GHT_TERMINAL_NOT_FOUND',
  '%s',
  404
)
export const TerminalLimitError = createError<[message?: string]>(
  'GHT_TERMINAL_LIMIT',
  '%s',
  409
)
