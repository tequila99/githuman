import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IncomingMessage } from 'node:http'
import { Socket } from 'node:net'
import { NotesExternalAssetsService } from '../../../src/server/services/notes-external-assets.service.ts'
import {
  MAX_NOTE_IMPORT_BYTES,
  MAX_NOTE_PDF_BYTES,
  NOTE_PDF_WARNING_BYTES,
  MAX_NOTE_ASSET_BYTES
} from '../../../src/shared/notes/constants.ts'
import type { ImportExternalAsset } from '../../../src/shared/notes/types.ts'
import { readFile, mkdtemp, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NotesService } from '../../../src/server/services/notes.service.ts'
import { createEventBus } from '../../../src/server/event-bus.ts'

class Resource extends IncomingMessage {
  private offset = 0
  private readonly size: number
  private readonly prefix: Buffer
  constructor(size: number, prefix: Buffer, known: boolean) {
    super(new Socket())
    this.size = size
    this.prefix = prefix
    this.statusCode = 200
    if (known) this.headers['content-length'] = String(size)
  }
  override _read() {
    if (this.offset >= this.size) {
      this.push(null)
      return
    }
    const chunk = Buffer.alloc(Math.min(65536, this.size - this.offset))
    if (!this.offset) this.prefix.copy(chunk)
    this.offset += chunk.length
    this.push(chunk)
  }
}
const pdf = Buffer.from('%PDF-1.7\n')
const input: ImportExternalAsset = {
  url: 'https://example.com/book.pdf',
  kind: 'pdf',
  allowLargePdf: false,
  remainingBytes: MAX_NOTE_IMPORT_BYTES
}
const signal = () => new AbortController().signal
async function discard(body: AsyncIterable<Buffer>) {
  for await (const chunk of body) {
    assert.ok(chunk.length)
  }
  return '/api/notes/assets/test.pdf'
}

for (const known of [true, false]) {
  for (const [size, allow, expected] of [
    [NOTE_PDF_WARNING_BYTES, false, 'stored'],
    [NOTE_PDF_WARNING_BYTES + 1, false, 'confirmation-required'],
    [MAX_NOTE_PDF_BYTES, true, 'stored'],
    [MAX_NOTE_PDF_BYTES + 1, true, 'rejected']
  ] as const) {
    test(`PDF ${size} bytes known=${known} confirmed=${allow}: ${expected}`, async () => {
      const service = new NotesExternalAssetsService(
        async () => new Resource(size, pdf, known)
      )
      const result = await service.importAsset(
        { ...input, allowLargePdf: allow },
        signal(),
        discard
      )
      assert.equal(result.status, expected)
      if (result.status === 'stored') assert.equal(result.bytes, size)
      if (result.status === 'rejected') {
        assert.equal(result.reason, 'file-too-large')
      }
    })
  }
}

test('operation limit takes precedence and cannot be bypassed by confirmation', async () => {
  for (const remainingBytes of [30_000_000, NOTE_PDF_WARNING_BYTES]) {
    const service = new NotesExternalAssetsService(
      async () => new Resource(60_000_000, pdf, false)
    )
    assert.deepEqual(
      await service.importAsset(
        { ...input, remainingBytes },
        signal(),
        discard
      ),
      { status: 'rejected', reason: 'operation-limit' }
    )
  }
})

test('actual type is validated even if the URL and MIME claim PDF', async () => {
  const service = new NotesExternalAssetsService(
    async () => new Resource(100, Buffer.from('<html>Not a PDF</html>'), true)
  )
  await assert.rejects(
    service.importAsset(input, signal(), discard),
    /Supported|identify/
  )
})

test('image limits and preview limits cannot be raised using PDF confirmation', async () => {
  const png = await readFile(
    new URL('../fixtures/note-assets/sample.png', import.meta.url)
  )
  for (const known of [true, false]) {
    const service = new NotesExternalAssetsService(
      async () => new Resource(MAX_NOTE_ASSET_BYTES + 1, png, known)
    )
    assert.deepEqual(
      await service.importAsset(
        { ...input, kind: 'image', allowLargePdf: true },
        signal(),
        discard
      ),
      { status: 'rejected', reason: 'file-too-large' }
    )
    await assert.rejects(service.preview(input.url, signal()), /10 MB/)
  }
})

test('HEAD unsupported returns unknown size without a GET', async () => {
  const methods: string[] = []
  const service = new NotesExternalAssetsService(async (_url, method) => {
    methods.push(method)
    const response = new Resource(0, pdf, true)
    response.statusCode = 405
    return response
  })
  assert.deepEqual(await service.inspect(input.url, signal()), { size: null })
  assert.deepEqual(methods, ['HEAD'])
})

test('stream errors and rejected PDF thresholds remove staged files', async t => {
  const project = await mkdtemp(join(tmpdir(), 'external-asset-'))
  t.after(() => rm(project, { recursive: true, force: true }))
  const notes = new NotesService(
    project,
    join(project, 'notes'),
    false,
    createEventBus()
  )
  const downloader = new NotesExternalAssetsService(
    async () => new Resource(NOTE_PDF_WARNING_BYTES + 1, pdf, false)
  )
  const result = await downloader.importAsset(
    input,
    signal(),
    (body, ext, abort) => notes.importAsset(body, ext, abort)
  )
  assert.equal(result.status, 'confirmation-required')
  assert.deepEqual(await readdir(join(project, 'notes/assets')), [])
  const small = new NotesExternalAssetsService(
    async () => new Resource(100, pdf, true)
  )
  const stored = await small.importAsset(input, signal(), (body, ext, abort) =>
    notes.importAsset(body, ext, abort)
  )
  assert.equal(stored.status, 'stored')
  assert.equal((await readdir(join(project, 'notes/assets'))).length, 1)
})

test('known PDF above remaining budget is rejected before asking for confirmation', async () => {
  const service = new NotesExternalAssetsService(
    async () => new Resource(70_000_000, pdf, true)
  )
  assert.deepEqual(
    await service.importAsset(
      { ...input, remainingBytes: 60_000_000 },
      signal(),
      discard
    ),
    { status: 'rejected', reason: 'operation-limit' }
  )
})

test('the shared queue bounds concurrency and removes cancelled waiters', async () => {
  let active = 0
  const service = new NotesExternalAssetsService(
    async (_url, _method, abortSignal) => {
      active++
      return new Promise((_resolve, reject) =>
        abortSignal.addEventListener(
          'abort',
          () => {
            active--
            reject(abortSignal.reason)
          },
          { once: true }
        )
      )
    }
  )
  const controllers = Array.from({ length: 33 }, () => new AbortController())
  const pending = controllers.map(controller =>
    service.inspect(input.url, controller.signal).catch(() => null)
  )
  assert.equal(active, 3)
  await assert.rejects(service.inspect(input.url, signal()), /queue is full/)
  for (const controller of controllers) controller.abort()
  await Promise.all(pending)
  assert.equal(active, 0)
})

test('an import starts before earlier inspections and the order is stable otherwise', async () => {
  const started: string[] = []
  const gates: Array<() => void> = []
  const service = new NotesExternalAssetsService(
    async (url, _method, abortSignal) => {
      started.push(url)
      if (started.length <= 3) {
        await new Promise<void>(resolve => gates.push(resolve))
      }
      return Promise.reject(abortSignal.reason ?? new Error('stop'))
    }
  )
  const run = (url: string, kind: 'inspect' | 'import') =>
    (kind === 'inspect'
      ? service.inspect(url, signal())
      : service.importAsset({ ...input, url }, signal(), async () => '')
    ).catch(() => null)
  const all = [
    run('https://e.com/busy-1', 'inspect'),
    run('https://e.com/busy-2', 'inspect'),
    run('https://e.com/busy-3', 'inspect'),
    run('https://e.com/low-1', 'inspect'),
    run('https://e.com/low-2', 'inspect'),
    run('https://e.com/import', 'import')
  ]
  gates.forEach(open => open())
  await Promise.all(all)
  assert.deepEqual(started.slice(3), [
    'https://e.com/import',
    'https://e.com/low-1',
    'https://e.com/low-2'
  ])
})

test('unread Undici bodies do not crash the process during inspection and early rejection', async () => {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const serviceUrl = new URL(
    '../../../src/server/services/notes-external-assets.service.ts',
    import.meta.url
  ).href
  const { stdout } = await promisify(execFile)(process.execPath, [
    '--input-type=module',
    '-e',
    `
      import assert from 'node:assert/strict'
      import { createRequire } from 'node:module'
      import { setImmediate } from 'node:timers/promises'
      import { NotesExternalAssetsService } from ${JSON.stringify(serviceUrl)}
      const require = createRequire(${JSON.stringify(serviceUrl)})
      // Use Undici's real body: IncomingMessage does not emit this cleanup error.
      const { Readable: BodyReadable } = require('undici/lib/api/readable.js')
      let aborted = 0
      let consumed = 0
      let statusCode = 200
      let size = 123
      const service = new NotesExternalAssetsService(async () => Object.assign(
        new BodyReadable({ resume() { consumed++ }, abort() { aborted++ } }),
        { statusCode, headers: { 'content-length': String(size) } }
      ))
      const signal = () => new AbortController().signal
      const input = {
        url: 'https://example.com/a.png', kind: 'image',
        allowLargePdf: false, remainingBytes: 100000000
      }
      const save = async () => { throw new Error('must not save') }
      for (let i = 0; i < 5; i++) {
        assert.deepEqual(await service.inspect(input.url, signal()), { size: 123 })
        await setImmediate()
      }
      statusCode = 404
      await assert.rejects(service.preview(input.url, signal()), /HTTP 404/)
      await assert.rejects(service.importAsset(input, signal(), save), /HTTP 404/)
      statusCode = 200
      size = 100000001
      assert.equal((await service.importAsset(input, signal(), save)).status, 'rejected')
      await assert.rejects(service.preview(input.url, signal()), /10 MB/)
      size = 50000001
      assert.equal((await service.importAsset({ ...input, kind: 'pdf', remainingBytes: 200000000 }, signal(), save)).status, 'confirmation-required')
      await setImmediate()
      assert.equal(aborted, 10)
      assert.equal(consumed, 0)
      const failed = new NotesExternalAssetsService(async () => Object.assign(
        new BodyReadable({
          resume() { this.destroy(new Error('download failed')) },
          abort() {}
        }),
        { statusCode: 200, headers: {} }
      ))
      await assert.rejects(failed.preview(input.url, signal()), /download failed/)
      await setImmediate()
      console.log('cleanup survived')
    `
  ])
  assert.match(stdout, /cleanup survived/)
})
