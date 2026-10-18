import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  forwardedAddresses,
  isLoopbackAddress,
  parseHost,
  sameOrigin
} from '../../../src/server/utils/request-origin.ts'

test('parseHost accepts plain authorities and rejects userinfo and paths', () => {
  assert.equal(parseHost('localhost:3847')?.hostname, 'localhost')
  assert.equal(parseHost('[::1]:3847')?.hostname, '[::1]')
  assert.equal(parseHost('LOCALHOST')?.hostname, 'localhost')
  for (const value of [
    undefined,
    '',
    'localhost:80@evil.example',
    'user@localhost',
    'localhost/path',
    'localhost/',
    'localhost?x',
    'localhost#x',
    'local host',
    'localhost:99999'
  ]) {
    assert.equal(parseHost(value), undefined, String(value))
  }
})

test('sameOrigin compares host and port, not scheme', () => {
  assert.equal(sameOrigin('http://localhost:3847', 'localhost:3847'), true)
  assert.equal(sameOrigin('https://localhost:3847', 'localhost:3847'), true)
  assert.equal(sameOrigin('http://[::1]:3847', '[::1]:3847'), true)
  // The default port of the page scheme applies to both sides.
  assert.equal(sameOrigin('http://localhost', 'localhost:80'), true)
  assert.equal(sameOrigin('http://localhost', 'localhost'), true)
  // A TLS proxy keeps an explicit port 443 in Host.
  assert.equal(sameOrigin('https://machine.ts.net', 'machine.ts.net:443'), true)
  assert.equal(sameOrigin('https://machine.ts.net', 'machine.ts.net'), true)
  assert.equal(sameOrigin('https://machine.ts.net', 'machine.ts.net:80'), false)
  assert.equal(sameOrigin('http://machine.ts.net', 'machine.ts.net:443'), false)
  assert.equal(sameOrigin('https://[::1]:8443', '[::1]:8443'), true)
  for (const [origin, host] of [
    ['null', 'localhost:3847'],
    ['http://localhost:3848', 'localhost:3847'],
    ['http://evil.example', 'localhost'],
    ['http://user@localhost:3847', 'localhost:3847'],
    ['http://localhost:3847/', 'localhost:3847'],
    ['http://localhost:3847/path', 'localhost:3847'],
    ['ws://localhost:3847', 'localhost:3847'],
    ['file://', 'localhost'],
    ['not a url', 'localhost'],
    ['http://localhost:3847', undefined],
    ['http://localhost:3847', 'localhost:3847@evil.example']
  ] as const) {
    assert.equal(sameOrigin(origin, host), false, `${origin} vs ${host}`)
  }
})

test('isLoopbackAddress covers IPv4, IPv6 and IPv4-mapped loopback', () => {
  for (const address of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1']) {
    assert.equal(isLoopbackAddress(address), true, address)
  }
  for (const address of [
    undefined,
    '',
    '192.168.1.5',
    '::ffff:192.168.1.5',
    '0.0.0.0',
    '::',
    'localhost',
    '128.0.0.1'
  ]) {
    assert.equal(isLoopbackAddress(address), false, String(address))
  }
})

test('forwardedAddresses reads the chain and rejects unreadable entries', () => {
  assert.deepEqual(forwardedAddresses(undefined), [])
  assert.deepEqual(forwardedAddresses('192.168.1.5'), ['192.168.1.5'])
  assert.deepEqual(forwardedAddresses('10.0.0.1, ::ffff:127.0.0.1'), [
    '10.0.0.1',
    '::ffff:127.0.0.1'
  ])
  assert.deepEqual(forwardedAddresses(['10.0.0.1', '127.0.0.1']), [
    '10.0.0.1',
    '127.0.0.1'
  ])
  for (const value of ['', 'unknown', '192.168.1.5:1234', '1.2.3.4,,']) {
    assert.equal(forwardedAddresses(value), undefined, value)
  }
})
