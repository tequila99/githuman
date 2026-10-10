import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dockEdge, dockPosition } from '@/utils/windows/dock-geometry'

test('dock snaps to all four edges and stays visible after resize', () => {
  const size = { width: 100, height: 50 }
  const viewport = { width: 800, height: 600 }
  for (const [point, edge] of [
    [{ x: 10, y: 200 }, 'left'],
    [{ x: 400, y: 10 }, 'top'],
    [{ x: 690, y: 200 }, 'right'],
    [{ x: 400, y: 540 }, 'bottom']
  ] as const) {
    assert.equal(dockEdge(point, size, viewport), edge)
    const position = dockPosition(point, edge, size, { width: 70, height: 40 })
    assert.deepEqual(position, { x: 0, y: 0 })
  }
  assert.equal(dockEdge({ x: 300, y: 200 }, size, viewport), 'free')
})

test('docked and freely dragged panels retain a gap from each viewport edge', () => {
  const size = { width: 100, height: 50 }
  const viewport = { width: 800, height: 600 }
  const point = { x: 300, y: 200 }
  assert.deepEqual(dockPosition(point, 'left', size, viewport), {
    x: 8,
    y: 200
  })
  assert.deepEqual(dockPosition(point, 'right', size, viewport), {
    x: 692,
    y: 200
  })
  assert.deepEqual(dockPosition(point, 'top', size, viewport), { x: 300, y: 8 })
  assert.deepEqual(dockPosition(point, 'bottom', size, viewport), {
    x: 300,
    y: 542
  })
  assert.deepEqual(dockPosition({ x: -100, y: 1000 }, 'free', size, viewport), {
    x: 8,
    y: 542
  })
  assert.deepEqual(
    dockPosition(point, 'bottom', size, { width: 110, height: 60 }),
    { x: 5, y: 5 }
  )
})
