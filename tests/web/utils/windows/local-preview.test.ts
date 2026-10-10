import { test } from 'node:test'
import assert from 'node:assert/strict'
import { localPreviewKind } from '@/utils/windows/local-preview'

test('file selection and drop accept supported extensions without MIME metadata', () => {
  for (const [name, kind] of [
    ['README.MD', 'markdown'],
    ['readme.markdown', 'markdown'],
    ['report.PDF', 'pdf'],
    ['photo.JPG', 'image'],
    ['diagram.svg', 'image']
  ]) {
    assert.equal(localPreviewKind({ name: name!, type: '' }), kind)
  }
  assert.equal(
    localPreviewKind({ name: 'download', type: 'application/pdf' }),
    'pdf'
  )
  assert.equal(
    localPreviewKind({ name: 'picture', type: 'image/png' }),
    'image'
  )
  assert.equal(
    localPreviewKind({ name: 'script.js', type: 'text/javascript' }),
    null
  )
})
