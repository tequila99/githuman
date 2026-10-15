import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  externalNoteAssets,
  replaceExternalNoteAssets,
  externalAssetOffset,
  invertExternalAssetEdits,
  isNoteAssetShortcut
} from '../../../src/shared/notes/external-assets.ts'

test('finds images without extensions and ordinary image/PDF links, excluding code, YAML and pages', () => {
  const text =
    '---\nsource: https://example.com/a.pdf\n---\n![](https://example.com/dynamic?id=1)\n\n[photo](https://example.com/a.JPEG?t=2)\n\n[PDF](https://example.com/book.pdf#page=4)\n\n[page](https://example.com/article)\n\n`![](https://example.com/code.png)`\n\n```md\n![](https://example.com/fenced.png)\n```\n\n<img src="https://example.com/html.png">\n\n[unused]: https://example.com/unused.png'
  assert.deepEqual(
    externalNoteAssets(text).map(item => [item.url, item.kind]),
    [
      ['https://example.com/dynamic?id=1', 'image'],
      ['https://example.com/a.JPEG?t=2', 'image'],
      ['https://example.com/book.pdf', 'pdf']
    ]
  )
})

test('mixed reference definitions are counted and rewritten once with exact surrounding bytes', () => {
  const head = '\uFEFF---\r\ntitle: "Keep"\r\n---\r\n'
  const text =
    head +
    '![alt][ref]\r\n\r\n[Open][ref]\r\n\r\n[ref]: <https://example.com/dynamic?a=1#anchor> "Title"\r\n'
  const assets = externalNoteAssets(text)
  assert.equal(assets.length, 1)
  assert.equal(assets[0]?.occurrences, 2)
  assert.equal(assets[0]?.kind, 'image')
  const result = replaceExternalNoteAssets(
    text,
    new Map([['https://example.com/dynamic?a=1', '/api/notes/assets/a.png']])
  )
  assert.equal(result.count, 2)
  assert.equal(
    result.text,
    text.replace('https://example.com/dynamic?a=1', '/api/notes/assets/a.png')
  )
})

test('duplicate resources with different fragments share a download and retain each fragment', () => {
  const text =
    '[one](https://example.com/book.pdf#page=1) [two](https://example.com/book.pdf#page=2)'
  assert.equal(externalNoteAssets(text)[0]?.occurrences, 2)
  assert.equal(
    replaceExternalNoteAssets(
      text,
      new Map([['https://example.com/book.pdf', '/api/notes/assets/a.pdf']])
    ).text,
    '[one](/api/notes/assets/a.pdf#page=1) [two](/api/notes/assets/a.pdf#page=2)'
  )
})

test('relative, internal and unsupported destinations are not candidates', () => {
  const text =
    '![](../a.png) ![](/api/notes/assets/a.png) ![](data:image/png;base64,AAA) ![](blob:x) ![](file:///a.png) ![](https://user:pass@example.com/a.png) [zip](https://example.com/a.zip)'
  assert.deepEqual(externalNoteAssets(text), [])
  assert.equal(
    externalNoteAssets('![](//example.com/a.png)', 'http:')[0]?.url,
    'http://example.com/a.png'
  )
})

test('keyboard command uses the physical key and excludes repeat, IME and other modifiers', () => {
  const event = {
    code: 'KeyD',
    ctrlKey: true,
    shiftKey: false,
    altKey: false,
    metaKey: true,
    repeat: false,
    isComposing: false
  }
  assert.equal(isNoteAssetShortcut(event), true)
  for (const change of [
    { code: 'KeyA' },
    { ctrlKey: false },
    { shiftKey: true },
    { altKey: true },
    { metaKey: false },
    { repeat: true },
    { isComposing: true }
  ]) {
    assert.equal(isNoteAssetShortcut({ ...event, ...change }), false)
  }
})

test('cursor mapping accounts for every preceding URL replacement', () => {
  const edits = [
    { start: 5, end: 10, value: 'xyz' },
    { start: 20, end: 25, value: '0123456789' }
  ]
  assert.equal(externalAssetOffset(3, edits), 3)
  assert.equal(externalAssetOffset(15, edits), 13)
  assert.equal(externalAssetOffset(30, edits), 33)
  assert.equal(externalAssetOffset(25, edits), 28)
  assert.equal(externalAssetOffset(8, edits), 8)
})

test('inverse edits restore the original text after replacements of different length', () => {
  const original =
    'a ![x](https://e.com/long-name.png) b [Привет](https://e.com/ф.pdf#1) c'
  const urls = new Map([
    ['https://e.com/long-name.png', '/a.png'],
    ['https://e.com/%D1%84.pdf', '/very/long/stored/path/name.pdf']
  ])
  const replaced = replaceExternalNoteAssets(original, urls)
  assert.notEqual(replaced.text, original)
  const inverse = invertExternalAssetEdits(original, replaced.edits)
  let restored = replaced.text
  for (const edit of [...inverse].sort((a, b) => b.start - a.start)) {
    restored =
      restored.slice(0, edit.start) + edit.value + restored.slice(edit.end)
  }
  assert.equal(restored, original)
})
