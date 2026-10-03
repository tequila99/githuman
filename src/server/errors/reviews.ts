import createError from '@fastify/error'

export const ValidationError = createError<
  [message?: string, options?: ErrorOptions]
>('GHT_REVIEW_VALIDATION', '%s', 400)
export type ValidationError = InstanceType<typeof ValidationError>

export const UniqueNameError = createError<
  [message?: string, options?: ErrorOptions]
>('GHT_REVIEW_NAME_CONFLICT', '%s', 409)
export type UniqueNameError = InstanceType<typeof UniqueNameError>
