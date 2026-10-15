import createError from '@fastify/error'

export const NoteAssetLimitError = createError<[message: string]>(
  'GHT_NOTE_ASSET_LIMIT',
  '%s',
  413
)
export const NoteAssetQueueError = createError(
  'GHT_NOTE_ASSET_QUEUE',
  'Attachment download queue is full',
  429
)
