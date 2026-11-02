import { test } from 'node:test'
import assert from 'node:assert/strict'
import { artifactBody } from '../../../src/shared/utils/artifact-body.ts'

for (const [content, line, expected] of [
  ['---\r\ntitle: Текст 🧪\r\n---\r\nBody 🧪\r\n', 4, 'Body 🧪\r\n'],
  ['header\n', 2, ''],
  ['', 1, ''],
  ['only one line', 4, ''],
  ['one\ntwo', 5, ''],
  ['Body 🧪', 1, 'Body 🧪']
] as const) {
  test(
    'extracts body without normalizing content: ' +
      JSON.stringify([content, line]),
    () => {
      assert.equal(artifactBody(content, line), expected)
    }
  )
}
