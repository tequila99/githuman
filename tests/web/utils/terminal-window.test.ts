import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clampTerminalPosition,
  resizeTerminalWindow,
  terminalWindowSize,
  terminalDirectoryTitle,
  TERMINAL_WINDOW_MIN_HEIGHT,
  TERMINAL_WINDOW_MIN_WIDTH,
  TERMINAL_WINDOW_TOP
} from '@/utils/terminal-window'
import { terminalTheme } from '@/utils/terminal-theme'

test('saved off-screen positions are clamped after viewport changes', () => {
  const viewport = { width: 800, height: 600 }
  const size = terminalWindowSize(null, viewport)
  assert.deepEqual(
    clampTerminalPosition({ x: 2000, y: -100 }, size, viewport),
    { x: 24, y: TERMINAL_WINDOW_TOP }
  )
  assert.ok(size.width <= viewport.width)
  assert.ok(size.height < viewport.height)
})

test('a window on a short viewport stays below the header and inside the screen', () => {
  const viewport = { width: 1000, height: 200 }
  for (const preferred of [null, { width: 600, height: 400 }]) {
    const size = terminalWindowSize(preferred, viewport)
    const position = clampTerminalPosition({ x: 0, y: 0 }, size, viewport)
    assert.equal(position.y, TERMINAL_WINDOW_TOP)
    assert.ok(position.y + size.height <= viewport.height)
  }
})

test('a saved size is kept when it fits', () => {
  const viewport = { width: 1600, height: 1000 }
  assert.deepEqual(terminalWindowSize({ width: 700, height: 400 }, viewport), {
    width: 700,
    height: 400
  })
})

test('resize moves only the dragged edges and keeps the minimum size', () => {
  const viewport = { width: 1600, height: 1000 }
  const start = { x: 100, y: 100, width: 600, height: 400 }
  assert.deepEqual(
    resizeTerminalWindow(start, 'se', { x: 50, y: 30 }, viewport),
    { x: 100, y: 100, width: 650, height: 430 }
  )
  assert.deepEqual(
    resizeTerminalWindow(start, 'nw', { x: 1000, y: 1000 }, viewport),
    {
      x: 700 - TERMINAL_WINDOW_MIN_WIDTH,
      y: 500 - TERMINAL_WINDOW_MIN_HEIGHT,
      width: TERMINAL_WINDOW_MIN_WIDTH,
      height: TERMINAL_WINDOW_MIN_HEIGHT
    }
  )
})

test('resize stops at the header and at the viewport edges', () => {
  const viewport = { width: 1000, height: 800 }
  const start = { x: 100, y: 100, width: 600, height: 400 }
  const grown = resizeTerminalWindow(
    start,
    'nw',
    { x: -500, y: -500 },
    viewport
  )
  assert.equal(grown.x, 0)
  assert.equal(grown.y, TERMINAL_WINDOW_TOP)
  const wide = resizeTerminalWindow(start, 'se', { x: 900, y: 900 }, viewport)
  assert.equal(wide.x + wide.width, viewport.width)
  assert.equal(wide.y + wide.height, viewport.height)
})

test('on a tiny viewport the minimum size gives way to the free space', () => {
  const viewport = { width: 200, height: 150 }
  const start = { x: 0, y: TERMINAL_WINDOW_TOP, width: 200, height: 100 }
  const shrunk = resizeTerminalWindow(
    start,
    'se',
    { x: -500, y: -500 },
    viewport
  )
  assert.equal(shrunk.width, viewport.width)
  assert.equal(shrunk.height, viewport.height - TERMINAL_WINDOW_TOP)
})
test('theme palettes cover ANSI colors in both modes', () => {
  const dark = terminalTheme(true)
  const light = terminalTheme(false)
  assert.notEqual(dark.background, light.background)
  for (const theme of [dark, light])
    for (const key of [
      'red',
      'green',
      'blue',
      'brightRed',
      'brightWhite',
      'foreground',
      'cursor'
    ])
      assert.ok(key in theme)
})

test('terminal tab titles keep the directory and remove the shell prompt', () => {
  assert.equal(
    terminalDirectoryTitle('ivan@fr-xeon:~/Projects/githuman$'),
    'githuman'
  )
  assert.equal(terminalDirectoryTitle('/tmp/example folder'), 'example folder')
  assert.equal(terminalDirectoryTitle('Terminal 1'), 'Terminal 1')
  assert.equal(terminalDirectoryTitle('~/Projects/call-center/'), 'call-center')
  assert.equal(terminalDirectoryTitle('/'), '/')
  assert.equal(terminalDirectoryTitle('~'), '~')
})
