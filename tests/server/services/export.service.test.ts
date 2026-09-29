import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestDatabase } from '../../../src/server/db/index.ts'
import { createReview } from '../../../src/server/repositories/review.repo.ts'
import { createComment } from '../../../src/server/repositories/comment.repo.ts'
import {
  exportAsJson,
  exportAsMarkdown,
  formatReviewAsMarkdown,
  ExportNotFoundError
} from '../../../src/server/services/export.service.ts'
import type { Comment, DiffFile, Review } from '../../../src/shared/types.ts'
import { createTempGitRepo } from '../helpers/git-fixture.ts'

const sampleFiles: DiffFile[] = [
  {
    oldPath: 'a.txt',
    newPath: 'a.txt',
    status: 'modified',
    additions: 1,
    deletions: 1,
    isBinary: false,
    hunks: [
      {
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: [
          {
            type: 'removed',
            content: 'old line',
            oldLineNumber: 1,
            newLineNumber: null
          },
          {
            type: 'added',
            content: 'new line',
            oldLineNumber: null,
            newLineNumber: 1
          }
        ]
      }
    ]
  }
]

function makeReview(overrides: Partial<Review> = {}): Review {
  const now = new Date().toISOString()
  return {
    id: 'review-1',
    repositoryPath: '/repo',
    baseRef: null,
    sourceType: 'staged',
    sourceRef: null,
    snapshotData: JSON.stringify(sampleFiles),
    status: 'in_progress',
    name: null,
    branch: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

test('exportAsJson returns the review and its comments', () => {
  const db = createTestDatabase()
  createReview(db, makeReview())
  createComment(db, {
    id: 'c1',
    reviewId: 'review-1',
    filePath: 'a.txt',
    lineNumber: 1,
    lineNumberEnd: 1,
    lineType: 'added',
    content: 'nice',
    createdAt: 'x',
    updatedAt: 'x'
  })

  const result = exportAsJson(db, 'review-1')

  assert.equal(result.review.id, 'review-1')
  assert.equal(result.comments.length, 1)
  assert.equal(result.comments[0].content, 'nice')
  db.close()
})

test('exportAsJson returns comments: [] when there are none', () => {
  const db = createTestDatabase()
  createReview(db, makeReview())

  const result = exportAsJson(db, 'review-1')

  assert.deepEqual(result.comments, [])
  db.close()
})

test('exportAsJson throws ExportNotFoundError for an unknown review', () => {
  const db = createTestDatabase()
  assert.throws(() => exportAsJson(db, 'does-not-exist'), ExportNotFoundError)
  db.close()
})

// A hunk with context, a removed and an added line, and a context line whose
// old/new numbers differ — enough to tell the anchor columns apart.
const richFile: DiffFile = {
  oldPath: 'src/app.ts',
  newPath: 'src/app.ts',
  status: 'modified',
  additions: 1,
  deletions: 1,
  isBinary: false,
  hunks: [
    {
      oldStart: 10,
      oldLines: 3,
      newStart: 10,
      newLines: 3,
      lines: [
        {
          type: 'context',
          content: 'const a = 1',
          oldLineNumber: 10,
          newLineNumber: 10
        },
        {
          type: 'removed',
          content: 'const b = 2',
          oldLineNumber: 11,
          newLineNumber: null
        },
        {
          type: 'added',
          content: 'const b = 3',
          oldLineNumber: null,
          newLineNumber: 11
        },
        {
          type: 'context',
          content: 'const c = 4',
          oldLineNumber: 12,
          newLineNumber: 12
        }
      ]
    }
  ]
}

function comment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: crypto.randomUUID(),
    reviewId: 'review-1',
    filePath: 'src/app.ts',
    lineNumber: 11,
    lineNumberEnd: 11,
    lineType: 'added',
    content: 'why 3?',
    createdAt: 'x',
    updatedAt: 'x',
    ...overrides
  }
}

function sectionOf(markdown: string, path: string): string {
  const start = markdown.indexOf(`## \`${path}\``)
  assert.notEqual(start, -1, `no section for ${path}`)
  const next = markdown.indexOf('\n## ', start + 1)
  return markdown.slice(start, next === -1 ? undefined : next)
}

test('formatReviewAsMarkdown shows only the commented lines, not the rest of the diff', () => {
  const markdown = formatReviewAsMarkdown(makeReview(), [richFile], [comment()])
  const section = sectionOf(markdown, 'src/app.ts')

  assert.ok(section.includes('1. Строка 11'))
  assert.ok(section.includes('```diff\n   +const b = 3\n   ```'))
  assert.ok(section.includes('   why 3?'))
  assert.ok(!markdown.includes('const a = 1'))
  assert.ok(!markdown.includes('const b = 2'))
  assert.ok(!markdown.includes('const c = 4'))
})

test('a removed-line comment is anchored on old-side line numbers', () => {
  const markdown = formatReviewAsMarkdown(
    makeReview(),
    [richFile],
    [comment({ lineType: 'removed', content: 'was fine' })]
  )

  assert.ok(markdown.includes('-const b = 2'))
  assert.ok(!markdown.includes('+const b = 3'))
})

test('a range includes exactly the lines numbered within it in the anchor column', () => {
  const markdown = formatReviewAsMarkdown(
    makeReview(),
    [richFile],
    [comment({ lineNumber: 10, lineNumberEnd: 11, lineType: 'context' })]
  )

  assert.ok(markdown.includes('1. Строки 10–11'))
  assert.ok(markdown.includes(' const a = 1\n   +const b = 3'))
  assert.ok(!markdown.includes('const b = 2'), 'no old-side-only lines')
})

test('a comment saved before ranges existed (lineNumberEnd null) covers its single line', () => {
  const markdown = formatReviewAsMarkdown(
    makeReview(),
    [richFile],
    [comment({ lineNumberEnd: null })]
  )

  assert.ok(markdown.includes('1. Строка 11'))
  assert.ok(markdown.includes('+const b = 3'))
})

test('resolved comments are left out, and files without open comments get no section', () => {
  const markdown = formatReviewAsMarkdown(
    makeReview(),
    [...sampleFiles, richFile],
    [
      comment(),
      comment({
        filePath: 'a.txt',
        lineNumber: 1,
        lineNumberEnd: 1,
        resolved: true
      })
    ]
  )

  assert.ok(markdown.includes('## `src/app.ts`'))
  assert.ok(!markdown.includes('a.txt'))
})

test('a review with no open comments says so instead of listing files', () => {
  const markdown = formatReviewAsMarkdown(
    makeReview(),
    [richFile],
    [comment({ resolved: true })]
  )

  assert.ok(markdown.includes('Открытых замечаний нет.'))
  assert.ok(!markdown.includes('## '))
  assert.ok(!markdown.includes('undefined'))
})

test('items are numbered per file: whole-file first, then diff comments in snapshot order, then full-file ones', () => {
  const markdown = formatReviewAsMarkdown(
    makeReview(),
    [richFile],
    [
      comment({ content: 'on added', lineNumber: 11, lineNumberEnd: 11 }),
      comment({
        content: 'full-file',
        lineType: null,
        lineNumber: 2,
        lineNumberEnd: 2
      }),
      comment({
        content: 'on context',
        lineType: 'context',
        lineNumber: 10,
        lineNumberEnd: 10
      }),
      comment({
        content: 'whole file',
        lineType: null,
        lineNumber: null,
        lineNumberEnd: null
      })
    ],
    new Map([['src/app.ts', ['x', 'y']]])
  )
  const section = sectionOf(markdown, 'src/app.ts')

  const order = ['whole file', 'on context', 'on added', 'full-file'].map(
    text => section.indexOf(text)
  )
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order
  )
  assert.ok(section.includes('1. Файл целиком'))
  assert.ok(section.includes('4. Строка 2 (файл целиком)'))
})

test('full-file comments show the lines from the current file, fenced by extension', () => {
  const markdown = formatReviewAsMarkdown(
    makeReview(),
    [richFile],
    [
      comment({
        lineType: null,
        lineNumber: 2,
        lineNumberEnd: 3,
        content: 'hmm'
      })
    ],
    new Map([['src/app.ts', ['one', 'two', 'three', 'four']]])
  )

  assert.ok(markdown.includes('```ts\n   two\n   three\n   ```'))
})

test('a full-file comment whose file is unavailable or shorter is kept, with a note instead of code', () => {
  const markdown = formatReviewAsMarkdown(
    makeReview(),
    [richFile],
    [
      comment({
        lineType: null,
        lineNumber: 5,
        lineNumberEnd: 6,
        content: 'gone?'
      })
    ],
    new Map([['src/app.ts', ['only one line']]])
  )

  assert.ok(markdown.includes('Файл изменился или недоступен'))
  assert.ok(markdown.includes('gone?'))
  assert.ok(!markdown.includes('only one line'))
})

test('a diff comment whose lines are not in the snapshot is kept, with a note', () => {
  const markdown = formatReviewAsMarkdown(
    makeReview(),
    [richFile],
    [comment({ lineNumber: 99, lineNumberEnd: 99 })]
  )

  assert.ok(markdown.includes('Строки не найдены в снимке diff'))
})

test('a renamed or deleted file is matched by newPath, else oldPath', () => {
  const deleted: DiffFile = {
    ...richFile,
    oldPath: 'gone.ts',
    newPath: '',
    status: 'deleted'
  }
  const markdown = formatReviewAsMarkdown(
    makeReview(),
    [deleted],
    [comment({ filePath: 'gone.ts', lineType: 'removed' })]
  )

  assert.ok(markdown.includes('## `gone.ts`'))
  assert.ok(markdown.includes('-const b = 2'))
})

test('the code fence grows when the code itself contains backticks', () => {
  const withFence: DiffFile = {
    ...richFile,
    hunks: [
      {
        ...richFile.hunks[0],
        lines: [
          {
            type: 'added',
            content: '```js',
            oldLineNumber: null,
            newLineNumber: 11
          }
        ]
      }
    ]
  }
  const markdown = formatReviewAsMarkdown(
    makeReview(),
    [withFence],
    [comment()]
  )

  assert.ok(markdown.includes('````diff\n   +```js\n   ````'))
})

test('items past the 9th indent their body under the wider "10. " marker', () => {
  const comments = Array.from({ length: 10 }, (_, i) =>
    comment({
      lineType: null,
      lineNumber: i + 1,
      lineNumberEnd: i + 1,
      content: `note ${i + 1}`
    })
  )
  const markdown = formatReviewAsMarkdown(
    makeReview(),
    [richFile],
    comments,
    new Map([
      ['src/app.ts', Array.from({ length: 10 }, (_, i) => `line ${i + 1}`)]
    ])
  )

  assert.ok(markdown.includes('10. Строка 10 (файл целиком)'))
  assert.ok(markdown.includes('\n    note 10'))
  assert.ok(markdown.includes('\n   note 9'))
})

test('multi-line comment text stays inside its list item', () => {
  const markdown = formatReviewAsMarkdown(
    makeReview(),
    [richFile],
    [comment({ content: 'first\n\nsecond' })]
  )

  assert.ok(markdown.includes('   first\n\n   second'))
})

test('a suggestion is rendered as its own block under the comment', () => {
  const markdown = formatReviewAsMarkdown(
    makeReview(),
    [richFile],
    [comment({ suggestion: 'const b = 2' })]
  )

  assert.ok(markdown.includes('Предложение:'))
  assert.ok(markdown.includes('```\n   const b = 2\n   ```'))
})

test('exportAsMarkdown reads full-file comment lines from the given working tree', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)
  writeFileSync(join(fixture.dir, 'notes.md'), 'alpha\nbeta\ngamma\n')

  const db = createTestDatabase()
  t.after(() => db.close())
  createReview(db, makeReview({ repositoryPath: '/moved/elsewhere' }))
  createComment(
    db,
    comment({
      filePath: 'notes.md',
      lineType: null,
      lineNumber: 2,
      lineNumberEnd: 3
    })
  )

  const markdown = await exportAsMarkdown(db, 'review-1', fixture.dir)

  assert.ok(markdown.includes('```md\n   beta\n   gamma\n   ```'))
})

test('exportAsMarkdown rejects with ExportNotFoundError for an unknown review', async () => {
  const db = createTestDatabase()
  await assert.rejects(
    exportAsMarkdown(db, 'does-not-exist', '/repo'),
    ExportNotFoundError
  )
  db.close()
})
