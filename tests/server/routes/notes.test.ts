import { splitNote } from '../../../src/shared/notes/document.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { buildApp } from '../../../src/server/app.ts'
import type { Note, NotesIndex } from '../../../src/shared/notes/types.ts'
import { MAX_NOTE_ASSET_BYTES } from '../../../src/shared/notes/constants.ts'

async function multipartImage(bytes: Uint8Array, field = 'file') {
  const body = new FormData()
  body.append(
    field,
    new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
    'image.png'
  )
  const request = new Request('http://localhost/api/notes/assets', {
    method: 'POST',
    body
  })
  return {
    headers: Object.fromEntries(request.headers),
    payload: Buffer.from(await request.arrayBuffer())
  }
}

test('asset responses use detected formats even when the upload name and MIME claim PNG', async t => {
  const project = await mkdtemp(join(tmpdir(), 'notes-asset-formats-'))
  t.after(() => rm(project, { recursive: true, force: true }))
  const app = buildApp({ projectPath: project })
  t.after(() => app.close())
  for (const [extension, mime] of [
    ['png', 'image/png'],
    ['jpg', 'image/jpeg'],
    ['gif', 'image/gif'],
    ['webp', 'image/webp']
  ]) {
    const bytes = await readFile(
      new URL(`../fixtures/note-assets/sample.${extension}`, import.meta.url)
    )
    const uploaded = await app.inject({
      method: 'POST',
      url: '/api/notes/assets',
      ...(await multipartImage(bytes))
    })
    assert.equal(uploaded.statusCode, 201, uploaded.body)
    const url = uploaded.json<{ url: string }>().url
    assert.equal(url.split('.').at(-1), extension)
    const response = await app.inject(url)
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(response.headers['content-type'], mime)
    assert.equal(response.headers['x-content-type-options'], 'nosniff')
    assert.deepEqual(response.rawPayload, bytes)
  }
})

test('asset uploads reject missing files, extra parts and oversized files without storing them', async t => {
  const project = await mkdtemp(join(tmpdir(), 'notes-upload-limits-'))
  t.after(() => rm(project, { recursive: true, force: true }))
  const app = buildApp({ projectPath: project })
  t.after(() => app.close())
  const bytes = await readFile(
    new URL('../fixtures/note-assets/sample.png', import.meta.url)
  )
  const extraFile = new FormData()
  extraFile.append('file', new Blob([bytes]), 'one.png')
  extraFile.append('other', new Blob([bytes]), 'two.png')
  const extraField = new FormData()
  extraField.append('file', new Blob([bytes]), 'one.png')
  extraField.append('caption', 'extra')
  for (const body of [extraFile, extraField]) {
    const request = new Request('http://localhost/api/notes/assets', {
      method: 'POST',
      body
    })
    const response = await app.inject({
      method: 'POST',
      url: '/api/notes/assets',
      headers: Object.fromEntries(request.headers),
      payload: Buffer.from(await request.arrayBuffer())
    })
    assert.equal(response.statusCode, 413, response.body)
  }
  const oversized = Buffer.alloc(MAX_NOTE_ASSET_BYTES + 1)
  bytes.copy(oversized)
  const oversizedResponse = await app.inject({
    method: 'POST',
    url: '/api/notes/assets',
    ...(await multipartImage(oversized))
  })
  assert.equal(oversizedResponse.statusCode, 413, oversizedResponse.body)
  for (const input of [
    { payload: { data: bytes.toString('base64') } },
    await multipartImage(bytes, 'wrong')
  ]) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/notes/assets',
      ...input
    })
    assert.equal(response.statusCode, 400, response.body)
  }
  const empty = await app.inject({
    method: 'POST',
    url: '/api/notes/assets',
    headers: { 'content-type': 'multipart/form-data; boundary=empty' },
    payload: '--empty--\r\n'
  })
  assert.equal(empty.statusCode, 400, empty.body)
  await assert.rejects(readdir(join(project, '.githuman/notes/assets')), {
    code: 'ENOENT'
  })
  const maximum = oversized.subarray(0, MAX_NOTE_ASSET_BYTES)
  const accepted = await app.inject({
    method: 'POST',
    url: '/api/notes/assets',
    ...(await multipartImage(maximum))
  })
  assert.equal(accepted.statusCode, 201, accepted.body)
  assert.deepEqual(
    (await app.inject(accepted.json<{ url: string }>().url)).rawPayload,
    maximum
  )
})

test('notes API preserves content, checks versions and exposes complete index fields', async t => {
  const project = await mkdtemp(join(tmpdir(), 'notes-test-'))
  t.after(() => rm(project, { recursive: true, force: true }))
  const app = buildApp({ projectPath: project, repositoryPath: project })
  t.after(() => app.close())
  const initialIndex = (await app.inject('/api/notes')).json<NotesIndex>()
  assert.ok(initialIndex.storageId)
  assert.deepEqual(initialIndex, {
    storageId: initialIndex.storageId,
    revision: initialIndex.revision,
    issues: [],
    entries: [],
    storage: join(project, '.githuman/notes'),
    warning: null
  })
  await assert.rejects(readdir(join(project, '.githuman/notes')))
  const text = '---\ntags: [ideas]\ncustom: keep\n---\n# План\n'
  const created = await app.inject({
    method: 'POST',
    url: '/api/notes/document',
    payload: { path: 'plans/next.md', text }
  })
  assert.equal(created.statusCode, 201, created.body)
  const note = created.json<Note>()
  assert.equal(splitNote(note.text).body, splitNote(text).body)
  assert.ok(note.id)
  assert.equal(note.storageId, initialIndex.storageId)
  assert.equal(note.path, 'plans/next.md')
  assert.match(note.version, /^[a-f0-9]{64}$/)
  assert.deepEqual(
    (await app.inject('/api/notes/document?path=plans%2Fnext.md')).json(),
    note
  )
  const index = (await app.inject('/api/notes')).json<NotesIndex>()
  assert.deepEqual(index.entries, [
    { path: 'plans', folder: true, tags: [], error: null },
    {
      id: note.id,
      presence: 'present',
      path: 'plans/next.md',
      folder: false,
      tags: ['ideas'],
      error: null
    }
  ])
  const duplicate = await app.inject({
    method: 'POST',
    url: '/api/notes/document',
    payload: { path: note.path, text: 'overwrite' }
  })
  assert.equal(duplicate.statusCode, 409)
  const updated = await app.inject({
    method: 'PATCH',
    url: '/api/notes/document',
    payload: { ...note, text: text + 'Edit' }
  })
  assert.equal(updated.statusCode, 200, updated.body)
  assert.notEqual(updated.json<Note>().version, note.version)
  const conflict = await app.inject({
    method: 'PATCH',
    url: '/api/notes/document',
    payload: { ...note, text: 'Old edit' }
  })
  assert.equal(conflict.statusCode, 409)
  const backups = await readdir(join(project, '.githuman/notes/.history'))
  assert.equal(
    await readFile(
      join(project, '.githuman/notes/.history', backups[0]),
      'utf8'
    ),
    note.text
  )
  const external = 'Externally changed'
  await writeFile(join(project, '.githuman/notes', note.path), external)
  const stale = await app.inject({
    method: 'PATCH',
    url: '/api/notes/document',
    payload: { ...updated.json<Note>(), text: 'stale' }
  })
  assert.equal(stale.statusCode, 409)
  assert.equal(
    await readFile(join(project, '.githuman/notes', note.path), 'utf8'),
    external
  )
})
test('rejects escapes, symlinks, cross-origin writes and invalid metadata', async t => {
  const project = await mkdtemp(join(tmpdir(), 'notes-safe-'))
  t.after(() => rm(project, { recursive: true, force: true }))
  const root = join(project, 'notes')
  await mkdir(root)
  await symlink(project, join(root, 'escape'))
  const app = buildApp({ projectPath: project, notesDir: 'notes' })
  t.after(() => app.close())
  for (const path of [
    '../bad.md',
    '/bad.md',
    'escape/bad.md',
    'x/../../bad.md',
    '.history/a.md',
    'a.txt'
  ]) {
    const result = await app.inject({
      method: 'POST',
      url: '/api/notes/document',
      payload: { path, text: '' }
    })
    assert.equal(result.statusCode, 400, path + result.body)
  }
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/notes/document',
        payload: { path: 'bad.md', text: '---\ntags: 2\n---\n' }
      })
    ).statusCode,
    400
  )
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/notes/document',
        headers: { origin: 'https://hostile.example' },
        payload: { path: 'bad.md', text: '' }
      })
    ).statusCode,
    403
  )
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/notes/folder',
        payload: { path: 'empty/nested' }
      })
    ).statusCode,
    204
  )
})
test('default notes belong to launch directory and use local Git exclusion', async t => {
  const repo = await mkdtemp(join(tmpdir(), 'notes-git-'))
  t.after(() => rm(repo, { recursive: true, force: true }))
  execFileSync('git', ['init', '-q', repo])
  const project = join(repo, 'nested')
  await mkdir(project)
  const app = buildApp({ repositoryPath: repo, projectPath: project })
  t.after(() => app.close())
  const response = await app.inject({
    method: 'POST',
    url: '/api/notes/document',
    payload: { path: 'hello.md', text: 'Hi' }
  })
  assert.equal(response.statusCode, 201, response.body)
  assert.equal(
    splitNote(await readFile(join(project, '.githuman/notes/hello.md'), 'utf8'))
      .body,
    'Hi'
  )
  const ignored = execFileSync(
    'git',
    ['check-ignore', 'nested/.githuman/notes/hello.md'],
    { cwd: repo, encoding: 'utf8' }
  )
  assert.match(ignored, /hello.md/)
  await assert.rejects(readFile(join(repo, '.gitignore')))
})

test('concurrent edits accept one version and failed backup leaves the note intact', async t => {
  const project = await mkdtemp(join(tmpdir(), 'notes-race-'))
  t.after(() => rm(project, { recursive: true, force: true }))
  const root = join(project, 'notes')
  const app = buildApp({ projectPath: project, notesDir: 'notes' })
  t.after(() => app.close())
  const created = await app.inject({
    method: 'POST',
    url: '/api/notes/document',
    payload: { path: 'note.md', text: 'start' }
  })
  const original = created.json<Note>()
  const responses = await Promise.all(
    ['one', 'two'].map(text =>
      app.inject({
        method: 'PATCH',
        url: '/api/notes/document',
        payload: { ...original, text }
      })
    )
  )
  assert.deepEqual(
    responses.map(response => response.statusCode).sort((a, b) => a - b),
    [200, 409]
  )
  const current = (
    await app.inject('/api/notes/document?path=note.md')
  ).json<Note>()
  await rm(join(root, '.history'), { recursive: true })
  await writeFile(join(root, '.history'), 'unavailable backup')
  const failed = await app.inject({
    method: 'PATCH',
    url: '/api/notes/document',
    payload: { ...current, text: 'must not replace' }
  })
  assert.equal(failed.statusCode, 500)
  assert.equal(await readFile(join(root, 'note.md'), 'utf8'), current.text)
  assert.deepEqual(
    (await readdir(root)).filter(path => path.startsWith('.note-')),
    []
  )
})

test('already tracked personal notes show a warning without changing the Git index', async t => {
  const repo = await mkdtemp(join(tmpdir(), 'notes-tracked-'))
  t.after(() => rm(repo, { recursive: true, force: true }))
  execFileSync('git', ['init', '-q', repo])
  await mkdir(join(repo, '.githuman/notes'), { recursive: true })
  await writeFile(join(repo, '.githuman/notes/a.md'), 'tracked')
  execFileSync('git', ['add', '.githuman/notes/a.md'], { cwd: repo })
  const before = execFileSync('git', ['ls-files', '--stage'], {
    cwd: repo,
    encoding: 'utf8'
  })
  const app = buildApp({ projectPath: repo, repositoryPath: repo })
  t.after(() => app.close())
  const index = (await app.inject('/api/notes')).json<NotesIndex>()
  assert.match(index.warning ?? '', /already tracked/)
  assert.equal(
    execFileSync('git', ['ls-files', '--stage'], {
      cwd: repo,
      encoding: 'utf8'
    }),
    before
  )
})

test('image attachments survive restart and origin changes, rejecting unsafe files and paths', async t => {
  const project = await mkdtemp(join(tmpdir(), 'notes-assets-'))
  t.after(() => rm(project, { recursive: true, force: true }))
  const bytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOc0AAAAASUVORK5CYII=',
    'base64'
  )
  const app = buildApp({ projectPath: project })
  const uploaded = await app.inject({
    method: 'POST',
    url: '/api/notes/assets',
    ...(await multipartImage(bytes))
  })
  assert.equal(uploaded.statusCode, 201, uploaded.body)
  const asset = uploaded.json<{ url: string }>()
  assert.deepEqual(Object.keys(asset), ['url'])
  assert.match(asset.url, /^\/api\/notes\/assets\/[a-f0-9]{64}\.png$/)
  const repeated = await app.inject({
    method: 'POST',
    url: '/api/notes/assets',
    ...(await multipartImage(bytes))
  })
  assert.equal(repeated.statusCode, 201, repeated.body)
  assert.deepEqual(repeated.json(), asset)
  assert.equal(
    (await readdir(join(project, '.githuman/notes/assets'))).length,
    1
  )
  const text = `![image](${asset.url})`
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/notes/document',
        payload: { path: 'image.md', text }
      })
    ).statusCode,
    201
  )
  await app.close()
  const restarted = buildApp({ projectPath: project })
  t.after(() => restarted.close())
  for (const host of ['localhost:1234', '127.0.0.1:4567']) {
    const response = await restarted.inject({
      url: asset.url,
      headers: { host, origin: 'http://' + host }
    })
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(response.headers['content-type'], 'image/png')
    assert.deepEqual(response.rawPayload, bytes)
    assert.equal(
      splitNote(
        (
          await restarted.inject('/api/notes/document?path=image.md')
        ).json<Note>().text
      ).body,
      text
    )
  }
  for (const invalidBytes of [
    Buffer.alloc(0),
    Buffer.from('invalid'),
    Buffer.from('<svg></svg>')
  ]) {
    assert.equal(
      (
        await restarted.inject({
          method: 'POST',
          url: '/api/notes/assets',
          ...(await multipartImage(invalidBytes))
        })
      ).statusCode,
      400
    )
  }
  assert.equal(
    (await restarted.inject('/api/notes/assets/' + '0'.repeat(64) + '.png'))
      .statusCode,
    404
  )
  await rm(join(project, '.githuman/notes/assets'), { recursive: true })
  await symlink(project, join(project, '.githuman/notes/assets'))
  assert.equal(
    (
      await restarted.inject({
        method: 'POST',
        url: '/api/notes/assets',
        ...(await multipartImage(bytes))
      })
    ).statusCode,
    400
  )
})

test('rename API updates the index and returns conflicts without overwriting', async t => {
  const project = await mkdtemp(join(tmpdir(), 'notes-rename-api-'))
  t.after(() => rm(project, { recursive: true, force: true }))
  const app = buildApp({ projectPath: project })
  t.after(() => app.close())
  for (const path of ['folder/a.md', 'folder/b.md']) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/notes/document',
      payload: { path, text: path }
    })
    assert.equal(response.statusCode, 201)
  }
  const occupied = await app.inject({
    method: 'POST',
    url: '/api/notes/rename',
    payload: { path: 'folder/a.md', name: 'b.md', folder: false }
  })
  assert.equal(occupied.statusCode, 409)
  const renamed = await app.inject({
    method: 'POST',
    url: '/api/notes/rename',
    payload: { path: 'folder', name: 'new', folder: true }
  })
  assert.equal(renamed.statusCode, 200)
  assert.equal(renamed.json<{ complete: boolean }>().complete, true)
  const index = (await app.inject('/api/notes')).json<NotesIndex>()
  assert.deepEqual(
    index.entries.map(entry => entry.path),
    ['new', 'new/a.md', 'new/b.md']
  )
})

test('identity, graph, resolution and mutation responses retain every contract field', async t => {
  const project = await mkdtemp(join(tmpdir(), 'notes-identity-http-'))
  t.after(() => rm(project, { recursive: true, force: true }))
  await mkdir(join(project, 'notes'))
  await writeFile(join(project, 'notes/A.md'), '[B](B.md#heading)')
  await writeFile(join(project, 'notes/B.md'), '# Heading')
  const app = buildApp({ projectPath: project, notesDir: 'notes' })
  t.after(() => app.close())
  const indexResponse = await app.inject('/api/notes')
  assert.equal(indexResponse.statusCode, 200, indexResponse.body)
  const index = indexResponse.json<NotesIndex>()
  const a = index.entries.find(entry => entry.path === 'A.md')!
  const b = index.entries.find(entry => entry.path === 'B.md')!
  const pathResponse = await app.inject('/api/notes/path?path=B.md')
  assert.equal(pathResponse.statusCode, 200, pathResponse.body)
  const record = pathResponse.json()
  assert.deepEqual(Object.keys(record).sort(), [
    'createdAt',
    'id',
    'path',
    'presence',
    'updatedAt',
    'version'
  ])
  assert.equal(record.id, b.id)
  assert.equal(record.presence, 'present')
  const descriptor = await app.inject(
    `/api/notes/identity?id=${b.id}&storageId=${index.storageId}`
  )
  assert.equal(descriptor.statusCode, 200, descriptor.body)
  const sourceResponse = await app.inject('/api/notes/path?path=A.md')
  const source = sourceResponse.json()
  assert.deepEqual(descriptor.json(), { note: record, backlinks: [source] })
  const graph = await app.inject('/api/notes/graph')
  assert.equal(graph.statusCode, 200, graph.body)
  assert.deepEqual(graph.json(), {
    storageId: index.storageId,
    nodes: [source, record],
    edges: [{ sourceId: a.id, targetId: b.id }]
  })
  const resolution = await app.inject({
    method: 'POST',
    url: '/api/notes/resolve',
    payload: {
      sourceId: a.id,
      storageId: index.storageId,
      text: '[B](B.md#heading)',
      href: 'B.md#heading'
    }
  })
  assert.equal(resolution.statusCode, 200, resolution.body)
  assert.deepEqual(resolution.json(), { id: b.id, anchor: 'heading' })
  const mutation = await app.inject({
    method: 'POST',
    url: '/api/notes/rename',
    payload: {
      path: 'B.md',
      name: 'Бета.md',
      folder: false,
      id: b.id,
      revision: index.revision
    }
  })
  assert.equal(mutation.statusCode, 200, mutation.body)
  assert.deepEqual(mutation.json(), {
    operationId: mutation.json().operationId,
    complete: true
  })
  assert.match(mutation.json().operationId, /^[a-f0-9-]{36}$/)
  const moved = await app.inject(
    `/api/notes/by-id?id=${b.id}&storageId=${index.storageId}`
  )
  assert.equal(moved.statusCode, 200, moved.body)
  assert.deepEqual(moved.json(), {
    id: b.id,
    storageId: index.storageId,
    path: 'Бета.md',
    text: '# Heading',
    version: record.version
  })
})

test('notes work below a symlinked root and skip unreadable files', async t => {
  const project = await mkdtemp(join(tmpdir(), 'notes-link-root-'))
  t.after(() => rm(project, { recursive: true, force: true }))
  const real = join(project, 'real')
  await mkdir(join(real, 'node_modules'), { recursive: true })
  await writeFile(join(real, 'node_modules', 'dep.md'), '# dep')
  await writeFile(join(real, 'good.md'), '# good')
  await writeFile(join(real, 'big.md'), 'x'.repeat(1_000_001))
  await writeFile(join(real, 'binary.md'), Buffer.from([0xff, 0xfe, 0xfd]))
  await symlink(real, join(project, 'linked'))
  const app = buildApp({ projectPath: project, notesDir: 'linked' })
  t.after(() => app.close())
  const response = await app.inject('/api/notes')
  assert.equal(response.statusCode, 200, response.body)
  const index = response.json<NotesIndex>()
  assert.deepEqual(
    index.entries.map(entry => entry.path),
    ['good.md']
  )
  assert.deepEqual(index.issues?.map(issue => issue.id).sort(), [
    'unreadable:big.md',
    'unreadable:binary.md'
  ])
  const saved = await app.inject({
    method: 'POST',
    url: '/api/notes/document',
    payload: { path: 'created.md', text: '# created' }
  })
  assert.equal(saved.statusCode, 201, saved.body)
})

test('loopback binds reject rebound hosts, other binds accept any matching origin', async t => {
  const project = await mkdtemp(join(tmpdir(), 'notes-rebind-'))
  t.after(() => rm(project, { recursive: true, force: true }))
  const local = buildApp({ projectPath: project, loopbackBind: true })
  t.after(() => local.close())
  const lan = buildApp({ projectPath: project })
  t.after(() => lan.close())
  const rebound = {
    host: 'evil.example:3847',
    origin: 'http://evil.example:3847'
  }
  assert.equal(
    (await local.inject({ url: '/api/notes', headers: rebound })).statusCode,
    403
  )
  assert.equal(
    (
      await local.inject({
        url: '/api/notes',
        headers: { host: 'localhost:3847', origin: 'http://localhost:3847' }
      })
    ).statusCode,
    200
  )
  assert.equal(
    (await lan.inject({ url: '/api/notes', headers: rebound })).statusCode,
    200
  )
  assert.equal(
    (
      await lan.inject({
        url: '/api/notes',
        headers: { host: 'a:1', origin: 'http://b:1' }
      })
    ).statusCode,
    403
  )
})
