import createError from '@fastify/error'

export const AsyncTransactionError = createError(
  'GHT_DB_ASYNC_TRANSACTION',
  'Database transaction callbacks must be synchronous.',
  500
)
