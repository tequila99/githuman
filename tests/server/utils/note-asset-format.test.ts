import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { detectNoteAssetFormat } from '../../../src/server/utils/note-asset-format.ts'
import { BadRequestError } from '../../../src/server/errors/http.ts'

test('real image formats produce canonical extensions, MIME and display modes', async () => {
  for (const [extension, mime] of [
    ['png', 'image/png'],
    ['jpg', 'image/jpeg'],
    ['gif', 'image/gif'],
    ['webp', 'image/webp']
  ]) {
    const bytes = await readFile(
      new URL(`../fixtures/note-assets/sample.${extension}`, import.meta.url)
    )
    const format = await detectNoteAssetFormat(bytes)
    assert.equal(format.extension, extension)
    assert.equal(format.mime, mime)
    assert.equal(format.display, 'image')
  }
})

test('animated PNG keeps the existing PNG extension and MIME', async () => {
  const format = await detectNoteAssetFormat(
    await readFile(
      new URL('../fixtures/note-assets/animated.png', import.meta.url)
    )
  )
  assert.equal(format.extension, 'png')
  assert.equal(format.mime, 'image/png')
})

test('unknown, unsupported and truncated attachments return a client error', async () => {
  const png = await readFile(
    new URL('../fixtures/note-assets/sample.png', import.meta.url)
  )
  for (const bytes of [
    Buffer.alloc(0),
    Buffer.from('plain text'),
    Buffer.from('<svg></svg>'),
    Buffer.from('%PDF-1.7\n'),
    png.subarray(0, 8),
    await readFile(
      new URL('../fixtures/note-assets/sample.bmp', import.meta.url)
    )
  ]) {
    await assert.rejects(
      detectNoteAssetFormat(bytes),
      error => error instanceof BadRequestError && error.statusCode === 400
    )
  }
})
