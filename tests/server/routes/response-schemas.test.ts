import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTempGitRepo } from '../helpers/git-fixture.ts'
import { buildApp } from '../../../src/server/app.ts'
import { createTestDatabase } from '../../../src/server/db/index.ts'
import {
  getBranchDiff,
  getCommitsDiff,
  getDiffSummaries,
  getFileDiff
} from '../../../src/server/services/diff.service.ts'
import {
  getFileAtRef,
  getFilesAtRef,
  getRepositoryInfo
} from '../../../src/server/services/git.service.ts'
import {
  findReviewById,
  listReviews
} from '../../../src/server/repositories/review.repo.ts'
import { listCommentsByReview } from '../../../src/server/repositories/comment.repo.ts'
import {
  exportAsJson,
  exportAsMarkdown
} from '../../../src/server/services/export.service.ts'
import { getAppVersion } from '../../../src/server/app-version.ts'
import { toReviewSummary } from '../../../src/shared/reviews/summary.ts'
import type { Comment } from '../../../src/shared/comments/types.ts'
import type { Review } from '../../../src/shared/reviews/types.ts'

/** A small ACP agent that starts, answers and offers settings. */
const FAKE_AGENT = join(import.meta.dirname, '../fixtures/fake-acp-agent.ts')

// Fastify writes a response through its schema and drops fields that the
// schema does not have. Each test compares a whole body with the value that
// the service gives, so a field missing from a schema fails here (#55).

/** The value as JSON gives it: no undefined fields. */
function json(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value))
}

/** A repository with every kind of file change on both sides and in commits. */
async function setup(t: TestContext) {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)
  const { dir, git } = fixture
  writeFileSync(join(dir, 'mod.txt'), 'one\ntwo\nthree\n')
  writeFileSync(join(dir, 'gone.txt'), 'bye\n')
  writeFileSync(join(dir, 'old-name.txt'), 'same\ncontent\nhere\n')
  writeFileSync(join(dir, 'bin.dat'), Buffer.from([0, 1, 2, 3]))
  // A change far from the top gives a hunk a preamble.
  const longLines = Array.from({ length: 12 }, (_, i) => `l${i + 1}`)
  writeFileSync(join(dir, 'long.txt'), `${longLines.join('\n')}\n`)
  await git.add('.')
  await git.commit('base')
  const base = (await git.revparse(['HEAD'])).trim()
  await git.checkoutLocalBranch('feature')
  writeFileSync(join(dir, 'mod.txt'), 'one\nTWO\nthree\nfour\n')
  rmSync(join(dir, 'gone.txt'))
  await git.mv('old-name.txt', 'new-name.txt')
  writeFileSync(join(dir, 'bin.dat'), Buffer.from([0, 9, 9, 9, 9]))
  longLines[9] = 'L10'
  writeFileSync(join(dir, 'long.txt'), `${longLines.join('\n')}\n`)
  await git.add('.')
  await git.commit('feature')
  const head = (await git.revparse(['HEAD'])).trim()
  // Staged: a modified and an added file. Unstaged: an edit and an untracked file.
  writeFileSync(join(dir, 'mod.txt'), 'one\nTWO\nfour\n')
  writeFileSync(join(dir, 'added.txt'), 'a\nb\n')
  await git.add(['mod.txt', 'added.txt'])
  writeFileSync(join(dir, 'mod.txt'), 'zero\none\nTWO\nfour\n')
  writeFileSync(join(dir, 'untracked.txt'), 'u\n')

  const db = createTestDatabase()
  const app = buildApp({ repositoryPath: dir, db })
  t.after(() => app.close())
  return { dir, git, db, app, base, head }
}

test('diff routes return whole files and summaries', async t => {
  const { dir, app, base, head } = await setup(t)

  for (const source of ['staged', 'unstaged'] as const) {
    const files = await app.inject(`/api/diff/${source}/files`)
    assert.equal(files.statusCode, 200)
    const summaries = await getDiffSummaries(dir, source)
    assert.ok(summaries.length > 0)
    assert.deepEqual(files.json(), json(summaries))

    for (const summary of summaries) {
      const query = new URLSearchParams({
        path: summary.newPath,
        oldPath: summary.oldPath,
        status: summary.status
      })
      const file = await app.inject(`/api/diff/${source}/file?${query}`)
      assert.equal(file.statusCode, 200)
      assert.deepEqual(
        file.json(),
        json(
          await getFileDiff(dir, source, {
            oldPath: summary.oldPath,
            newPath: summary.newPath,
            status: summary.status
          })
        )
      )
    }
  }

  const commits = await getCommitsDiff(dir, base, head)
  assert.deepEqual(
    new Set(commits.map(file => file.status)),
    new Set(['modified', 'deleted', 'renamed']),
    'the fixture covers each status with hunks'
  )
  assert.ok(commits.some(file => file.isBinary))
  const lines = commits.flatMap(f => f.hunks.flatMap(h => h.lines))
  assert.ok(lines.some(line => line.oldLineNumber === null))
  assert.ok(lines.some(line => line.newLineNumber === null))
  assert.ok(
    commits.some(file => file.hunks.some(hunk => hunk.preamble !== undefined)),
    'the fixture has a hunk with a preamble, so the response must keep that field'
  )
  const commitsResponse = await app.inject(
    `/api/diff/commits?from=${base}&to=${head}`
  )
  assert.deepEqual(commitsResponse.json(), json(commits))

  const branch = await app.inject(`/api/diff/branch?base=${base}`)
  assert.deepEqual(branch.json(), json(await getBranchDiff(dir, base)))
})

test('git routes return whole bodies', async t => {
  const { dir, git, app } = await setup(t)

  const noRemote = await app.inject('/api/git/info')
  assert.equal(noRemote.json().remote, null)
  assert.deepEqual(noRemote.json(), json(await getRepositoryInfo(dir)))
  await git.addRemote('origin', 'https://example.com/repo.git')
  const withRemote = await app.inject('/api/git/info')
  assert.equal(withRemote.json().remote, 'https://example.com/repo.git')
  assert.deepEqual(withRemote.json(), json(await getRepositoryInfo(dir)))

  const tree = await app.inject('/api/git/tree/HEAD')
  assert.deepEqual(tree.json(), {
    ref: 'HEAD',
    files: await getFilesAtRef(dir, 'HEAD')
  })

  for (const path of ['mod.txt', 'bin.dat']) {
    const file = await app.inject(`/api/git/file/${path}?ref=HEAD`)
    const { content, isBinary } = await getFileAtRef(dir, 'HEAD', path)
    const lines = isBinary ? [] : content.split('\n')
    assert.deepEqual(file.json(), {
      path,
      ref: 'HEAD',
      content,
      lines,
      lineCount: lines.length,
      isBinary
    })
  }

  for (const action of ['stage', 'unstage']) {
    const response = await app.inject({
      method: 'POST',
      url: `/api/git/${action}`,
      payload: { paths: ['untracked.txt'] }
    })
    assert.deepEqual(response.json(), { ok: true })
  }
  const discarded = await app.inject({
    method: 'POST',
    url: '/api/git/discard',
    payload: { paths: ['mod.txt'] }
  })
  assert.deepEqual(discarded.json(), { ok: true })
})

test('review, comment and export routes return whole bodies', async t => {
  const { dir, db, app, base, head } = await setup(t)

  const created = await app.inject({
    method: 'POST',
    url: '/api/reviews',
    payload: { sourceType: 'commits', baseRef: base, sourceRef: head }
  })
  assert.equal(created.statusCode, 201)
  const review = created.json<Review>()
  assert.notEqual(review.baseRef, null)
  assert.deepEqual(review, json(findReviewById(db, review.id)))
  const local = (
    await app.inject({ method: 'POST', url: '/api/reviews', payload: {} })
  ).json<Review>()
  assert.equal(local.baseRef, null)
  assert.equal(local.sourceRef, null)

  const list = await app.inject('/api/reviews')
  assert.deepEqual(list.json(), json(listReviews(db, { branch: 'feature' })))
  assert.equal(list.json().length, 2)
  const one = await app.inject(`/api/reviews/${review.id}`)
  assert.deepEqual(one.json(), json(findReviewById(db, review.id)))

  const fileComment = await app.inject({
    method: 'POST',
    url: `/api/reviews/${review.id}/comments`,
    payload: { filePath: 'mod.txt', content: 'file note', lineNumber: null }
  })
  assert.equal(fileComment.statusCode, 201)
  const lineComment = await app.inject({
    method: 'POST',
    url: `/api/reviews/${review.id}/comments`,
    payload: {
      filePath: 'mod.txt',
      lineNumber: 2,
      lineNumberEnd: 3,
      lineType: 'added',
      content: 'line note',
      suggestion: 'TWO\n'
    }
  })
  const lineId = lineComment.json<Comment>().id
  const resolved = await app.inject({
    method: 'PATCH',
    url: `/api/comments/${lineId}/resolve`
  })
  assert.equal(resolved.json().resolved, true)
  const comments = listCommentsByReview(db, review.id)
  assert.ok(comments.some(comment => comment.lineType === null))
  assert.ok(comments.some(comment => comment.suggestion !== null))
  assert.deepEqual(resolved.json(), json(comments.find(c => c.id === lineId)))
  const listed = await app.inject(`/api/reviews/${review.id}/comments`)
  assert.deepEqual(listed.json(), json(comments))
  const edited = await app.inject({
    method: 'PATCH',
    url: `/api/comments/${lineId}`,
    payload: { content: 'changed' }
  })
  assert.deepEqual(
    edited.json(),
    json(listCommentsByReview(db, review.id).find(c => c.id === lineId))
  )
  const unresolved = await app.inject({
    method: 'PATCH',
    url: `/api/comments/${lineId}/unresolve`
  })
  assert.equal(unresolved.json().resolved, false)
  assert.deepEqual(
    unresolved.json(),
    json(listCommentsByReview(db, review.id).find(c => c.id === lineId))
  )

  const exported = await app.inject(
    `/api/reviews/${review.id}/export?format=json`
  )
  assert.match(exported.headers['content-type'] ?? '', /application\/json/)
  assert.deepEqual(exported.json(), json(exportAsJson(db, review.id)))
  const markdown = await app.inject(
    `/api/reviews/${review.id}/export?format=markdown`
  )
  assert.match(markdown.headers['content-type'] ?? '', /text\/markdown/)
  assert.equal(markdown.body, await exportAsMarkdown(db, review.id, dir))

  const patched = await app.inject({
    method: 'PATCH',
    url: `/api/reviews/${review.id}`,
    payload: { status: 'approved' }
  })
  assert.equal(patched.json().status, 'approved')
  assert.deepEqual(
    patched.json(),
    json(toReviewSummary(findReviewById(db, review.id)!))
  )
})

test('app routes return whole bodies', async t => {
  const { app } = await setup(t)
  assert.deepEqual((await app.inject('/health')).json(), { status: 'ok' })
  assert.deepEqual((await app.inject('/api/app-info')).json(), {
    version: getAppVersion(),
    terminal: { available: false, mode: null }
  })
})

test('errors keep code, error, message and statusCode', async t => {
  const { app } = await setup(t)
  const cases = [
    { url: '/api/reviews/missing', status: 404, code: 'GHT_HTTP_NOT_FOUND' },
    {
      url: '/api/diff/branch?base=-x',
      status: 400,
      code: 'GHT_HTTP_BAD_REQUEST'
    },
    { url: '/api/diff/branch', status: 400, code: 'FST_ERR_VALIDATION' },
    {
      url: '/api/diff/unstaged/file?path=../x&status=added',
      status: 400,
      code: 'GHT_HTTP_BAD_REQUEST'
    }
  ]
  for (const { url, status, code } of cases) {
    const response = await app.inject(url)
    assert.equal(response.statusCode, status, url)
    const body = response.json()
    assert.deepEqual(Object.keys(body).sort(), [
      'code',
      'error',
      'message',
      'statusCode'
    ])
    assert.equal(body.code, code, url)
    assert.equal(body.statusCode, status, url)
  }
})

test('agent routes return whole bodies', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)
  writeFileSync(join(fixture.dir, 'a.txt'), 'a\n')
  const app = buildApp({
    repositoryPath: fixture.dir,
    agentPresets: [
      {
        id: 'fake',
        title: 'Fake',
        command: process.execPath,
        args: [FAKE_AGENT],
        autoApprovesEdits: false
      },
      {
        id: 'broken',
        title: 'Broken',
        command: join(fixture.dir, 'no-such-agent'),
        args: [],
        autoApprovesEdits: true
      }
    ]
  })
  t.after(() => app.close())

  assert.deepEqual((await app.inject('/api/agent/presets')).json(), [
    { id: 'fake', title: 'Fake', available: true, autoApprovesEdits: false },
    { id: 'broken', title: 'Broken', available: false, autoApprovesEdits: true }
  ])

  /** Starts a session and waits until it leaves `starting`. */
  async function start(payload: object) {
    const created = await app.inject({
      method: 'POST',
      url: '/api/agent/sessions',
      payload
    })
    assert.equal(created.statusCode, 201)
    let info = created.json()
    const deadline = Date.now() + 10_000
    while (info.status === 'starting') {
      assert.ok(Date.now() < deadline, 'the session did not start')
      await new Promise(resolve => setTimeout(resolve, 20))
      info = (await app.inject(`/api/agent/sessions/${info.id}`)).json()
    }
    return info
  }

  const review = (
    await app.inject({ method: 'POST', url: '/api/reviews', payload: {} })
  ).json<Review>()
  const ready = await start({ presetId: 'fake', name: 'Ready' })
  assert.deepEqual(ready, {
    id: ready.id,
    presetId: 'fake',
    name: 'Ready',
    status: 'ready',
    reviewId: null,
    autoApprove: false,
    error: null
  })
  const broken = await start({
    presetId: 'broken',
    name: 'Broken',
    reviewId: review.id
  })
  assert.deepEqual(broken, {
    id: broken.id,
    presetId: 'broken',
    name: 'Broken',
    status: 'closed',
    reviewId: review.id,
    autoApprove: false,
    error: broken.error
  })
  assert.equal(typeof broken.error, 'string')
  assert.deepEqual((await app.inject('/api/agent/sessions')).json(), [
    ready,
    broken
  ])

  const files = await app.inject('/api/agent/files?q=a')
  assert.deepEqual(files.json(), { paths: ['a.txt'] })

  // 202 keeps an empty body, as before the response schema.
  const prompted = await app.inject({
    method: 'POST',
    url: `/api/agent/sessions/${ready.id}/prompt`,
    payload: { text: 'hello' }
  })
  assert.equal(prompted.statusCode, 202)
  assert.equal(prompted.body, '')
})

test('a config value that is not a string or a boolean gives GHT_AGENT_CONFIG', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)
  const app = buildApp({
    repositoryPath: fixture.dir,
    agentPresets: [
      {
        id: 'fake',
        title: 'Fake',
        command: process.execPath,
        args: [FAKE_AGENT],
        autoApprovesEdits: false
      }
    ]
  })
  t.after(() => app.close())
  let info = (
    await app.inject({
      method: 'POST',
      url: '/api/agent/sessions',
      payload: { presetId: 'fake' }
    })
  ).json()
  const deadline = Date.now() + 10_000
  while (info.status === 'starting') {
    assert.ok(Date.now() < deadline, 'the session did not start')
    await new Promise(resolve => setTimeout(resolve, 20))
    info = (await app.inject(`/api/agent/sessions/${info.id}`)).json()
  }

  const url = `/api/agent/sessions/${info.id}/config`
  for (const value of [1, null, { on: true }]) {
    const response = await app.inject({
      method: 'POST',
      url,
      payload: { configId: 'turbo', value }
    })
    assert.equal(response.statusCode, 400, JSON.stringify(value))
    assert.equal(response.json().code, 'GHT_AGENT_CONFIG')
  }
})

test('the agent guard and server errors keep the error body', async t => {
  const notRepo = mkdtempSync(join(tmpdir(), 'githuman-not-repo-'))
  t.after(() => rmSync(notRepo, { recursive: true, force: true }))
  const app = buildApp({ repositoryPath: notRepo, agentPresets: [] })
  t.after(() => app.close())

  const forbidden = await app.inject({
    url: '/api/agent/presets',
    headers: { host: 'hostile.example' }
  })
  assert.equal(forbidden.statusCode, 403)
  assert.deepEqual(Object.keys(forbidden.json()).sort(), [
    'code',
    'error',
    'message',
    'statusCode'
  ])

  const failed = await app.inject('/api/git/info')
  assert.equal(failed.statusCode, 500)
  const body = failed.json()
  assert.equal(body.statusCode, 500)
  assert.equal(body.error, 'Internal Server Error')
  assert.equal(typeof body.message, 'string')
})
