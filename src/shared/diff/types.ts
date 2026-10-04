import type { Static } from '@sinclair/typebox'
import type {
  DiffFileSchema,
  DiffFileStatusSchema,
  DiffFileSummarySchema,
  DiffHunkSchema,
  DiffLineSchema,
  DiffLineTypeSchema,
  DiffSourceNameSchema
} from './schemas.ts'

export type DiffLineType = Static<typeof DiffLineTypeSchema>

export type DiffLine = Static<typeof DiffLineSchema>

export type DiffHunk = Static<typeof DiffHunkSchema>

export type DiffFileStatus = Static<typeof DiffFileStatusSchema>

export type DiffFile = Static<typeof DiffFileSchema>

/** Diff source behind `/api/diff/:source/files` and `/api/diff/:source/file`. */
export type DiffSourceName = Static<typeof DiffSourceNameSchema>

/** A diff file without hunks (ADR 0033). */
export type DiffFileSummary = Static<typeof DiffFileSummarySchema>
