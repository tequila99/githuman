import type { Static } from '@sinclair/typebox'
import type {
  HandoffPreviewBody,
  SessionJournalQuery,
  SessionHandoffPreviewBody,
  HandoffSchema,
  JournalAppendBody,
  JournalContextSchema,
  JournalProvenanceSchema,
  JournalEntrySchema,
  JournalPageSchema,
  JournalQuery,
  JournalSearchQuery,
  JournalSearchEntrySchema,
  JournalSearchPageSchema
} from './schemas.ts'
import type { JOURNAL_EVENT_TYPES } from './constants.ts'

export type JournalEntry = Static<typeof JournalEntrySchema>
export type JournalAppend = Static<typeof JournalAppendBody>
export type JournalPage = Static<typeof JournalPageSchema>
export type JournalListQuery = Static<typeof JournalQuery>
export type JournalEventType = (typeof JOURNAL_EVENT_TYPES)[number]
export type Handoff = Static<typeof HandoffSchema>
export type HandoffPreview = Static<typeof HandoffPreviewBody>

export type JournalSearchInput = Static<typeof JournalSearchQuery>
export type JournalSearchEntry = Static<typeof JournalSearchEntrySchema>
export type JournalSearchPage = Static<typeof JournalSearchPageSchema>

export type JournalContext = Static<typeof JournalContextSchema>

export type JournalProvenance = Static<typeof JournalProvenanceSchema>

export type SessionJournalInput = Static<typeof SessionJournalQuery>
export type SessionHandoffPreview = Static<typeof SessionHandoffPreviewBody>
