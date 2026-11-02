import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

// Probe only flags needed for isolation. Do not infer capabilities from semver.
const REQUIRED_FLAGS = [
  '--mode',
  '--no-session',
  '--no-extensions',
  '--no-skills',
  '--no-prompt-templates',
  '--no-themes',
  '--no-context-files',
  '--no-builtin-tools',
  '--offline'
]
// Bound runtime discovery before opening a session.
const PROBE_TIMEOUT_MS = 10000
const execute = promisify(execFile)

export type PiProfile = 'chat' | 'validator'

export async function piLaunchArgs(
  command: string,
  profile: PiProfile,
  extension: string
): Promise<string[]> {
  if (process.platform !== 'linux' && process.platform !== 'darwin') {
    throw new Error(
      'Pi bridge requires Linux or macOS (macOS verification was skipped).'
    )
  }
  let help: string
  const probeDir = await mkdtemp(join(tmpdir(), 'githuman-pi-probe-'))
  try {
    const result = await execute(command, ['--help'], {
      cwd: probeDir,
      env: {
        PATH: process.env.PATH,
        HOME: probeDir,
        PI_CODING_AGENT_DIR: probeDir,
        PI_OFFLINE: '1'
      },
      timeout: PROBE_TIMEOUT_MS,
      maxBuffer: 256 * 1024
    })
    help = result.stdout
  } catch {
    throw new Error('Pi bridge could not probe the installed pi executable.')
  } finally {
    await rm(probeDir, { recursive: true, force: true })
  }
  if (REQUIRED_FLAGS.some(flag => !help.includes(flag))) {
    throw new Error(
      'Unsupported pi runtime: required RPC/isolation flags are missing. Control versions start at pi 0.81.0; install a compatible runtime.'
    )
  }
  const args = ['--mode', 'rpc', '--no-session', '--no-themes', '-e', extension]
  if (profile === 'validator') {
    args.push(
      '--no-extensions',
      '--no-skills',
      '--no-prompt-templates',
      '--no-context-files',
      '--no-builtin-tools',
      '--offline'
    )
    if (help.includes('--no-mcp')) args.push('--no-mcp')
  }
  return args
}
