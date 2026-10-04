/** Side of the working copy diff that the Changes view shows. */
export type DiffSource = 'staged' | 'unstaged'

/** One path can be in both Staged and Unstaged, so the source is part of the key. */
export function cardStateKey(source: DiffSource, path: string): string {
  return `${source}:${path}`
}
