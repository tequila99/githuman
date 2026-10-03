import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_AGENT_PRESETS,
  describePreset,
  loadAgentPresets
} from '../../../src/server/config/agents.ts'

function withFile(
  t: { after: (fn: () => void) => void },
  content?: string
): string {
  const dir = mkdtempSync(join(tmpdir(), 'githuman-presets-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'agents.json')
  if (content !== undefined) {
    writeFileSync(path, content)
  }
  return path
}

test('without an overrides file the defaults are returned', t => {
  assert.deepEqual(loadAgentPresets(withFile(t)), [...DEFAULT_AGENT_PRESETS])
})

test('the four target agents have presets, pinned where verified', () => {
  assert.deepEqual(
    DEFAULT_AGENT_PRESETS.map(p => p.id),
    ['claude', 'pi', 'cursor', 'codex']
  )
  assert.ok(DEFAULT_AGENT_PRESETS.find(p => p.id === 'pi')?.autoApprovesEdits)
  assert.ok(
    DEFAULT_AGENT_PRESETS.find(p => p.id === 'claude')?.args.some(a =>
      /@0\.\d+\.\d+$/.test(a)
    )
  )
})

test('an override replaces command/args of a default and keeps its metadata', t => {
  const path = withFile(
    t,
    JSON.stringify({ pi: { command: '/opt/pi-acp', args: ['--x'] } })
  )
  const pi = loadAgentPresets(path).find(p => p.id === 'pi')
  assert.equal(pi?.command, '/opt/pi-acp')
  assert.deepEqual(pi?.args, ['--x'])
  assert.equal(pi?.title, 'pi')
  assert.equal(pi?.autoApprovesEdits, true)
})

test('an unknown id defines a new agent, but needs a command', t => {
  const ok = loadAgentPresets(
    withFile(
      t,
      JSON.stringify({
        mine: { command: 'my-agent', args: ['acp'], env: { A: '1' } }
      })
    )
  )
  assert.deepEqual(ok.at(-1), {
    id: 'mine',
    title: 'mine',
    command: 'my-agent',
    args: ['acp'],
    autoApprovesEdits: false,
    env: { A: '1' }
  })
  assert.throws(
    () => loadAgentPresets(withFile(t, JSON.stringify({ mine: {} }))),
    /needs a "command"/
  )
})

test('malformed overrides are reported, not ignored', t => {
  assert.throws(() => loadAgentPresets(withFile(t, '{nope')), /Invalid JSON/)
  assert.throws(() => loadAgentPresets(withFile(t, '[]')), /JSON object/)
  assert.throws(
    () => loadAgentPresets(withFile(t, JSON.stringify({ pi: { args: 'x' } }))),
    /"args"/
  )
  assert.throws(
    () =>
      loadAgentPresets(withFile(t, JSON.stringify({ pi: { env: { A: 1 } } }))),
    /"env"/
  )
})

test('a misspelt or unknown field is named, not ignored', t => {
  assert.throws(
    () => loadAgentPresets(withFile(t, JSON.stringify({ pi: { arg: [] } }))),
    /unknown field "arg" \(allowed: command, args, env\)/
  )
  assert.throws(
    () =>
      loadAgentPresets(
        withFile(t, JSON.stringify({ pi: { title: 'x', command: 'pi' } }))
      ),
    /unknown field "title"/
  )
})

test('every kind of wrong value names its field', t => {
  const cases: [unknown, RegExp][] = [
    [{ pi: { command: '' } }, /needs a "command" string/],
    [{ pi: { command: 1 } }, /needs a "command" string/],
    [{ pi: { command: null } }, /needs a "command" string/],
    [{ pi: { args: ['a', 1] } }, /"args" must be an array of strings/],
    [{ pi: { args: null } }, /"args" must be an array of strings/],
    [{ pi: { env: [] } }, /"env" must map names to strings/],
    [{ pi: { env: { A: 1 } } }, /"env" must map names to strings/],
    [{ pi: 'x' }, /Agent "pi" in .* must be an object/],
    [{ pi: [] }, /Agent "pi" in .* must be an object/],
    [{ pi: null }, /Agent "pi" in .* must be an object/]
  ]
  for (const [content, message] of cases) {
    assert.throws(
      () => loadAgentPresets(withFile(t, JSON.stringify(content))),
      message,
      JSON.stringify(content)
    )
  }
})

test('the first problem is the one reported, and an id with a slash is handled', t => {
  assert.throws(
    () =>
      loadAgentPresets(
        withFile(t, JSON.stringify({ 'a/b': { x: 1, args: 1 } }))
      ),
    /Agent "a\/b" in .* unknown field "x"/
  )
  assert.throws(
    () =>
      loadAgentPresets(withFile(t, JSON.stringify({ 'a/b': { 'k/~': 1 } }))),
    /unknown field "k\/~"/
  )
})

test('a top-level string, number or null is not an overrides object', t => {
  for (const content of ['"x"', '7', 'null']) {
    assert.throws(
      () => loadAgentPresets(withFile(t, content)),
      /JSON object/,
      content
    )
  }
})

test('a preset is available when its command is on the PATH the agent will get', () => {
  const preset = {
    id: 'x',
    title: 'X',
    command: 'node',
    args: [],
    autoApprovesEdits: false
  }
  const nodeDir = process.execPath.replace(/\/node$/, '')
  assert.equal(
    describePreset({ ...preset, env: { PATH: nodeDir } }).available,
    true
  )
  assert.equal(
    describePreset({ ...preset, env: { PATH: '/nowhere' } }).available,
    false
  )
})
