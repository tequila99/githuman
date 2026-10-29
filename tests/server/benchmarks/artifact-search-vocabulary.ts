import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir, cpus } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import { createTestDatabase } from '../../../src/server/db/index.ts'
import { ArtifactStorageService } from '../../../src/server/services/artifact-storage.service.ts'

export function measureSearchVocabularyCreate() {
  const measurements = []
  for (const words of [1000, 20000]) {
    const timingsMs = []
    for (let run = 0; run < 3; run++) {
      const root = mkdtempSync(join(tmpdir(), 'ght-index-cost-')),
        db = createTestDatabase()
      const storage = new ArtifactStorageService({
        db,
        repositoryPath: root,
        prefix: 'ght-'
      })
      try {
        const body = Array.from(
          { length: words },
          (_, i) => 'word' + i.toString(36).padStart(6, '0')
        ).join(' ')
        const started = performance.now()
        storage.create(
          {
            requestId: 'cost',
            body,
            metadata: { title: 'Vocabulary', tags: [] }
          },
          { kind: 'user', id: 'benchmark' }
        )
        timingsMs.push(performance.now() - started)
      } finally {
        db.close()
        rmSync(root, { recursive: true, force: true })
      }
    }
    measurements.push({
      words,
      timingsMs,
      medianMs: [...timingsMs].sort((a, b) => a - b)[1]
    })
  }
  return { node: process.version, cpu: cpus()[0]?.model, measurements }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  console.log(JSON.stringify(measureSearchVocabularyCreate(), null, 2))
}
