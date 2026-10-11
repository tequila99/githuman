import { test } from 'node:test'
import assert from 'node:assert/strict'
import { windowLayoutRect } from '@/utils/windows/window-geometry'
import type { WindowState } from '@/types/windows/window'

test('special layouts exactly fill the current viewport without modifying normal geometry', () => {
  const state: WindowState = {
    position: { x: 260, y: 120 },
    windowSize: { width: 800, height: 500 },
    open: true,
    minimized: false,
    maximized: false,
    mode: 'left'
  }
  assert.deepEqual(windowLayoutRect(state, { width: 1201, height: 800 }), {
    x: 0,
    y: 0,
    width: 600.5,
    height: 800
  })
  state.mode = 'right'
  assert.deepEqual(windowLayoutRect(state, { width: 1201, height: 800 }), {
    x: 600.5,
    y: 0,
    width: 600.5,
    height: 800
  })
  assert.deepEqual(windowLayoutRect(state, { width: 300, height: 200 }), {
    x: 150,
    y: 0,
    width: 150,
    height: 200
  })
  state.mode = 'maximized'
  assert.deepEqual(windowLayoutRect(state, { width: 300, height: 200 }), {
    x: 0,
    y: 0,
    width: 300,
    height: 200
  })
  state.mode = 'normal'
  assert.deepEqual(windowLayoutRect(state, { width: 1201, height: 800 }), {
    x: 260,
    y: 120,
    width: 800,
    height: 500
  })
  assert.deepEqual(state.position, { x: 260, y: 120 })
  assert.deepEqual(state.windowSize, { width: 800, height: 500 })
})
