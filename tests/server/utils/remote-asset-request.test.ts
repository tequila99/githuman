import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MockAgent } from 'undici'
import {
  createPublicLookup,
  isPublicAssetAddress,
  remoteAssetRequest,
  translateRemoteAssetError
} from '../../../src/server/utils/remote-asset-request.ts'

for (const address of [
  '0.0.0.0',
  '10.0.0.1',
  '100.64.0.1',
  '127.0.0.1',
  '169.254.169.254',
  '172.16.0.1',
  '192.168.1.1',
  '192.0.2.1',
  '198.18.0.1',
  '203.0.113.1',
  '224.0.0.1',
  '255.255.255.255',
  '::',
  '::1',
  '::ffff:127.0.0.1',
  '::ffff:8.8.8.8',
  'fe80::1',
  'fc00::1',
  '2001:db8::1',
  '2002:0808:0808::1',
  '3fff::1'
]) {
  test('blocks non-public address ' + address, () =>
    assert.equal(isPublicAssetAddress(address), false)
  )
}
for (const address of [
  '8.8.8.8',
  '1.1.1.1',
  '2606:4700:4700::1111',
  '2001:4860:4860::8888'
]) {
  test('allows public address ' + address, () =>
    assert.equal(isPublicAssetAddress(address), true)
  )
}
function mockAgent() {
  const agent = new MockAgent()
  agent.disableNetConnect()
  return agent
}
function lookupResult(
  lookup: ReturnType<typeof createPublicLookup>,
  all: boolean
) {
  return new Promise<{ error: unknown; address: unknown; family?: number }>(
    resolve =>
      lookup('example.com', { all }, (error, address, family) =>
        resolve({ error, address, family })
      )
  )
}
const never = new AbortController().signal
const coded = (code: string) => Object.assign(new Error('x'), { code })

test('rejects private URLs before opening any connection', async t => {
  const agent = mockAgent()
  t.after(() => agent.close())
  for (const url of [
    'http://127.1/image.png',
    'http://2130706433/image.png',
    'http://[::1]/x',
    'file:///x',
    'http://user:password@example.com/x'
  ]) {
    await assert.rejects(
      remoteAssetRequest(url, 'GET', never, { dispatcher: agent })
    )
  }
})

test('the lookup returns checked addresses in both callback shapes', async () => {
  const lookup = createPublicLookup(async () => [
    { address: '8.8.8.8', family: 4 },
    { address: '2606:4700:4700::1111', family: 6 }
  ])
  const all = await lookupResult(lookup, true)
  assert.equal(all.error, null)
  assert.equal((all.address as unknown[]).length, 2)
  const single = await lookupResult(lookup, false)
  assert.deepEqual(
    [single.error, single.address, single.family],
    [null, '8.8.8.8', 4]
  )
})

test('the lookup rejects empty, private and mixed results', async () => {
  for (const addresses of [
    [],
    [{ address: '127.0.0.1', family: 4 }],
    [
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.1', family: 4 }
    ]
  ]) {
    const result = await lookupResult(
      createPublicLookup(async () => addresses),
      true
    )
    assert.match(String(result.error), /not public/)
  }
})

test('a real connection attempt to a host that resolves to a private address fails', async () => {
  await assert.rejects(
    remoteAssetRequest('https://private.example/a', 'GET', never, {
      resolveHost: async () => [{ address: '127.0.0.1', family: 4 }]
    }),
    /not public/
  )
})

test('returns status, headers and a readable body for a normal response', async t => {
  const agent = mockAgent()
  t.after(() => agent.close())
  agent
    .get('https://example.com')
    .intercept({ path: '/a', method: 'GET' })
    .reply(200, 'hello', { headers: { 'content-length': '5' } })
  const response = await remoteAssetRequest(
    'https://example.com/a',
    'GET',
    never,
    {
      dispatcher: agent
    }
  )
  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['content-length'], '5')
  let text = ''
  for await (const chunk of response) text += chunk
  assert.equal(text, 'hello')
})

test('follows a redirect and rechecks an IP literal target', async t => {
  const agent = mockAgent()
  t.after(() => agent.close())
  const pool = agent.get('https://example.com')
  pool
    .intercept({ path: '/a', method: 'GET' })
    .reply(302, '', { headers: { location: 'https://example.com/b' } })
  pool.intercept({ path: '/b', method: 'GET' }).reply(200, 'ok')
  const response = await remoteAssetRequest(
    'https://example.com/a',
    'GET',
    never,
    {
      dispatcher: agent
    }
  )
  assert.equal(response.statusCode, 200)
  response.destroy()
  agent
    .get('https://example.com')
    .intercept({ path: '/c', method: 'GET' })
    .reply(302, '', { headers: { location: 'https://10.0.0.1/x' } })
  await assert.rejects(
    remoteAssetRequest('https://example.com/c', 'GET', never, {
      dispatcher: agent
    }),
    /not public/
  )
})

test('rejects HTTPS downgrade and redirect loops', async t => {
  const agent = mockAgent()
  t.after(() => agent.close())
  const pool = agent.get('https://example.com')
  pool
    .intercept({ path: '/down', method: 'GET' })
    .reply(302, '', { headers: { location: 'http://example.com/x' } })
  await assert.rejects(
    remoteAssetRequest('https://example.com/down', 'GET', never, {
      dispatcher: agent
    }),
    /Insecure/
  )
  let requests = 0
  pool
    .intercept({ path: '/loop', method: 'GET' })
    .reply(() => {
      requests++
      return {
        statusCode: 302,
        data: '',
        responseOptions: { headers: { location: '/loop' } }
      }
    })
    .persist()
  await assert.rejects(
    remoteAssetRequest('https://example.com/loop', 'GET', never, {
      dispatcher: agent
    }),
    /Too many attachment redirects/
  )
  assert.equal(requests, 6)
})

test('a malformed or missing Location is a client error', async t => {
  const agent = mockAgent()
  t.after(() => agent.close())
  const pool = agent.get('https://example.com')
  pool
    .intercept({ path: '/bad', method: 'GET' })
    .reply(302, '', { headers: { location: 'http://[' } })
  pool.intercept({ path: '/none', method: 'GET' }).reply(302, '')
  await assert.rejects(
    remoteAssetRequest('https://example.com/bad', 'GET', never, {
      dispatcher: agent
    }),
    (error: { statusCode?: number; message: string }) =>
      error.statusCode === 400 &&
      /Invalid attachment redirect/.test(error.message)
  )
  await assert.rejects(
    remoteAssetRequest('https://example.com/none', 'GET', never, {
      dispatcher: agent
    }),
    (error: { statusCode?: number; message: string }) =>
      error.statusCode === 400 && /no valid location/.test(error.message)
  )
})

test('abort ends DNS waiting without waiting for the resolver', async () => {
  const controller = new AbortController()
  const pending = remoteAssetRequest(
    'https://example.com/a',
    'GET',
    controller.signal,
    {
      resolveHost: () => new Promise(() => {})
    }
  )
  setTimeout(() => controller.abort(new Error('cancelled')), 20)
  await assert.rejects(pending, /cancelled/)
})

test('transport failures become client errors and other errors pass through', () => {
  assert.match(
    String(translateRemoteAssetError(coded('UND_ERR_CONNECT_TIMEOUT'))),
    /timed out/
  )
  assert.match(
    String(translateRemoteAssetError(coded('UND_ERR_BODY_TIMEOUT'))),
    /stalled/
  )
  assert.match(
    String(translateRemoteAssetError(coded('ENOTFOUND'))),
    /could not be reached/
  )
  const other = coded('EOTHER')
  assert.equal(translateRemoteAssetError(other), other)
})
