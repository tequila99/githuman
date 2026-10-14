import { Type } from '@sinclair/typebox'
import { Nullable } from '../utils/schemas.ts'
import { NOTE_ASSET_ID_PATTERN } from './asset-formats.ts'

// Relative paths are resolved within the configured notes root.
const Path = Type.String({
  minLength: 1,
  maxLength: 1024,
  description: 'Path relative to the notes root.'
})
const Id = Type.String({
  format: 'uuid',
  description: 'Stable note or storage UUID.'
})
export const NotePresenceSchema = Type.Union(
  [Type.Literal('present'), Type.Literal('missing'), Type.Literal('deleted')],
  { description: 'Whether the file is available.' }
)
export const NoteRecordSchema = Type.Object(
  {
    id: Id,
    path: Path,
    presence: NotePresenceSchema,
    version: Type.String({ description: 'Last indexed content version.' }),
    createdAt: Type.String({
      description: 'Creation or first registration time.'
    }),
    updatedAt: Type.String({
      description: 'Last observed content change time.'
    })
  },
  { description: 'Persistent identity of a note, including absent files.' }
)
export const NoteIssueSchema = Type.Object(
  {
    id: Type.String({ description: 'Diagnostic identifier.' }),
    kind: Type.Union(
      [
        Type.Literal('identity'),
        Type.Literal('rewrite'),
        Type.Literal('metadata')
      ],
      { description: 'Diagnostic category.' }
    ),
    message: Type.String({ description: 'Actionable diagnostic.' }),
    noteId: Nullable(Id),
    candidateId: Nullable(Id)
  },
  { description: 'Identity or file update requiring attention.' }
)
export const NoteMutationSchema = Type.Object(
  {
    operationId: Id,
    complete: Type.Boolean({
      description: 'Whether all relative links were updated.'
    })
  },
  { description: 'Result of a recoverable file operation.' }
)
export const NoteIdQuery = Type.Object(
  { id: Id, storageId: Id },
  { description: 'A note within a specific storage.' }
)
export const NoteResolveBody = Type.Object(
  {
    sourceId: Id,
    storageId: Id,
    text: Type.String({
      maxLength: 1000000,
      description: 'Current source, including an unsaved draft.'
    }),
    href: Type.String({ description: 'Clicked internal address.' }),
    occurrence: Type.Optional(
      Type.Integer({
        minimum: 0,
        description: 'Ordinal among identical displayed addresses.'
      })
    )
  },
  { description: 'Resolve a note link without losing its identity.' }
)
export const ResolveIdentityBody = Type.Object(
  {
    issueId: Type.String({ description: 'Pending identity diagnostic ID.' }),
    candidateId: Type.Optional(Id),
    restore: Type.Boolean({
      description: 'Whether the candidate is the previous note.'
    })
  },
  { description: 'Confirm a restored or moved file, or keep it as a new note.' }
)
export const NoteGraphSchema = Type.Object(
  {
    storageId: Id,
    nodes: Type.Array(NoteRecordSchema, {
      description: 'Notes and absent targets.'
    }),
    edges: Type.Array(
      Type.Object(
        { sourceId: Id, targetId: Id },
        { description: 'A directed note relationship.' }
      ),
      { description: 'Resolved relationships, including absent targets.' }
    )
  },
  { description: 'Portable graph data without a visualization.' }
)
export const NoteResolutionSchema = Type.Object(
  { id: Id, anchor: Type.String({ description: 'Decoded heading fragment.' }) },
  { description: 'Resolved target identity.' }
)
export const NoteDescriptorSchema = Type.Object(
  {
    note: NoteRecordSchema,
    backlinks: Type.Array(NoteRecordSchema, {
      description: 'Present notes linking to this identity.'
    })
  },
  { description: 'A note identity and its backlinks.' }
)

export const NoteQuery = Type.Object(
  { path: Path },
  { description: 'Relative path within notes storage.' }
)
export const NoteSchema = Type.Object(
  {
    id: Type.Optional(Id),
    storageId: Type.Optional(Id),
    path: Path,
    text: Type.String({ description: 'Full Markdown including frontmatter.' }),
    version: Type.String({
      description: 'Opaque content version for conditional writes.'
    })
  },
  { description: 'A note and its disk version.' }
)
export const NoteEntrySchema = Type.Object(
  {
    path: Path,
    id: Type.Optional(Id),
    presence: Type.Optional(NotePresenceSchema),
    folder: Type.Boolean({ description: 'Whether this entry is a directory.' }),
    tags: Type.Array(Type.String(), {
      description: 'Tags from YAML frontmatter.'
    }),
    error: Nullable(
      Type.String({ description: 'Metadata or file read error, if present.' })
    )
  },
  { description: 'Entry in the notes tree.' }
)
export const NotesIndexSchema = Type.Object(
  {
    entries: Type.Array(NoteEntrySchema, { description: 'Notes and folders.' }),
    storageId: Type.Optional(Id),
    revision: Type.Optional(
      Type.String({
        description: 'Opaque catalog and filesystem revision for mutations.'
      })
    ),
    issues: Type.Optional(
      Type.Array(NoteIssueSchema, {
        description: 'Pending identity or rewrite diagnostics.'
      })
    ),
    storage: Type.String({ description: 'Configured notes directory.' }),
    warning: Nullable(
      Type.String({ description: 'Storage visibility warning, if present.' })
    )
  },
  { description: 'Project notes index.' }
)
export const CreateNoteBody = Type.Object(
  {
    path: Path,
    text: Type.String({
      maxLength: 1000000,
      description: 'Initial Markdown text.'
    })
  },
  { description: 'New note contents and relative path.' }
)
export const SaveNoteBody = Type.Object(
  {
    id: Type.Optional(Id),
    storageId: Type.Optional(Id),
    path: Path,
    text: Type.String({
      maxLength: 1000000,
      description: 'New Markdown text.'
    }),
    version: Type.String({ description: 'Expected current version.' })
  },
  { description: 'Note update guarded by its current version.' }
)
export const RenameNoteBody = Type.Object(
  {
    path: Path,
    id: Type.Optional(Id),
    revision: Type.Optional(
      Type.String({ description: 'Expected catalog revision.' })
    ),
    target: Type.Optional(Path),
    name: Type.String({
      minLength: 1,
      maxLength: 255,
      description: 'New entry name without parent directories.'
    }),
    folder: Type.Boolean({ description: 'Whether the entry is a directory.' })
  },
  { description: 'Rename a note or directory within its current parent.' }
)

export const CreateFolderBody = Type.Object(
  { path: Path },
  { description: 'New notes folder.' }
)

export const UploadNoteAssetBody = Type.Object(
  {
    file: Type.Any({
      isFile: true,
      description: 'Raster image file, at most 10 MB.'
    })
  },
  {
    additionalProperties: false,
    description: 'Multipart image attachment upload.'
  }
)
export const NoteAssetSchema = Type.Object(
  {
    url: Type.String({
      description: 'Origin-relative permanent attachment URL.'
    })
  },
  { description: 'Stored note attachment.' }
)
export const NoteAssetParams = Type.Object(
  {
    id: Type.String({
      pattern: NOTE_ASSET_ID_PATTERN,
      description: 'Content hash and image extension.'
    })
  },
  { description: 'Stored attachment identifier.' }
)

export const NoteAssetContentSchema = Type.String({
  description: 'Raster image bytes.',
  format: 'binary'
})
