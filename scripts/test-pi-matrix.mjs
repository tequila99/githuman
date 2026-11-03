import YAML from 'yaml'
import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

// These are measured control points, not a promise about intervening releases.
const VERSIONS = ['0.81.0', '0.85.1', '0.99.0', '1.0.0', '1.1.0', '1.4.0']
// Exercise both permission profiles, HTTP validation, tasks, and native control isolation.
const TESTS = ['control-spike', 'session', 'validation', 'tasks', 'crash']

const { values } = parseArgs({
  options: {
    install: { type: 'boolean', default: false },
    runtime: { type: 'string' }
  }
})
const root = fileURLToPath(new URL('../', import.meta.url))
const launchers = mkdtempSync(join(tmpdir(), 'githuman-pi-global-launchers-'))
try {
  if (values.runtime && !VERSIONS.includes(values.runtime)) {
    throw new Error('Unknown control runtime')
  }
  for (const version of values.runtime ? [values.runtime] : VERSIONS) {
    const fixture = join(
      root,
      'tests/server/adapters/pi-acp/fixtures/runtimes',
      version
    )
    if (values.install) {
      execFileSync(
        'pnpm',
        [
          'install',
          '--ignore-workspace',
          '--frozen-lockfile',
          '--ignore-scripts'
        ],
        { cwd: fixture, stdio: 'inherit' }
      )
    }
    const lock = YAML.parse(
      readFileSync(join(fixture, 'pnpm-lock.yaml'), 'utf8')
    )
    if (
      Object.keys(lock.packages).some(
        name =>
          name.startsWith('@earendil-works/') &&
          name.split('@').at(-1) !== version
      )
    ) {
      throw new Error(`Mixed pi dependency family in ${version}`)
    }
    const runtime = realpathSync(
      join(fixture, 'node_modules/@earendil-works/pi-coding-agent')
    )
    const pkg = JSON.parse(readFileSync(join(runtime, 'package.json'), 'utf8'))
    if (pkg.version !== version || typeof pkg.bin?.pi !== 'string') {
      throw new Error(`Invalid pi fixture ${version}`)
    }
    const bin = join(launchers, version, 'bin')
    mkdirSync(bin, { recursive: true })
    const launcher = join(bin, 'pi')
    // Match the POSIX global-install symlink layout without replacing the user's pi.
    symlinkSync(join(runtime, pkg.bin.pi), launcher)
    console.log(
      `pi ${version}: POSIX global launcher, locked dependency family`
    )
    execFileSync(
      process.execPath,
      [
        '--test',
        ...TESTS.map(name => `tests/server/adapters/pi-acp/${name}.test.ts`)
      ],
      {
        cwd: root,
        stdio: 'inherit',
        timeout: 180000,
        env: { ...process.env, GITHUMAN_PI_SPIKE_COMMAND: launcher }
      }
    )
  }
} finally {
  rmSync(launchers, { recursive: true, force: true })
}
