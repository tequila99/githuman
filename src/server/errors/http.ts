import createError from '@fastify/error'

export const BadRequestError = createError<
  [message?: string, options?: ErrorOptions]
>('GHT_HTTP_BAD_REQUEST', '%s', 400)
export type BadRequestError = InstanceType<typeof BadRequestError>

export const NotFoundError = createError<
  [message?: string, options?: ErrorOptions]
>('GHT_HTTP_NOT_FOUND', '%s', 404)
export type NotFoundError = InstanceType<typeof NotFoundError>

export const ForbiddenError = createError<
  [message?: string, options?: ErrorOptions]
>('GHT_HTTP_FORBIDDEN', '%s', 403)
export type ForbiddenError = InstanceType<typeof ForbiddenError>
