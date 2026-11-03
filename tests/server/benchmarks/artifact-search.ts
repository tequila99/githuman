import { measureSearchVocabularyCreate } from './artifact-search-vocabulary.ts'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir, cpus, platform, release, totalmem } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { createFileDatabase } from '../../../src/server/db/index.ts'
import { ArtifactStorageService } from '../../../src/server/services/artifact-storage.service.ts'

// Fixed corpus size and vocabulary make benchmark runs comparable.
const DOCUMENTS = 10_000
// Exercise the planned immutable-body volume without frontmatter padding.
const BODY_BYTES = 100 * 1024 * 1024
// Repeated measurements include common, selective and corrected queries.
const QUERIES = [
  'artifact',
  'проектирование',
  'needle7319',
  'caf\u00e9',
  'еж',
  'artifcat',
  'проеткирвоание'
]
const root = mkdtempSync(join(tmpdir(), 'ght-search-benchmark-'))
const path = join(root, '.githuman/ght-reviews.db'),
  db = createFileDatabase(path)
const storage = new ArtifactStorageService({
  db,
  repositoryPath: root,
  prefix: 'ght-'
})
const actor = { kind: 'user' as const, id: 'benchmark' }
let bytes = 0
const started = performance.now()
try {
  for (let i = 0; i < DOCUMENTS; i++) {
    const targetBytes =
      Math.floor(BODY_BYTES / DOCUMENTS) + Number(i < BODY_BYTES % DOCUMENTS)
    const prefix = `Document ${i} needle${i} artifact проектирование Ёж café e\u0301\n`
    const body =
      prefix +
      'deterministic searchable corpus text '
        .repeat(Math.ceil(targetBytes / 37))
        .slice(0, targetBytes - Buffer.byteLength(prefix))
    bytes += Buffer.byteLength(body)
    const node = storage.create(
      {
        requestId: `seed-${i}`,
        body,
        metadata: {
          title: `Artifact ${String(i).padStart(5, '0')}`,
          tags: [i % 2 ? 'odd' : 'even']
        }
      },
      actor
    )
    storage.catalog.transaction(() => {
      for (let version = 2; version <= 10; version++) {
        storage.catalog.appendMetadata(
          { ...node, metadataVersion: version, status: 'accepted' },
          `history-${i}-${version}`,
          actor,
          'metadata_updated'
        )
      }
    })
    if ((i + 1) % 1000 === 0) process.stderr.write(`seeded ${i + 1}\n`)
  }
  const seedMs = performance.now() - started
  const measurements: {
    query: string
    mode: 'exact' | 'auto'
    p95: number
    partial: boolean
    hits: number
  }[] = []
  for (const mode of ['exact', 'auto'] as const) {
    for (const query of QUERIES) {
      storage.search.search({ query, mode, limit: 20 })
      const timings: number[] = []
      let partial = false,
        hits = 0
      for (let run = 0; run < 25; run++) {
        const before = performance.now(),
          page = storage.search.search({ query, mode, limit: 20 })
        timings.push(performance.now() - before)
        partial ||= page.partial
        hits = page.items.length
      }
      timings.sort((a, b) => a - b)
      measurements.push({
        query,
        mode,
        p95: timings[Math.ceil(timings.length * 0.95) - 1],
        partial,
        hits
      })
    }
  }
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  const indexBytes = db
    .prepare(
      "SELECT SUM(pgsize) bytes FROM dbstat WHERE name LIKE 'artifact_search_%'"
    )
    .get()
  console.log(
    JSON.stringify(
      {
        seed: 'sequential-v1',
        node: process.version,
        sqlite: db.prepare('SELECT sqlite_version() version').get(),
        system: {
          platform: platform(),
          release: release(),
          cpu: cpus()[0]?.model,
          memory: totalmem()
        },
        documents: DOCUMENTS,
        bodyBytes: bytes,
        events: db.prepare('SELECT COUNT(*) count FROM artifact_events').get(),
        seedMs,
        dbBytes: statSync(path).size,
        indexBytes: indexBytes?.bytes ?? 0,
        measurements,
        vocabularyCreate: measureSearchVocabularyCreate()
      },
      null,
      2
    )
  )
} finally {
  db.close()
  rmSync(root, { recursive: true, force: true })
}
