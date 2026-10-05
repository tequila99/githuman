import { Type } from '@sinclair/typebox'
import { Nullable } from '../utils/schemas.ts'

export const DiffSourceNameSchema = Type.Union(
  [Type.Literal('staged'), Type.Literal('unstaged')],
  { description: 'Side of the working tree: the index or the files on disk.' }
)

export const DiffLineTypeSchema = Type.Union(
  [Type.Literal('added'), Type.Literal('removed'), Type.Literal('context')],
  { description: 'Line kind: added, removed or unchanged context.' }
)

export const DiffFileStatusSchema = Type.Union(
  [
    Type.Literal('added'),
    Type.Literal('modified'),
    Type.Literal('deleted'),
    Type.Literal('renamed')
  ],
  { description: 'What the change does to the file.' }
)

export const DiffLineSchema = Type.Object(
  {
    type: DiffLineTypeSchema,
    content: Type.String({
      description: 'Line text without the "+", "-" or " " prefix.'
    }),
    oldLineNumber: Nullable(
      Type.Integer({
        description: 'Line number in the old file. Null for an added line.'
      })
    ),
    newLineNumber: Nullable(
      Type.Integer({
        description: 'Line number in the new file. Null for a removed line.'
      })
    )
  },
  { description: 'One line of a hunk.' }
)

export const DiffHunkSchema = Type.Object(
  {
    oldStart: Type.Integer({ description: 'First line in the old file.' }),
    oldLines: Type.Integer({ description: 'Line count in the old file.' }),
    newStart: Type.Integer({ description: 'First line in the new file.' }),
    newLines: Type.Integer({ description: 'Line count in the new file.' }),
    lines: Type.Array(DiffLineSchema, {
      description: 'Lines of the hunk in file order.'
    }),
    preamble: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'Unchanged lines before the hunk, for syntax highlighting only. Up to 60 lines, and in a Vue file the opening tag of the enclosing block first. Absent when there are none.'
      })
    )
  },
  { description: 'One hunk of a file diff.' }
)

const diffFileFields = {
  oldPath: Type.String({
    description: 'Path before the change. Equals newPath unless renamed.'
  }),
  newPath: Type.String({
    description: 'Path after the change. Equals oldPath for a deleted file.'
  }),
  status: DiffFileStatusSchema,
  additions: Type.Integer({ description: 'Added line count.' }),
  deletions: Type.Integer({ description: 'Removed line count.' }),
  isBinary: Type.Boolean({ description: 'Git sees the file as binary.' })
}

export const DiffFileSchema = Type.Object(
  {
    ...diffFileFields,
    hunks: Type.Array(DiffHunkSchema, {
      description: 'Hunks of the file. Empty for a binary file.'
    })
  },
  { description: 'Diff of one file with its hunks.' }
)

export const DiffFileSummarySchema = Type.Object(
  {
    ...diffFileFields,
    signature: Type.String({
      description:
        'Changes when the file content or its diff changes. Equal signatures mean equal hunks.'
    })
  },
  { description: 'Diff of one file without hunks.' }
)

export const SourceParams = Type.Object({ source: DiffSourceNameSchema })

export const FileQuery = Type.Object({
  path: Type.String({
    minLength: 1,
    description: 'Repository-relative path after the change.'
  }),
  oldPath: Type.Optional(
    Type.String({
      minLength: 1,
      description: 'Repository-relative path before a rename.'
    })
  ),
  status: DiffFileStatusSchema
})

export const BranchQuery = Type.Object({
  base: Type.String({
    minLength: 1,
    description: 'Ref that the diff compares HEAD with.'
  })
})

export const CommitsQuery = Type.Object({
  from: Type.String({ minLength: 1, description: 'Older ref.' }),
  to: Type.String({ minLength: 1, description: 'Newer ref.' })
})
