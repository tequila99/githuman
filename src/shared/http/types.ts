import type { Static } from '@sinclair/typebox'
import type { ApiErrorSchema } from './schemas.ts'

export type ApiError = Static<typeof ApiErrorSchema>
