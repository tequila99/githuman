import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deviceNameFromUserAgent } from '../../../src/server/utils/device-name.ts'

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

test('deviceNameFromUserAgent names known platforms and browsers', () => {
  assert.equal(deviceNameFromUserAgent(IPHONE), 'Safari on iPhone')
  assert.equal(
    deviceNameFromUserAgent(
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'
    ),
    'Chrome on Android'
  )
  assert.equal(
    deviceNameFromUserAgent(
      'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0'
    ),
    'Firefox on Linux'
  )
  assert.equal(deviceNameFromUserAgent(undefined), 'Unknown device')
  assert.equal(deviceNameFromUserAgent('curl/8.0'), 'Unknown device')
})
