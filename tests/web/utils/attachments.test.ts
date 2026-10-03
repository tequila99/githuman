import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attachmentBytes, attachmentSrc } from '@/utils/attachments'

const item = {
  kind: 'attachment' as const,
  name: 'blob.bin',
  mimeType: 'application/octet-stream',
  data: Buffer.from([0, 1, 2, 255]).toString('base64')
}

test('an attachment is decoded back to the bytes it was read from', () => {
  assert.deepEqual([...attachmentBytes(item)], [0, 1, 2, 255])
  assert.deepEqual([...attachmentBytes({ ...item, data: '' })], [])
})

test('an attachment becomes a data URL with its own type', () => {
  assert.equal(
    attachmentSrc(item),
    `data:application/octet-stream;base64,${item.data}`
  )
})
