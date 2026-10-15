import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  isCredentialFreeWebUrl,
  webUrlFileName,
  webUrlLastSegment
} from '../../../src/shared/utils/web-url.ts'

test('only http and https URLs without credentials are accepted', () => {
  assert.equal(isCredentialFreeWebUrl(new URL('https://example.com/a')), true)
  assert.equal(isCredentialFreeWebUrl(new URL('http://example.com/a')), true)
  assert.equal(isCredentialFreeWebUrl(new URL('ftp://example.com/a')), false)
  assert.equal(isCredentialFreeWebUrl(new URL('file:///etc/passwd')), false)
  assert.equal(isCredentialFreeWebUrl(new URL('https://u@example.com/')), false)
  assert.equal(
    isCredentialFreeWebUrl(new URL('https://u:p@example.com/')),
    false
  )
})

test('the file name is decoded and falls back to the host name', () => {
  assert.equal(
    webUrlFileName(
      new URL('https://example.com/a/%D1%84%D0%B0%D0%B9%D0%BB.png')
    ),
    'файл.png'
  )
  assert.equal(
    webUrlFileName(new URL('https://example.com/dir/')),
    'example.com'
  )
  assert.equal(webUrlLastSegment(new URL('https://example.com/dir/')), '')
})

test('a malformed percent escape keeps the raw segment', () => {
  const url = new URL('https://example.com/a%E0.png')
  assert.equal(webUrlLastSegment(url), 'a%E0.png')
  assert.equal(webUrlFileName(url), 'a%E0.png')
})
