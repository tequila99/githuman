export interface RepositoryInfo {
  name: string
  branch: string
  remote: string | null
  path: string
}

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

export interface FileTreeResponse {
  ref: string
  files: string[]
}

/** Response shape of `GET /api/git/file/*` (see src/server/routes/git.ts). */
export interface FileContentResponse {
  path: string
  ref: string
  content: string
  lines: string[]
  lineCount: number
  isBinary: boolean
}
