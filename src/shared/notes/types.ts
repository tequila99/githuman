import type { Static } from '@sinclair/typebox'
import type {
  NoteRecordSchema,
  NoteIssueSchema,
  NoteMutationSchema,
  NoteGraphSchema,
  NoteDescriptorSchema,
  NoteResolutionSchema,
  NoteAssetSchema,
  NoteSchema,
  NoteEntrySchema,
  NotesIndexSchema
} from './schemas.ts'
export type Note = Static<typeof NoteSchema>
export type NoteEntry = Static<typeof NoteEntrySchema>
export type NotesIndex = Static<typeof NotesIndexSchema>

export type NoteAsset = Static<typeof NoteAssetSchema>

export type NoteRecord = Static<typeof NoteRecordSchema>
export type NoteIssue = Static<typeof NoteIssueSchema>
export type NoteMutation = Static<typeof NoteMutationSchema>
export type NoteGraph = Static<typeof NoteGraphSchema>
export type NoteDescriptor = Static<typeof NoteDescriptorSchema>
export type NoteResolution = Static<typeof NoteResolutionSchema>
