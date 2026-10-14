import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { notesApi } from '@/api/notes'
import { ApiRequestError } from '@/api/client'
import { MAX_NOTE_ASSET_BYTES } from '../../../src/shared/notes/constants.ts'

test('image upload sends the original file as FormData without reading or encoding it', async t => {
  const file = new File(['image'], 'cat.png', { type: 'image/png' })
  const read = mock.method(file, 'arrayBuffer', async () => {
    throw new Error('Unexpected file read')
  })
  const fetch = mock.method(
    globalThis,
    'fetch',
    async (path: string | URL | Request, init?: RequestInit) => {
      assert.equal(path, '/api/notes/assets')
      assert.equal(init?.method, 'POST')
      assert.equal(init?.headers, undefined)
      assert.ok(init?.body instanceof FormData)
      assert.equal(init.body.get('file'), file)
      assert.deepEqual([...init.body.keys()], ['file'])
      return Response.json(
        { url: '/api/notes/assets/cat.png' },
        { status: 201 }
      )
    }
  )
  t.after(() => {
    read.mock.restore()
    fetch.mock.restore()
  })
  assert.deepEqual(await notesApi.uploadAsset(file), {
    url: '/api/notes/assets/cat.png'
  })
  assert.equal(read.mock.callCount(), 0)
})

test('image upload preserves API errors and rejects oversized files before sending', async t => {
  const fetch = mock.method(globalThis, 'fetch', async () =>
    Response.json({ message: 'Too large' }, { status: 413 })
  )
  t.after(() => fetch.mock.restore())
  await assert.rejects(
    notesApi.uploadAsset(new File(['x'], 'cat.png')),
    error =>
      error instanceof ApiRequestError &&
      error.status === 413 &&
      error.message === 'Too large'
  )
  await assert.rejects(
    notesApi.uploadAsset(
      new File([new Uint8Array(MAX_NOTE_ASSET_BYTES + 1)], 'large.png')
    ),
    /under 10 MB/
  )
  assert.equal(fetch.mock.callCount(), 1)
})
