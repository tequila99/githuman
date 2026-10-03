import createError from '@fastify/error'

export const ValidationError = createError<
  [message?: string, options?: ErrorOptions]
>('GHT_COMMENT_VALIDATION', '%s', 400)
export type ValidationError = InstanceType<typeof ValidationError>
