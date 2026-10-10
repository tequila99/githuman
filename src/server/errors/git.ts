import createError from '@fastify/error'

export const GitFileNotFoundError = createError<
  [message?: string, options?: ErrorOptions]
>('GHT_GIT_FILE_NOT_FOUND', '%s', 404)
export type GitFileNotFoundError = InstanceType<typeof GitFileNotFoundError>
