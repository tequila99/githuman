import createError from '@fastify/error'

export const ExportNotFoundError = createError<
  [message?: string, options?: ErrorOptions]
>('GHT_EXPORT_NOT_FOUND', '%s', 404)
export type ExportNotFoundError = InstanceType<typeof ExportNotFoundError>
