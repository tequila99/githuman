import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseArtifactLink } from '@/utils/windows/artifact-link'

// Different identities distinguish the store from its document.
const STORE = '11111111-1111-4111-8111-111111111111'
const ID = '22222222-2222-4222-8222-222222222222'
const BASE = 'http://localhost:3847/#/'

test('local artifact routes and native identities resolve to the same preview source', () => {
  for (const href of [
    `/#/artifacts?storeId=${STORE}&selectedId=${ID}`,
    `#/artifacts?storeId=${STORE}&selectedId=${ID}`,
    `/artifacts?storeId=${STORE}&selectedId=${ID}`,
    `http://localhost:3847/#/artifacts?selectedId=${ID}&storeId=${STORE}`,
    `githuman://artifact/${STORE}/${ID}`
  ]) {
    assert.deepEqual(
      parseArtifactLink(href, BASE),
      { storeId: STORE, artifactId: ID },
      href
    )
  }
})

test('external links, credentials, malformed identities and other routes are not previewed', () => {
  for (const href of [
    `https://example.com/#/artifacts?storeId=${STORE}&selectedId=${ID}`,
    `http://user@localhost:3847/#/artifacts?storeId=${STORE}&selectedId=${ID}`,
    `/#/artifacts?storeId=${STORE}&selectedId=invalid`,
    `/#/notes?storeId=${STORE}&selectedId=${ID}`,
    `githuman://artifact/${STORE}/${ID}/extra`,
    `githuman://artifact/${STORE}/${ID}?query=1`,
    `githuman://other/${STORE}/${ID}`,
    '/docs/a.pdf',
    'https://example.com/a.png',
    '#heading'
  ]) {
    assert.equal(parseArtifactLink(href, BASE), null, href)
  }
})
