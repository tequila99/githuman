import { accessSync, constants } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'

export function isOnPath(
  binary: string,
  pathEnv: string | undefined = process.env.PATH
): boolean {
  if (isAbsolute(binary)) {
    try {
      accessSync(binary, constants.X_OK)
      return true
    } catch {
      return false
    }
  }
  for (const dir of (pathEnv ?? '').split(delimiter)) {
    if (dir === '') {
      continue
    }
    try {
      accessSync(join(dir, binary), constants.X_OK)
      return true
    } catch {
      // not in this directory
    }
  }
  return false
}
