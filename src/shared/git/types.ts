import type { Static } from '@sinclair/typebox'
import type {
  FileContentResponseSchema,
  FileTreeResponseSchema,
  RepositoryInfoSchema
} from './schemas.ts'

export type RepositoryInfo = Static<typeof RepositoryInfoSchema>

export interface FileTreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  isChanged: boolean
  /** `| undefined` (not just optional) because src/web's file-tree building
   *  code assigns `undefined` explicitly, which `exactOptionalPropertyTypes`
   *  (enabled for the web build only) treats as distinct from omitting it. */
  children?: FileTreeNode[] | undefined
}

export type FileTreeResponse = Static<typeof FileTreeResponseSchema>

/** Response shape of `GET /api/git/file/*` (see src/server/routes/git.ts). */
export type FileContentResponse = Static<typeof FileContentResponseSchema>
