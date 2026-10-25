import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isPdfPath } from '../../../src/shared/utils/pdf-path.ts'

test('isPdfPath accepts .pdf in any case only at the end', () => {
  for (const path of ['a.pdf', 'dir/B.PDF']) {
    assert.equal(isPdfPath(path), true, path)
  }
  for (const path of ['a.pdfx', 'a.pdf.txt', 'pdf', '']) {
    assert.equal(isPdfPath(path), false, path)
  }
})
