import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  followScrollHeader,
  SCROLL_FOLLOW_MS,
  scrollTopToAlign
} from '@/utils/follow-scroll-header'

function setup() {
  let time = 0,
    target = 500,
    present = true,
    sequence = 0
  const frames = new Map<number, () => void>()
  const root = {
    scrollTop: 0,
    scrollHeight: 10_000,
    clientHeight: 1000,
    clientTop: 1,
    getBoundingClientRect: () => ({ top: 100 })
  } as Element
  const header = {
    getBoundingClientRect: () => ({ top: 100 + target - root.scrollTop })
  } as Element
  const stop = followScrollHeader({
    root,
    target: () => (present ? header : null),
    now: () => time,
    requestFrame: callback => {
      const id = ++sequence
      frames.set(id, callback)
      return id
    },
    cancelFrame: id => {
      frames.delete(id)
    }
  })
  function frame(at: number) {
    time = at
    const callbacks = [...frames.values()]
    frames.clear()
    for (const callback of callbacks) callback()
  }
  return {
    root,
    stop,
    frames,
    frame,
    move: (value: number) => {
      target = value
    },
    show: (value: boolean) => {
      present = value
    }
  }
}

test('late geometry keeps the real header aligned after a second, without early readiness guesses', () => {
  const s = setup()
  s.frame(16)
  assert.equal(s.root.scrollTop, 499)
  s.move(1500)
  s.frame(1200)
  assert.equal(s.root.scrollTop, 1499)
  s.frame(SCROLL_FOLLOW_MS)
  assert.equal(s.frames.size, 0)
  s.move(2000)
  s.frame(SCROLL_FOLLOW_MS + 1)
  assert.equal(s.root.scrollTop, 1499)
})

test('a missing header can appear while the operation follows', () => {
  const s = setup()
  s.show(false)
  s.frame(16)
  assert.equal(s.root.scrollTop, 0)
  s.show(true)
  s.frame(1500)
  assert.equal(s.root.scrollTop, 499)
  s.stop()
})

test('alignment clamps to both scroll boundaries and cancellation removes the pending frame', () => {
  const s = setup()
  s.move(15_000)
  s.frame(16)
  assert.equal(s.root.scrollTop, 9000)
  s.move(-100)
  s.frame(32)
  assert.equal(s.root.scrollTop, 0)
  s.stop()
  s.stop()
  assert.equal(s.frames.size, 0)
})

/** An element whose top edge is at `top` in the viewport. */
function elementAt(top: number): Element {
  return { getBoundingClientRect: () => ({ top }) } as Element
}

test('scrollTopToAlign puts the target at the top and clamps to the scroll range', () => {
  const root = {
    scrollTop: 300,
    scrollHeight: 2000,
    clientHeight: 500,
    clientTop: 1,
    getBoundingClientRect: () => ({ top: 100 })
  } as Element
  assert.equal(scrollTopToAlign(root, elementAt(51)), 250)
  assert.equal(scrollTopToAlign(root, elementAt(-1000)), 0)
  assert.equal(scrollTopToAlign(root, elementAt(5000)), 1500)
})
