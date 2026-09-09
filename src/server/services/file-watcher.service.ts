import { watch, readdirSync, statSync, type FSWatcher } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, basename, relative, sep } from 'node:path'

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

export interface WatchRepositoryOptions {
  /**
   * Also skip directories `.gitignore` (plus `.git/info/exclude` and the
   * user's global gitignore) marks as fully ignored, on top of
   * `IGNORED_DIR_NAMES` — covers repo-specific heavy/generated directories
   * (build output, virtualenvs, editor caches, ...) without hardcoding
   * every project's conventions here. Asks git directly rather than
   * re-implementing gitignore's pattern syntax (negation, anchoring,
   * nested `.gitignore` files) by hand. Silently has no effect if
   * `repoPath` isn't a git repository. Default `true`.
   */
  respectGitignore?: boolean
}

/**
 * Directories git considers fully ignored, one level at a time — i.e. a
 * directory appears here only if *everything* inside it is ignored (a
 * partially-ignored directory still needs walking, for its non-ignored
 * files), matching the granularity `IGNORED_DIR_NAMES` already works at.
 * `git ls-files --directory` collapses such a directory into one entry
 * instead of recursing into it, so this is cheap even for a huge ignored
 * tree like `node_modules`.
 */
function listGitignoredDirs(repoPath: string): Set<string> {
  try {
    const stdout = execFileSync(
      'git',
      [
        'ls-files',
        '-z',
        '--others',
        '--ignored',
        '--exclude-standard',
        '--directory'
      ],
      { cwd: repoPath, encoding: 'utf-8' }
    )
    return new Set(
      stdout
        .split('\0')
        .filter(entry => entry.endsWith('/'))
        .map(entry => entry.slice(0, -1))
    )
  } catch {
    return new Set() // Not a git repo, or git isn't available — IGNORED_DIR_NAMES still applies.
  }
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
  onChange: () => void,
  options: WatchRepositoryOptions = {}
): FileWatcherHandle {
  const gitignoredDirs =
    (options.respectGitignore ?? true)
      ? listGitignoredDirs(repoPath)
      : new Set<string>()
  const watchers: FSWatcher[] = []
  let debounceTimer: NodeJS.Timeout | undefined

  function isIgnoredDir(path: string): boolean {
    if (IGNORED_DIR_NAMES.has(basename(path))) {
      return true
    }
    return gitignoredDirs.has(relative(repoPath, path).split(sep).join('/'))
  }

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

    if (stat.isDirectory() && !isIgnoredDir(path)) {
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
      const entryPath = join(dir, entry.name)
      if (entry.isDirectory() && !isIgnoredDir(entryPath)) {
        watchDir(entryPath)
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
