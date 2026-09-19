import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let cachedVersion: string | undefined

export function getAppVersion(): string {
  if (cachedVersion === undefined) {
    const pkgPath = fileURLToPath(
      new URL('../../package.json', import.meta.url)
    )
    const pkg: { version: string } = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    cachedVersion = pkg.version
  }
  return cachedVersion
}
