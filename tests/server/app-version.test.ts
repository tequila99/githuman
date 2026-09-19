import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getAppVersion } from '../../src/server/app-version.ts'

test('getAppVersion returns the version from package.json', () => {
  const pkgPath = fileURLToPath(new URL('../../package.json', import.meta.url))
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string }

  const version = getAppVersion()

  assert.equal(typeof version, 'string')
  assert.notEqual(version, '')
  assert.equal(version, pkg.version)
})
