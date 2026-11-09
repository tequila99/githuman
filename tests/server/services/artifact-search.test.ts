import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createTestDatabase } from '../../../src/server/db/index.ts'
import { ArtifactStorageService } from '../../../src/server/services/artifact-storage.service.ts'
import { probeArtifactSearch } from '../../../src/server/db/artifact-search-migrations.ts'
import {
  searchCopy,
  originalSearchRange,
  boundedSearchDistance
} from '../../../src/shared/artifacts/search.ts'
import type { Artifact } from '../../../src/shared/artifacts/types.ts'

// Use a stable user actor so only search inputs affect result ordering.
const USER = { kind: 'user' as const, id: 'local' }
function setup(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'ght-search-')),
    db = createTestDatabase()
  const storage = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'ght-'
  })
  t.after(() => {
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
  function create(
    title: string,
    body: string,
    status: Artifact['status'] = 'accepted',
    tags: string[] = [],
    taskIds: string[] = [],
    typeId = 'generic'
  ) {
    const artifact = storage.create(
      {
        requestId: randomUUID(),
        body,
        metadata: { title, tags, taskIds, typeId }
      },
      USER
    )
    if (status !== 'draft') {
      storage.catalog.transaction(() =>
        storage.catalog.appendMetadata(
          { ...artifact, status, metadataVersion: 2 },
          randomUUID(),
          USER,
          'metadata_updated'
        )
      )
    }
    return storage.get(artifact.id)
  }
  return { root, db, storage, create, search: storage.search }
}

test('FTS5 capability probe supports unicode61/trigram and unavailable search preserves normal reading', t => {
  const { db, storage, create, search } = setup(t)
  assert.equal(probeArtifactSearch(db), true)
  const artifact = create('Title', 'Body')
  db.exec('UPDATE artifact_search_capabilities SET available=0')
  assert.throws(() => search.search({ query: 'Body' }), /unavailable/)
  assert.equal(storage.readContent(artifact.id).text.endsWith('Body'), true)
  assert.equal(search.diagnostics().available, false)
})

test('normalization maps NFC contractions and lowercase expansion to original graphemes', () => {
  const input = 'A e\u0301 İ Ёж 🧪',
    normalized = searchCopy(input)
  for (const [term, original] of [
    ['é', 'e\u0301'],
    ['i\u0307', 'İ'],
    ['еж', 'Ёж'],
    ['🧪', '🧪']
  ]) {
    const start = normalized.text.indexOf(term)
    const [from, to] = originalSearchRange(
      start,
      start + term.length,
      normalized.offsets
    )
    assert.equal(input.slice(from, to), original)
  }
  assert.equal(searchCopy('ΟΣ').text, 'ος')
  const adjacent = searchCopy('Ae\u0301')
  assert.deepEqual(originalSearchRange(0, 1, adjacent.offsets), [0, 1])
  assert.equal(boundedSearchDistance('xxxxxxCA', 'xxxxxxABC', 2), 2)
  assert.equal(boundedSearchDistance('abcd', 'acbd', 1), 1)
  assert.equal(boundedSearchDistance('artifact', 'artfact', 2), 1)
})

test('exact search handles Cyrillic, Latin, NFC, ё/е, short substrings and literal LIKE characters', t => {
  const { create, search } = setup(t)
  const artifact = create(
    'Ёж и CAFÉ',
    'Первый текст\r\nПроектирование e\u0301 — 100% _value_ 🧪\n'
  )
  for (const query of ['еж', 'café', 'проектир', 'é', 'кт', '%', '_', '🧪']) {
    const result = search.search({ query, mode: 'exact' })
    assert.deepEqual(
      result.items.map(item => item.id),
      [artifact.id],
      query
    )
    assert.equal(result.partial, false)
    assert.equal(result.items[0].snippet.includes('<mark>'), false)
  }
  const result = search.search({ query: 'é', mode: 'exact' }).items[0]
  assert.equal(result.matchKind, 'exact_normalized')
  const body = search.search({ query: 'проектир', mode: 'exact' }).items[0]
  assert.ok(body.anchor?.quote.includes('Проектирование e\u0301'))
  assert.equal(body.anchor?.startLine, 2)
})

test('auto/fuzzy correct Russian and English typos while retaining exact matches first', t => {
  const { create, search } = setup(t)
  const exact = create('artifcat', 'точное слово')
  const corrected = create('artifact', 'проектирование')
  const results = search.search({ query: 'artifcat' }).items
  assert.equal(results[0].id, exact.id)
  assert.equal(
    results.find(item => item.id === corrected.id)?.matchKind,
    'fuzzy'
  )
  assert.ok(
    search
      .search({ query: 'проеткирвоание' })
      .items.some(item => item.id === corrected.id)
  )
  assert.equal(
    search
      .search({ query: 'artifcat', mode: 'exact' })
      .items.some(item => item.id === corrected.id),
    false
  )
  assert.equal(search.search({ query: 'art' }).items[0].matchKind, 'exact')
})

test('operators, quotes and SQL fragments remain literal data and never change history', t => {
  const { db, create, search } = setup(t)
  create('Quotes', 'AND OR NOT "quoted" x; DROP TABLE artifacts; --')
  const count = db.prepare('SELECT COUNT(*) count FROM artifact_events').get()
  for (const query of [
    '"',
    'AND OR NOT',
    'x; DROP TABLE artifacts; --',
    '" OR "x',
    '%%%%',
    'a:b',
    '\\'
  ]) {
    assert.doesNotThrow(() => search.search({ query }))
  }
  assert.deepEqual(
    db.prepare('SELECT COUNT(*) count FROM artifact_events').get(),
    count
  )
})

test('metadata filters precede pagination; deleted/draft require explicit statuses', t => {
  const { storage, create, search } = setup(t)
  const task = storage.tasks.create(
    randomUUID(),
    { title: 'Search task', externalUrl: null, state: 'open' },
    USER
  )
  storage.types.create(
    randomUUID(),
    'decision',
    { label: 'Decision', active: true },
    USER
  )
  for (let i = 0; i < 8; i++) {
    create(`Noise ${i}`, 'needle', 'accepted', ['noise'])
  }
  const selected = create(
    'Selected',
    'needle',
    'accepted',
    ['wanted', 'extra'],
    [task.id],
    'decision'
  )
  const deleted = create('Deleted', 'needle', 'deleted', ['wanted'])
  const draft = create('Draft', 'needle', 'draft')
  const result = search.search({
    query: 'needle',
    limit: 1,
    filters: { tags: ['wanted'], taskIds: [task.id], typeIds: ['decision'] }
  })
  assert.deepEqual(
    result.items.map(item => item.id),
    [selected.id]
  )
  assert.equal(
    search
      .search({ query: 'needle' })
      .items.some(item => item.id === deleted.id || item.id === draft.id),
    false
  )
  assert.deepEqual(
    search
      .search({ query: 'needle', filters: { statuses: ['deleted'] } })
      .items.map(item => item.id),
    [deleted.id]
  )
})

test('any-tag mode and creation range combine with text search by AND', t => {
  const { create, search } = setup(t)
  const a = create('Alpha', 'needle', 'accepted', ['one'])
  const b = create('Beta', 'needle', 'accepted', ['two'])
  create('Gamma', 'needle', 'accepted', ['three'])
  create('Other', 'haystack', 'accepted', ['one'])
  const ids = (filters: object, query = 'needle') =>
    search
      .search({ query, filters })
      .items.map(item => item.id)
      .sort()
  assert.deepEqual(ids({ tags: ['one', 'two'] }), [])
  assert.deepEqual(
    ids({ tags: ['one', 'two'], tagMode: 'any' }),
    [a.id, b.id].sort()
  )
  const past = '2000-01-01T00:00:00.000Z',
    future = '2999-01-01T00:00:00.000Z'
  assert.equal(ids({ createdFrom: past }).length, 3)
  assert.equal(ids({ createdFrom: future }).length, 0)
  assert.equal(ids({ createdTo: past }).length, 0)
  assert.equal(ids({ createdFrom: past, createdTo: future }).length, 3)
  assert.deepEqual(
    ids({ tags: ['one'], createdTo: future }, 'haystack').length,
    1
  )
  assert.throws(() => search.search({ filters: { createdFrom: 'nope' } }))
})
test('an explicit All status filter includes every status in catalog and text search without changing the default', t => {
  const { create, search } = setup(t)
  const statuses: Artifact['status'][] = [
    'draft',
    'in_review',
    'accepted',
    'rejected',
    'superseded',
    'archived',
    'deleted'
  ]
  const documents = statuses.map(status =>
    create(status, 'commonneedle', status)
  )
  for (const query of ['', 'commonneedle']) {
    const all = search.search({ query, filters: { statuses } })
    assert.deepEqual(
      new Set(all.items.map(item => item.id)),
      new Set(documents.map(item => item.id))
    )
    assert.deepEqual(
      new Set(all.items.map(item => item.status)),
      new Set(statuses)
    )
    assert.deepEqual(
      search.search({ query }).items.map(item => item.status),
      ['accepted']
    )
  }
})

test('epoch/query-bound pagination is stable and rebuild retains IDs/ranking without changing authoritative history', t => {
  const { storage, db, create, search } = setup(t)
  for (let i = 0; i < 5; i++) create(`artifact ${i}`, 'searchable content')
  const initial = search.search({ query: 'artifact', mode: 'exact' })
  const page1 = search.search({ query: 'artifact', mode: 'exact', limit: 2 })
  const page2 = search.search({
    query: 'artifact',
    mode: 'exact',
    limit: 2,
    cursor: page1.nextCursor!
  })
  assert.deepEqual(
    [...page1.items, ...page2.items].map(item => item.id),
    initial.items.slice(0, 4).map(item => item.id)
  )
  assert.throws(
    () => search.search({ query: 'other', cursor: page1.nextCursor! }),
    /cursor/
  )
  const before = db.prepare('SELECT COUNT(*) count FROM artifact_events').get(),
    epoch = storage.catalog.epoch()
  search.rebuild()
  assert.deepEqual(
    search.search({ query: 'artifact', mode: 'exact' }).items,
    initial.items
  )
  assert.deepEqual(
    db.prepare('SELECT COUNT(*) count FROM artifact_events').get(),
    before
  )
  assert.equal(storage.catalog.epoch(), epoch)
  assert.throws(
    () =>
      search.search({
        query: 'artifact',
        mode: 'exact',
        cursor: page1.nextCursor!
      }),
    /changed/
  )
})

test('metadata title changes update current search; corrupt files are suppressed rather than reindexed', t => {
  const { storage, create, search } = setup(t)
  const artifact = create('Old title', 'original content')
  storage.updateMetadata(
    artifact.id,
    {
      requestId: randomUUID(),
      expectedVersion: artifact.metadataVersion,
      metadata: { title: 'New title', tags: [] }
    },
    USER
  )
  assert.equal(
    search.search({ query: 'Old title', mode: 'exact' }).items.length,
    0
  )
  assert.equal(
    search.search({ query: 'New title', mode: 'exact' }).items.length,
    1
  )
  appendFileSync(join(storage.files.root, `ght-${artifact.id}.md`), 'tampered')
  assert.equal(search.search({ query: 'original' }).items.length, 0)
  assert.equal(search.diagnostics().suppressed.length, 1)
  search.rebuild()
  assert.equal(search.search({ query: 'tampered' }).items.length, 0)
})

test('fuzzy candidate budget is explicit, preserves exact results and freezes variants across pages', t => {
  const { create, search } = setup(t)
  create('aaaa', 'exact result')
  create(
    'Dictionary',
    Array.from(
      { length: 3000 },
      (_, i) => 'a' + i.toString(36).padStart(3, '0')
    ).join(' ')
  )
  const first = search.search({ query: 'aaaa', limit: 1 })
  assert.equal(first.partial, true)
  assert.ok(first.reason)
  assert.equal(first.items[0].title, 'aaaa')
  if (first.nextCursor) {
    const next = search.search({
      query: 'aaaa',
      limit: 1,
      cursor: first.nextCursor
    })
    assert.equal(next.partial, true)
    assert.notEqual(next.items[0]?.id, first.items[0].id)
  }
  assert.equal(search.search({ query: 'aaaa', mode: 'exact' }).partial, false)
  assert.throws(() => search.search({ query: 'word '.repeat(9) }), /8 tokens/)
  assert.doesNotThrow(() =>
    search.search({ query: '🧪'.repeat(256), mode: 'exact' })
  )
})

test('long source lines keep search pages bounded without returning a partial review anchor', t => {
  const { create, search } = setup(t)
  create('Large line', 'needle ' + '\t'.repeat(20000))
  const result = search.search({ query: 'needle', mode: 'exact' })
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].anchor, null)
  assert.ok(result.items[0].snippet.length <= 640)
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 65536)
})

test('review R2: generated cursors survive lowercase expansion and supplementary letters', t => {
  for (const character of ['İ', '𐐀']) {
    const { create, search } = setup(t),
      query = character.repeat(130)
    create('First', query)
    create('Second', query)
    const first = search.search({ query, limit: 1 })
    assert.ok(first.nextCursor)
    const second = search.search({ query, limit: 1, cursor: first.nextCursor })
    assert.equal(second.items.length, 1)
    assert.notEqual(second.items[0].id, first.items[0].id)
  }
})

test('review R1/C4: suppression commits before cursor conflict; clean restart has no duplicates or omissions', t => {
  const { create, search, storage } = setup(t)
  const counts = [
    [6, 3, 312],
    [5, 4, 253],
    [10, 1, 38],
    [7, 6, 163],
    [2, 5, 388],
    [9, 10, 393],
    [10, 7, 370],
    [7, 8, 175],
    [6, 3, 192],
    [3, 2, 53],
    [6, 3, 222],
    [7, 6, 91]
  ]
  const nodes = counts.map(([a, b, p], i) =>
    create(
      `D${i}`,
      'alpha '.repeat(a) + 'beta '.repeat(b) + 'filler '.repeat(p)
    )
  )
  const first = search.search({ query: 'alpha beta', mode: 'exact', limit: 2 })
  appendFileSync(join(storage.files.root, `ght-${nodes[5].id}.md`), 'tampered')
  let staleCursor = first.nextCursor
  assert.throws(
    () => {
      while (staleCursor) {
        const page = search.search({
          query: 'alpha beta',
          mode: 'exact',
          limit: 2,
          cursor: staleCursor
        })
        staleCursor = page.nextCursor
      }
    },
    error =>
      error instanceof Error &&
      'statusCode' in error &&
      error.statusCode === 409
  )
  assert.ok(search.diagnostics().suppressed.some(row => row.id === nodes[5].id))
  const expected = search
    .search({ query: 'alpha beta', mode: 'exact' })
    .items.map(item => item.id)
  const actual: string[] = []
  let cursor: string | undefined
  do {
    const page = search.search({
      query: 'alpha beta',
      mode: 'exact',
      limit: 2,
      ...(cursor ? { cursor } : {})
    })
    actual.push(...page.items.map(item => item.id))
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  assert.deepEqual(actual, expected)
  assert.equal(new Set(actual).size, nodes.length - 1)
})

test('review R1/C4: first-page suppression rebuilds the page and does not invent a next page', t => {
  const { create, search, storage } = setup(t)
  for (let i = 0; i < 3; i++) create(`Node ${i}`, 'needle')
  const victim = search.search({ query: 'needle', mode: 'exact', limit: 2 })
    .items[0]
  appendFileSync(join(storage.files.root, `ght-${victim.id}.md`), 'tampered')
  const first = search.search({ query: 'needle', mode: 'exact', limit: 2 })
  assert.equal(first.items.length, 2)
  assert.equal(first.nextCursor, null)
  assert.deepEqual(
    first.items,
    search.search({ query: 'needle', mode: 'exact', limit: 2 }).items
  )
})

test('review C3: exact substring scores never borrow BM25 from a lower-ranked token tier', t => {
  const { create, search } = setup(t)
  create('X', 'ab')
  create('Y', 'abc')
  const rows = search.repository.select(
    { mode: 'exact' },
    'ab',
    '("ab")',
    '',
    0,
    10
  )
  assert.equal(rows.length, 2)
  assert.ok(rows.every(row => row.tier === 0 && row.score === 0))
})

test('review N4: surrogate pairs at either snippet boundary do not exceed the snippet budget', t => {
  const { create, search } = setup(t)
  create(
    'Left boundary',
    'x'.repeat(79) + '🧪' + 'x'.repeat(79) + 'needle ' + 'x'.repeat(700)
  )
  create('Right boundary', 'needle ' + 'x'.repeat(632) + '🧪tail')
  for (const item of search.search({ query: 'needle', mode: 'exact' }).items) {
    assert.ok(item.snippet.length <= 640)
    assert.equal(item.snippet, Buffer.from(item.snippet).toString('utf8'))
    const range = item.highlights[0]
    assert.equal(item.snippet.slice(range.start, range.end), 'needle')
  }
})

test('review R2: a reachable maximum-token Unicode cursor fits the transport limit', t => {
  const { create, search } = setup(t)
  const tokens = Array.from({ length: 8 }, (_, index) =>
    '𐐀'.repeat(index === 7 ? 32 : 31)
  )
  const query = tokens.join(' ')
  assert.equal(Array.from(query).length, 256)
  const body = tokens
    .flatMap(token => [
      token,
      ...Array.from(
        { length: 7 },
        (_, index) => token + String.fromCharCode(97 + index)
      )
    ])
    .join(' ')
  create('First Unicode variants', body)
  create('Second Unicode variants', body)
  const first = search.search({ query, limit: 1 })
  assert.ok(first.nextCursor)
  assert.ok(first.nextCursor.length <= 32768)
  const next = search.search({ query, limit: 1, cursor: first.nextCursor })
  assert.equal(next.items.length, 1)
  assert.notEqual(next.items[0].id, first.items[0].id)
})

test('review N5: replacing title index contents increments the index epoch once', t => {
  const { create, search, storage } = setup(t)
  const node = create('Old', 'unchanged body'),
    epoch = search.repository.epoch()
  storage.updateMetadata(
    node.id,
    {
      requestId: randomUUID(),
      expectedVersion: node.metadataVersion,
      metadata: { title: 'New', tags: [] }
    },
    USER
  )
  assert.equal(search.repository.epoch(), epoch + 1)
})

test('review C1 safety: shared BM25 changes foreign-store ranking, so existing global epoch rejects stale cursors', t => {
  const { create, search, db } = setup(t)
  const root = mkdtempSync(join(tmpdir(), 'ght-foreign-search-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const other = new ArtifactStorageService({
    db,
    repositoryPath: root,
    prefix: 'ght-'
  })
  const counts = [
    [6, 3, 312],
    [5, 4, 253],
    [10, 1, 38],
    [7, 6, 163],
    [2, 5, 388],
    [9, 10, 393],
    [10, 7, 370],
    [7, 8, 175],
    [6, 3, 192],
    [3, 2, 53],
    [6, 3, 222],
    [7, 6, 91]
  ]
  counts.forEach(([a, b, p], index) =>
    create(
      `D${index}`,
      'alpha '.repeat(a) + 'beta '.repeat(b) + 'filler '.repeat(p)
    )
  )
  const first = search.search({
    query: 'alpha filler',
    mode: 'exact',
    limit: 2
  })
  const before = search
    .search({ query: 'alpha filler', mode: 'exact' })
    .items.map(item => item.id)
  other.create(
    {
      requestId: 'foreign-stats',
      body: 'alpha '.repeat(20000),
      metadata: { title: 'Foreign', tags: [] }
    },
    USER
  )
  const after = search
    .search({ query: 'alpha filler', mode: 'exact' })
    .items.map(item => item.id)
  assert.notDeepEqual(after, before)
  assert.throws(
    () =>
      search.search({
        query: 'alpha filler',
        mode: 'exact',
        limit: 2,
        cursor: first.nextCursor!
      }),
    /Restart pagination/
  )
})

test('unbound candidates exclude deleted and bound artifacts before pagination', t => {
  const { storage, create, search } = setup(t)
  const task = storage.tasks.create(
    randomUUID(),
    { title: 'Candidate task', externalUrl: null, state: 'open' },
    USER
  )
  const statuses = [
    'draft',
    'in_review',
    'accepted',
    'rejected',
    'superseded',
    'archived'
  ] as const
  const expected = statuses.map(
    status => create(status, 'candidate', status).id
  )
  create('Bound', 'candidate', 'draft', [], [task.id])
  create('Deleted', 'candidate', 'deleted')
  const found: string[] = []
  let cursor: string | undefined
  do {
    const page = search.search({
      filters: { statuses: [...statuses], unbound: true },
      limit: 2,
      cursor
    })
    found.push(...page.items.map(item => item.id))
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  assert.equal(found.length, expected.length)
  assert.deepEqual(found.sort(), expected.sort())
})
