import type { Static } from '@sinclair/typebox'
import type { AppInfoSchema } from './schemas.ts'

export type AppInfo = Static<typeof AppInfoSchema>
