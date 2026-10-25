import { Type } from '@sinclair/typebox'
import { MAX_PROJECT_PATH_LENGTH } from './constants.ts'

export const ProjectFileQuery = Type.Object({
  path: Type.String({
    minLength: 1,
    maxLength: MAX_PROJECT_PATH_LENGTH,
    description: 'Repository-relative WORKTREE file path.'
  })
})
export const ProjectFileContentQuery = Type.Object({
  ...ProjectFileQuery.properties,
  download: Type.Optional(
    Type.Boolean({
      description: 'Send an attachment without the preview size limit.'
    })
  )
})
export const ProjectFileMetadataSchema = Type.Object(
  {
    name: Type.String({ description: 'File basename.' }),
    size: Type.Number({ description: 'Current file size in bytes.' }),
    kind: Type.Union(
      [
        Type.Literal('markdown'),
        Type.Literal('text'),
        Type.Literal('image'),
        Type.Literal('pdf'),
        Type.Literal('download')
      ],
      { description: 'Supported preview, or download only.' }
    ),
    mime: Type.String({ description: 'Validated preview MIME type.' }),
    previewable: Type.Boolean({
      description: 'The file fits the preview budget.'
    })
  },
  { description: 'Current WORKTREE file metadata.' }
)
export const ProjectFileContextSchema = Type.Object(
  {
    origins: Type.Array(Type.String(), {
      description: 'Trusted loopback origins of this server instance.'
    })
  },
  { description: 'File-link context for this server.' }
)
