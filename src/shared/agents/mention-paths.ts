/**
 * A mentioned path that ends with `/` names a directory, as in agent CLIs.
 * The context item keeps the path without that `/` (#80).
 */
export function isDirectoryPath(path: string): boolean {
  return path.endsWith('/')
}

/** The path without trailing `/`: the form that a `directory` context item holds. */
export function withoutTrailingSlash(path: string): string {
  return path.replace(/\/+$/, '')
}

/**
 * The files and every directory that holds one of them, a directory as `a/b/`.
 * `git ls-files --others` already gives an untracked nested repository as
 * `dir/`, so a path with a trailing `/` is a directory too.
 */
export function withDirectories(paths: readonly string[]): string[] {
  const directories = new Set<string>()
  for (const path of paths) {
    const parts = withoutTrailingSlash(path).split('/')
    const last = isDirectoryPath(path) ? parts.length : parts.length - 1
    for (let end = 1; end <= last; end++) {
      directories.add(`${parts.slice(0, end).join('/')}/`)
    }
  }
  directories.delete('/')
  return [...paths.filter(path => !isDirectoryPath(path)), ...directories]
}

/** Name, parent path and kind of a mentioned path, for chips and the popup. */
export function mentionParts(path: string): {
  /** The last name, with `/` for a directory. */
  name: string
  /** The path above the name, without a trailing `/`. Empty at the top level. */
  parent: string
  directory: boolean
} {
  const directory = isDirectoryPath(path)
  const bare = withoutTrailingSlash(path)
  const at = bare.lastIndexOf('/')
  const name = at === -1 ? bare : bare.slice(at + 1)
  return {
    name: directory ? `${name}/` : name,
    parent: at === -1 ? '' : bare.slice(0, at),
    directory
  }
}
