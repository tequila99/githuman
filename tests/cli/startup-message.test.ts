import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatStartupMessage } from '../../src/cli/startup-message.ts'

test('a loopback bind produces only the listening line', () => {
  assert.equal(
    formatStartupMessage('http://127.0.0.1:3847', []),
    'githuman listening on http://127.0.0.1:3847'
  )
})

test('a wildcard bind lists LAN addresses, explains pairing and warns about HTTP', () => {
  assert.equal(
    formatStartupMessage('http://localhost:3847', ['192.168.1.10', 'fd00::5']),
    'githuman listening on http://localhost:3847\n' +
      'Local network: http://192.168.1.10:3847\n' +
      'Local network: http://[fd00::5]:3847\n' +
      'Other devices request access at a local network address. Approve them in a localhost tab.\n' +
      'Warning: traffic is plain HTTP. Anyone on this network can read it, including device cookies.'
  )
})
