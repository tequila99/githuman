// Note paths use "/" on every platform and have no leading or trailing slash.

/** Last path segment: the file or folder name. */
export function noteBasename(path: string): string {
  return path.split('/').at(-1) ?? ''
}

/** Folder that contains the entry; empty string for the notes root. */
export function noteParentPath(path: string): string {
  return path.split('/').slice(0, -1).join('/')
}

/** Joins a folder and an entry name; an empty folder means the notes root. */
export function noteChildPath(parent: string, name: string): string {
  return parent ? parent + '/' + name : name
}

/** Name of a note without its Markdown extension. */
export function noteTitle(path: string): string {
  return noteBasename(path).replace(/\.md$/i, '')
}
