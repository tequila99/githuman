import createError from '@fastify/error'
export const NoteConflictError = createError(
  'GHT_NOTE_CONFLICT',
  'The note changed on disk. Keep your draft and compare it with the disk version.',
  409
)
export const NoteExistsError = createError(
  'GHT_NOTE_EXISTS',
  'This path already exists.',
  409
)
