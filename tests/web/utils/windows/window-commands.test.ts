import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  dispatchWindowCommand,
  type WindowCommandTarget,
  WINDOW_SHORTCUTS
} from '@/utils/windows/window-commands'

function target(activeId: string | null = 'preview', available = true) {
  const calls: unknown[][] = []
  const commands: WindowCommandTarget = {
    activeId,
    toggleMode: (id, mode) => {
      calls.push(['mode', id, mode])
    },
    minimize: id => {
      calls.push(['minimize', id])
    },
    restoreLastMinimized: () => false,
    minimizeAll: () => {
      calls.push(['all'])
    },
    createTerminal: () => {
      calls.push(['create'])
    },
    toggleTerminal: () => {
      calls.push(['toggle'])
    },
    terminalAvailable: () => available
  }
  return { calls, commands }
}
test('modal dialogs block every window command', () => {
  const { calls, commands } = target()
  for (const shortcut of WINDOW_SHORTCUTS) {
    assert.equal(dispatchWindowCommand(shortcut, commands, true), false)
  }
  assert.deepEqual(calls, [])
})
test('layout commands address the active window while global commands need no active window', () => {
  const { calls, commands } = target()
  dispatchWindowCommand('Ctrl+Meta+ArrowLeft', commands, false)
  dispatchWindowCommand('Ctrl+Meta+ArrowRight', commands, false)
  dispatchWindowCommand('Ctrl+Meta+ArrowUp', commands, false)
  dispatchWindowCommand('Ctrl+Meta+ArrowDown', commands, false)
  assert.deepEqual(calls, [
    ['mode', 'preview', 'left'],
    ['mode', 'preview', 'right'],
    ['mode', 'preview', 'maximized'],
    ['minimize', 'preview']
  ])
  commands.activeId = null
  assert.equal(
    dispatchWindowCommand('Ctrl+Meta+ArrowUp', commands, false),
    false
  )
  assert.equal(dispatchWindowCommand('Ctrl+Meta+KeyM', commands, false), true)
  assert.equal(dispatchWindowCommand('Ctrl+Meta+KeyT', commands, false), true)
  assert.deepEqual(calls.slice(-2), [['all'], ['create']])
})
test('unavailable terminal and unknown commands are left untouched', () => {
  const { calls, commands } = target(null, false)
  assert.equal(dispatchWindowCommand('Ctrl+Meta+KeyT', commands, false), false)
  assert.equal(
    dispatchWindowCommand('Ctrl+Shift+Backquote', commands, false),
    false
  )
  assert.equal(dispatchWindowCommand('Ctrl+Meta+KeyX', commands, false), false)
  assert.deepEqual(calls, [])
})

test('up restores a minimized window only when no window is active', () => {
  const { calls, commands } = target(null)
  commands.restoreLastMinimized = () => {
    calls.push(['restore'])
    return true
  }
  assert.equal(
    dispatchWindowCommand('Ctrl+Meta+ArrowUp', commands, true),
    false
  )
  assert.equal(
    dispatchWindowCommand('Ctrl+Meta+ArrowDown', commands, false),
    false
  )
  assert.equal(
    dispatchWindowCommand('Ctrl+Meta+ArrowUp', commands, false),
    true
  )
  commands.activeId = 'preview'
  assert.equal(
    dispatchWindowCommand('Ctrl+Meta+ArrowUp', commands, false),
    true
  )
  assert.deepEqual(calls, [['restore'], ['mode', 'preview', 'maximized']])
})
