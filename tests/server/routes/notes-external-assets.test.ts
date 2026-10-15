import { test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { ajvFilePlugin } from '@fastify/multipart'
import { IncomingMessage } from 'node:http'
import { Socket } from 'node:net'
import {
  mkdtemp,
  rm,
  readdir,
  readFile,
  symlink,
  mkdir
} from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { notesRoutes } from '../../../src/server/routes/notes.ts'
import { NotesService } from '../../../src/server/services/notes.service.ts'
import { NotesExternalAssetsService } from '../../../src/server/services/notes-external-assets.service.ts'
import { createEventBus } from '../../../src/server/event-bus.ts'

function resourceResponse(body: Buffer) {
  const response = new IncomingMessage(new Socket())
  response.statusCode = 200
  response.headers['content-length'] = String(body.length)
  response.push(body)
  response.push(null)
  return response
}

test('external attachment routes store detected PDF, expose complete results and keep image upload policy', async t => {
  const project = await mkdtemp(join(tmpdir(), 'external-routes-'))
  t.after(() => rm(project, { recursive: true, force: true }))
  const service = new NotesService(
    project,
    join(project, 'notes'),
    false,
    createEventBus()
  )
  const pdf = Buffer.from('%PDF-1.7\n%%EOF\n')
  const app = Fastify({
    ajv: {
      plugins: [
        ajv => {
          ajvFilePlugin(ajv)
          return ajv
        }
      ]
    }
  })
  t.after(() => app.close())
  app.register(notesRoutes, {
    service,
    externalAssets: new NotesExternalAssetsService(async () =>
      resourceResponse(pdf)
    )
  })
  const result = await app.inject({
    method: 'POST',
    url: '/api/notes/assets/import',
    payload: {
      url: 'https://example.com/a.pdf',
      kind: 'pdf',
      allowLargePdf: false,
      remainingBytes: 200000000
    }
  })
  assert.equal(result.statusCode, 200, result.body)
  const asset = result.json()
  assert.deepEqual(asset, {
    status: 'stored',
    url: asset.url,
    bytes: pdf.length,
    format: 'pdf'
  })
  assert.match(asset.url, /^\/api\/notes\/assets\/[a-f0-9]{64}\.pdf$/)
  const served = await app.inject(asset.url)
  assert.equal(served.statusCode, 200)
  assert.equal(served.headers['content-type'], 'application/pdf')
  assert.equal(served.headers['x-content-type-options'], 'nosniff')
  assert.deepEqual(served.rawPayload, pdf)
  const inspect = await app.inject({
    method: 'POST',
    url: '/api/notes/assets/inspect',
    payload: { url: 'https://example.com/a.pdf', kind: 'pdf' }
  })
  assert.deepEqual(inspect.json(), { size: pdf.length })
  const preview = await app.inject({
    method: 'POST',
    url: '/api/notes/assets/preview',
    payload: { url: 'https://example.com/a.pdf' }
  })
  assert.equal(preview.statusCode, 400)
  await assert.rejects(service.uploadAsset(pdf), /Only image uploads/)
  for (const remainingBytes of [0, 200000001]) {
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/notes/assets/import',
      payload: {
        url: 'https://example.com/a.pdf',
        kind: 'pdf',
        allowLargePdf: true,
        remainingBytes
      }
    })
    assert.equal(invalid.statusCode, 400)
  }
  const forbidden = await app.inject({
    method: 'POST',
    url: '/api/notes/assets/import',
    headers: { origin: 'https://evil.example' },
    payload: {
      url: 'https://example.com/a.pdf',
      kind: 'pdf',
      allowLargePdf: false,
      remainingBytes: 200000000
    }
  })
  assert.equal(forbidden.statusCode, 403)
  assert.equal((await readdir(join(project, 'notes/assets'))).length, 1)
})

test('preview returns bounded image bytes without publishing an asset', async t => {
  const project = await mkdtemp(join(tmpdir(), 'external-preview-'))
  t.after(() => rm(project, { recursive: true, force: true }))
  const png = await readFile(
    new URL('../fixtures/note-assets/sample.png', import.meta.url)
  )
  const app = Fastify({
    ajv: {
      plugins: [
        ajv => {
          ajvFilePlugin(ajv)
          return ajv
        }
      ]
    }
  })
  t.after(() => app.close())
  app.register(notesRoutes, {
    service: new NotesService(
      project,
      join(project, 'notes'),
      false,
      createEventBus()
    ),
    externalAssets: new NotesExternalAssetsService(async () =>
      resourceResponse(png)
    )
  })
  const result = await app.inject({
    method: 'POST',
    url: '/api/notes/assets/preview',
    payload: { url: 'https://example.com/a.png' }
  })
  assert.equal(result.statusCode, 200, result.body)
  assert.equal(result.headers['content-type'], 'image/png')
  assert.equal(result.headers['cache-control'], 'no-store')
  assert.deepEqual(result.rawPayload, png)
  await assert.rejects(readdir(join(project, 'notes/assets')), /ENOENT/)
})

test('stream staging deduplicates assets and rejects symlink destinations', async t => {
  const project = await mkdtemp(join(tmpdir(), 'external-symlink-'))
  t.after(() => rm(project, { recursive: true, force: true }))
  const root = join(project, 'notes')
  const service = new NotesService(project, root, false, createEventBus())
  const pdf = Buffer.from('%PDF-1.7\n%%EOF\n')
  const chunks = async function* () {
    yield pdf
  }
  const first = await service.importAsset(
    chunks(),
    'pdf',
    new AbortController().signal
  )
  assert.equal(
    await service.importAsset(chunks(), 'pdf', new AbortController().signal),
    first
  )
  const otherRoot = join(project, 'unsafe')
  await mkdir(otherRoot)
  await symlink(root, join(otherRoot, 'assets'))
  const unsafe = new NotesService(project, otherRoot, false, createEventBus())
  await assert.rejects(
    unsafe.importAsset(chunks(), 'pdf', new AbortController().signal),
    /Symbolic links/
  )
})
