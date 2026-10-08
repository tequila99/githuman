import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { observeScrollRootWidth } from '@/utils/scroll-root-width'
import {
  installSegmentObservers,
  TestResizeObserver
} from '../helpers/segment-environment'

let restore: () => void
beforeEach(() => {
  restore = installSegmentObservers()
})
afterEach(() => restore())

test('one observer per root notifies only when available width changes', () => {
  const root = { clientWidth: 800 } as Element & { clientWidth: number }
  let a = 0,
    b = 0
  const stopA = observeScrollRootWidth(root, () => a++)
  const stopB = observeScrollRootWidth(root, () => b++)
  const observer = TestResizeObserver.all[0]!
  assert.equal(TestResizeObserver.all.length, 1)
  observer.deliver()
  assert.equal(a, 0)
  root.clientWidth = 600
  observer.deliver()
  assert.equal(a, 1)
  assert.equal(b, 1)
  stopA()
  root.clientWidth = 500
  observer.deliver()
  assert.equal(a, 1)
  assert.equal(b, 2)
  assert.equal(observer.targets.size, 1)
  stopB()
  assert.equal(observer.targets.size, 0)
  const stopNew = observeScrollRootWidth(root, () => a++)
  assert.equal(TestResizeObserver.all.length, 2)
  stopB()
  assert.equal(TestResizeObserver.all[1]!.targets.size, 1)
  stopNew()
})

test('roots have independent widths and observers', () => {
  const first = { clientWidth: 800 } as Element
  const second = { clientWidth: 400 } as Element
  const stops = [
    observeScrollRootWidth(first, () => {}),
    observeScrollRootWidth(second, () => {})
  ]
  assert.equal(TestResizeObserver.all.length, 2)
  for (const stop of stops) stop()
})
