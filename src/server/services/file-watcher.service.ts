import { watch, readdirSync, statSync, type FSWatcher } from 'node:fs'
import { join, basename } from 'node:path'

const IGNORED_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.venv',
  '.githuman',
  '.cache'
])

const DEBOUNCE_MS = 300

export interface FileWatcherHandle {
  close: () => void
}

/**
 * Watches a repository's working tree for changes, so the app can tell
 * clients to refresh their diff/file-tree view.
 *
 * Node's `fs.watch(dir, { recursive: true })` registers an OS-level watch on
 * every descendant directory unconditionally, which is prohibitively
 * expensive (and can exceed inotify watch limits) for a tree that includes
 * `node_modules`. This walks the tree itself instead, skipping known-heavy
 * or irrelevant directories, and watches `.git` non-recursively (so changes
 * to `.git/index`/`.git/HEAD` — staging, branch switches — are still picked
 * up without descending into `.git/objects`).
 */
export function watchRepository(
  repoPath: string,
  onChange: () => void
): FileWatcherHandle {
  const watchers: FSWatcher[] = []
  let debounceTimer: NodeJS.Timeout | undefined

  function scheduleChange() {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(onChange, DEBOUNCE_MS)
  }

  function watchNewEntry(path: string) {
    let stat
    try {
      stat = statSync(path)
    } catch {
      return // Already gone (e.g. a rapid create+delete) — nothing to watch.
    }

    if (stat.isDirectory() && !IGNORED_DIR_NAMES.has(basename(path))) {
      watchDir(path)
    }
  }

  function watchDir(dir: string) {
    let watcher: FSWatcher
    try {
      watcher = watch(dir, { persistent: false }, (eventType, filename) => {
        scheduleChange()
        if (eventType === 'rename' && filename) {
          watchNewEntry(join(dir, filename))
        }
      })
    } catch {
      return // Directory may have been removed between readdir and watch.
    }
    watchers.push(watcher)

    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (entry.isDirectory() && !IGNORED_DIR_NAMES.has(entry.name)) {
        watchDir(join(dir, entry.name))
      }
    }
  }

  watchDir(repoPath)

  try {
    watchers.push(
      watch(join(repoPath, '.git'), { persistent: false }, () =>
        scheduleChange()
      )
    )
  } catch {
    // Not a git repo, or .git is missing — nothing more to watch.
  }

  return {
    close: () => {
      clearTimeout(debounceTimer)
      for (const watcher of watchers) watcher.close()
    }
  }
}
