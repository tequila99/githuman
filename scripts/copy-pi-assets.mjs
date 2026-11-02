import { copyFileSync, mkdirSync } from 'node:fs'

// TypeScript does not copy the license and provenance of the vendored conversion layer.
const destination = new URL(
  '../dist/server/adapters/pi-acp/vendor/',
  import.meta.url
)
mkdirSync(destination, { recursive: true })
for (const name of ['LICENSE', 'README.md']) {
  copyFileSync(
    new URL(`../src/server/adapters/pi-acp/vendor/${name}`, import.meta.url),
    new URL(name, destination)
  )
}
