import { test } from 'node:test'
import assert from 'node:assert/strict'
import { noteCreationPath, validNoteEntryName } from '@/utils/notes/entry-name'

test('creation appends a short name to the selected folder and adds Markdown extension', () => {
  assert.equal(
    noteCreationPath('plans/deep', '  Next step  ', false),
    'plans/deep/Next step.md'
  )
  assert.equal(noteCreationPath('', 'Root', false), 'Root.md')
  assert.equal(
    noteCreationPath('plans', 'Existing.MD', false),
    'plans/Existing.MD'
  )
  assert.equal(noteCreationPath('plans', 'Drafts', true), 'plans/Drafts')
  for (const name of [
    '',
    ' ',
    '.hidden',
    '..',
    '../escape',
    'other/name',
    'other\\name',
    'bad\0name'
  ]) {
    assert.equal(validNoteEntryName(name), false, name)
    assert.throws(() => noteCreationPath('plans', name, false))
  }
})
