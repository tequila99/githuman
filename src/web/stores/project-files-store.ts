import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import { apiGet } from '@/api/client'
import { useRepositoryStore } from '@/stores/repository-store'
import { usePreviewStore } from '@/stores/windows/preview-store'
import type { ProjectFileContext, ProjectFileMetadata } from '@/api/types'
import {
  projectFileContentUrl,
  type ProjectFileLink
} from '@/utils/windows/project-file-link'
import { singleFlight } from '@/utils/single-flight'
import { isMarkdownPath } from '@/utils/markdown-path'
import { WORKTREE_REF } from '@/constants/git'
import { PROJECT_DOWNLOAD_LIMIT } from '@/constants/project-files'
import { downloadFile } from '@/utils/download'

export const useProjectFilesStore = defineStore('project-files', () => {
  const origins = shallowRef<string[]>([])
  const ready = shallowRef(false)
  const repository = useRepositoryStore()
  const preview = usePreviewStore()
  const prepare = singleFlight(async () => {
    if (!repository.info) await repository.fetchInfo()
    if (!ready.value) {
      const context = await apiGet<ProjectFileContext>(
        '/api/project-files/context'
      )
      origins.value = context.origins
      ready.value = true
    }
  })
  async function open(
    link: ProjectFileLink,
    ref = WORKTREE_REF,
    signal?: AbortSignal
  ) {
    signal?.throwIfAborted()
    if (ref !== WORKTREE_REF) {
      if (!isMarkdownPath(link.path)) {
        throw new Error(`Binary and text previews require ${WORKTREE_REF}`)
      }
      preview.open(
        'markdown',
        { type: 'file', path: link.path, ref },
        { title: link.path, anchor: link.anchor }
      )
      return true
    }
    const metadata = await apiGet<ProjectFileMetadata>(
      '/api/project-files/metadata?' + new URLSearchParams({ path: link.path }),
      signal
    )
    signal?.throwIfAborted()
    if (!metadata.previewable || metadata.kind === 'download') {
      if (metadata.size > PROJECT_DOWNLOAD_LIMIT) {
        throw new Error(
          `File is larger than ${PROJECT_DOWNLOAD_LIMIT / 1_000_000} MB`
        )
      }
      await downloadFile(
        projectFileContentUrl(link.path, true),
        metadata.name,
        signal
      )
      return false
    }
    preview.open(
      metadata.kind,
      { type: 'file', path: link.path, ref },
      {
        title: link.path,
        anchor: link.anchor,
        line: link.line,
        column: link.column
      }
    )
    return true
  }
  return { origins, ready, prepare, open }
})
