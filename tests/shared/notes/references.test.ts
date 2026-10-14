import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  noteReferences,
  referenceTarget,
  rewriteReferences
} from '../../../src/shared/notes/references.ts'

test('AST references exclude code and preserve titles, definitions, YAML comments and Unicode', () => {
  const text =
    '\uFEFF---\r\nrelated: "[[old|Alias]]" # keep\r\n---\r\n[Label](<old.md#part> "Title")\r\n[again][ref]\r\n\r\n[ref]: old.md \'Title\'\r\n![image](../assets/a.png)\r\n`[code](old.md)`\r\n```\r\n[code](old.md)\r\n```\r\n'
  const refs = noteReferences(text)
  assert.equal(refs.length, 4)
  const changes = refs.map(reference => ({
    reference,
    from: 'sub/new.md',
    target: reference.image ? 'assets/a.png' : 'sub/Новое имя.md',
    anchor: reference.href.includes('#') ? 'part' : ''
  }))
  const result = rewriteReferences(text, changes)
  assert.ok(result.includes('related: "[[sub/Новое имя|Alias]]" # keep\r\n'))
  assert.ok(
    result.includes(
      '[Label](<%D0%9D%D0%BE%D0%B2%D0%BE%D0%B5%20%D0%B8%D0%BC%D1%8F.md#part> "Title")'
    )
  )
  assert.ok(
    result.includes(
      "[ref]: %D0%9D%D0%BE%D0%B2%D0%BE%D0%B5%20%D0%B8%D0%BC%D1%8F.md 'Title'"
    )
  )
  assert.ok(result.includes('`[code](old.md)`'))
  assert.ok(result.includes('```\r\n[code](old.md)'))
  assert.equal(
    referenceTarget(
      refs.find(ref => ref.image)!,
      'sub/a.md',
      []
    )?.path,
    'assets/a.png'
  )
})
