import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { EventBus } from '../../event-bus.ts'
import { getFilesAtRef } from '../git.service.ts'

import { DEFAULT_FILE_SEARCH_LIMIT } from '../../../shared/agents/constants.ts'
import { rankPaths } from '../../../shared/agents/file-search.ts'
import { withDirectories } from '../../../shared/agents/mention-paths.ts'

export interface FileIndex {
  /**
   * Repository files (tracked and untracked-not-ignored) and their directories
   * that match `query`, best first. A directory path ends with `/` (#80).
   */
  search: (query: string, limit?: number) => Promise<string[]>
  close: () => void
}

/**
 * The repository's file and directory list for `@` mentions. Read once from `git ls-files`
 * and filtered in memory — the query never reaches a git argument — and
 * dropped whenever the working tree changes.
 */
export function createFileIndex(
  repositoryPath: string,
  eventBus: EventBus
): FileIndex {
  let cached: string[] | null = null
  let loading: Promise<string[]> | null = null
  // A change during a load makes that load's result stale on arrival.
  let generation = 0

  const unsubscribe = eventBus.subscribe(event => {
    if (event.type === 'files:changed') {
      generation++
      cached = null
    }
  })

  function files(): Promise<string[]> {
    if (cached) {
      return Promise.resolve(cached)
    }
    if (!loading) {
      const started = generation
      loading = getFilesAtRef(repositoryPath, 'WORKTREE')
        .then(withDirectories)
        .then(list => {
          if (started === generation) {
            cached = list
          }
          return list
        })
        .finally(() => {
          loading = null
        })
    }
    return loading
  }

  return {
    async search(query, limit = DEFAULT_FILE_SEARCH_LIMIT) {
      const ranked = rankPaths(await files(), query)
      const found: string[] = []
      for (const path of ranked) {
        // `ls-files --cached` still lists files deleted from the working tree,
        // so a directory can also be gone.
        if (existsSync(join(repositoryPath, path))) {
          found.push(path)
          if (found.length >= limit) {
            break
          }
        }
      }
      return found
    },
    close: unsubscribe
  }
}
