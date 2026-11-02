import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createArtifactProposal } from '@/utils/artifact-proposal'

let savedFetch: typeof fetch
beforeEach(() => {
  savedFetch = globalThis.fetch
})
afterEach(() => {
  globalThis.fetch = savedFetch
})
function snapshot() {
  const proposal = {
    id: 'proposal',
    version: 2,
    requestId: 'propose',
    changeDigest: 'digest',
    requestDigest: 'request',
    actor: { kind: 'agent', id: 'agent' },
    changeSet: {
      storeId: 'store',
      command: 'accept',
      subjectIds: ['document'],
      expectedVersions: [{ id: 'document', version: 1 }],
      targetStatuses: [],
      relationChanges: [],
      supplementDispositions: [],
      reason: 'Review'
    }
  }
  const preview = {
    changeDigest: 'digest',
    affectedIds: ['document'],
    postState: [],
    errors: []
  }
  return {
    storeId: 'store',
    proposal,
    preview,
    ready: true,
    problem: null,
    validation: {
      id: 'validation',
      changeSetId: 'proposal',
      version: 2,
      state: 'pass',
      changeDigest: 'digest'
    }
  }
}
test('restored IDs request exactly the matching immutable proposal and validation', async () => {
  const value = snapshot()
  const writes: unknown[] = []
  globalThis.fetch = async (input, init) => {
    if (init?.method === 'POST') {
      assert.equal(typeof init.body, 'string')
      writes.push(JSON.parse(init.body as string))
      return new Response(JSON.stringify({ id: 'pending', action: writes[0] }))
    }
    return new Response(
      JSON.stringify(
        input === '/api/artifact-change-sets/proposal' ? value.proposal : value
      )
    )
  }
  const model = createArtifactProposal('store')
  await model.load('proposal', 'validation')
  assert.equal(model.ready(), true)
  assert.equal(await model.request(), 'pending')
  assert.deepEqual(writes, [
    {
      kind: 'lifecycle',
      changeSetId: 'proposal',
      version: 2,
      validationId: 'validation'
    }
  ])
})
test('a pass for an older proposal remains visible but cannot authorize the latest version', async () => {
  const value = snapshot()
  value.proposal.version = 1
  globalThis.fetch = async (input, init) =>
    new Response(
      JSON.stringify(
        init?.method === 'POST'
          ? value.preview
          : input === '/api/artifact-change-sets/proposal'
            ? { ...value.proposal, version: 2 }
            : value
      )
    )
  const model = createArtifactProposal('store')
  await model.load('proposal', 'validation')
  assert.equal(model.state.inspection?.proposal.version, 1)
  assert.equal(model.ready(), false)
  await assert.rejects(model.request(), /fresh matching/)
})
for (const wrong of ['store', 'digest', 'blocked']) {
  test(
    'rejects mismatching or blocked validation scope: ' + wrong,
    async () => {
      const value = snapshot()
      if (wrong === 'store') value.storeId = 'foreign'
      if (wrong === 'digest') value.preview.changeDigest = 'foreign'
      if (wrong === 'blocked') value.ready = false
      globalThis.fetch = async input =>
        new Response(
          JSON.stringify(
            input === '/api/artifact-change-sets/proposal'
              ? value.proposal
              : value
          )
        )
      const model = createArtifactProposal('store')
      await model.load('proposal', 'validation')
      assert.equal(model.ready(), false)
      await assert.rejects(model.request())
    }
  )
}
test('disposed proposal cannot accept a delayed snapshot', async () => {
  let resolve!: (response: Response) => void
  globalThis.fetch = () =>
    new Promise<Response>(done => {
      resolve = done
    })
  const model = createArtifactProposal('store')
  const reading = model.load('proposal', null)
  model.dispose()
  resolve(new Response(JSON.stringify(snapshot().proposal)))
  await reading
  assert.equal(model.state.proposal, null)
})

test('legacy review proposals stay readable without preview writes or prepare', async () => {
  const value = snapshot()
  value.proposal.changeSet.command = 'submit_review'
  let writes = 0
  globalThis.fetch = async (_input, init) => {
    if (init?.method === 'POST') writes++
    return new Response(JSON.stringify(value.proposal))
  }
  const model = createArtifactProposal('store')
  await model.load('proposal', null)
  assert.equal(model.state.proposal?.changeSet.command, 'submit_review')
  assert.match(model.state.error ?? '', /removed/)
  assert.equal(await model.prepare(), null)
  assert.equal(model.ready(), false)
  assert.equal(writes, 0)
})
