import { Type } from '@sinclair/typebox'
import { Nullable } from '../utils/schemas.ts'

export const RepositoryInfoSchema = Type.Object(
  {
    name: Type.String({ description: 'Name of the repository directory.' }),
    branch: Type.String({ description: 'Current branch.' }),
    remote: Nullable(
      Type.String({
        description: 'Fetch URL of the origin remote. Null if none.'
      })
    ),
    path: Type.String({ description: 'Absolute path of the repository.' })
  },
  { description: 'The repository that the server shows.' }
)

export const FileTreeResponseSchema = Type.Object(
  {
    ref: Type.String({ description: 'Ref from the request.' }),
    files: Type.Array(Type.String(), {
      description: 'Repository-relative paths of all files at the ref.'
    })
  },
  { description: 'Files of the repository at a ref.' }
)

export const FileContentResponseSchema = Type.Object(
  {
    path: Type.String({ description: 'Repository-relative path.' }),
    ref: Type.String({ description: 'Ref from the request.' }),
    content: Type.String({ description: 'Full file text.' }),
    lines: Type.Array(Type.String(), {
      description: 'Lines of the text. Empty for a binary file.'
    }),
    lineCount: Type.Integer({ description: 'Length of lines.' }),
    isBinary: Type.Boolean({ description: 'The file is binary.' })
  },
  { description: 'One file at a ref.' }
)

export const OkSchema = Type.Object(
  {
    ok: Type.Literal(true, { description: 'Always true.' })
  },
  { description: 'The git command succeeded.' }
)

export const TreeParams = Type.Object({
  ref: Type.String({
    minLength: 1,
    description:
      'Commit, branch or tag. INDEX lists the index, WORKTREE the files on disk.'
  })
})

export const FileParams = Type.Object({
  '*': Type.String({
    description: 'Repository-relative path. Slashes stay literal.'
  })
})

export const FileContentQuery = Type.Object({
  ref: Type.String({
    minLength: 1,
    description:
      'Commit, branch or tag. INDEX reads the index, WORKTREE the file on disk.'
  })
})

export const OptionalPathsBody = Type.Object(
  {
    paths: Type.Optional(
      Type.Array(Type.String(), {
        description: 'Repository-relative paths. Omitted or empty means all.'
      })
    )
  },
  { description: 'Paths for stage or unstage.' }
)

export const DiscardBody = Type.Object(
  {
    paths: Type.Array(Type.String(), {
      minItems: 1,
      description:
        'Repository-relative paths. Required: there is no "discard all".'
    })
  },
  { description: 'Paths to discard.' }
)
