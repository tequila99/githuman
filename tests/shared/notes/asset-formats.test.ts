import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  NOTE_ASSET_ID_PATTERN,
  noteAssetFormat
} from '../../../src/shared/notes/asset-formats.ts'

test('the asset identifier allowlist preserves existing URLs and rejects other extensions and paths', () => {
  const pattern = new RegExp(NOTE_ASSET_ID_PATTERN)
  for (const extension of ['png', 'jpg', 'gif', 'webp']) {
    assert.equal(pattern.test('a'.repeat(64) + '.' + extension), true)
    assert.equal(noteAssetFormat(extension)?.display, 'image')
  }
  for (const id of [
    'a'.repeat(64) + '.pdf',
    'a'.repeat(64) + '.apng',
    '../' + 'a'.repeat(64) + '.png',
    'short.png'
  ]) {
    assert.equal(pattern.test(id), false)
  }
  assert.equal(noteAssetFormat('pdf'), undefined)
  assert.equal(noteAssetFormat(undefined), undefined)
})
