import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { MOUNT_MARGIN_PX, observeSegment } from '@/utils/segment-observer'

// A fake IntersectionObserver: the test delivers entries by hand.
class FakeObserver {
  static all: FakeObserver[] = []
  targets = new Set<object>()
  disconnected = false
  callback: (entries: Array<Partial<IntersectionObserverEntry>>) => void
  options: IntersectionObserverInit
  constructor(
    callback: (entries: Array<Partial<IntersectionObserverEntry>>) => void,
    options: IntersectionObserverInit
  ) {
    this.callback = callback
    this.options = options
    FakeObserver.all.push(this)
  }
  observe(target: object) {
    this.targets.add(target)
  }
  unobserve(target: object) {
    this.targets.delete(target)
  }
  disconnect() {
    this.disconnected = true
    this.targets.clear()
  }
  deliver(target: object, isIntersecting: boolean) {
    this.callback([{ target: target as Element, isIntersecting }])
  }
}

const original = globalThis.IntersectionObserver

beforeEach(() => {
  FakeObserver.all = []
  globalThis.IntersectionObserver =
    FakeObserver as unknown as typeof IntersectionObserver
})

afterEach(() => {
  globalThis.IntersectionObserver = original
})

const element = () => ({}) as Element

function recorder() {
  const calls: string[] = []
  return {
    calls,
    handler: {
      near: (near: boolean) => calls.push(`near:${near}`),
      visible: (visible: boolean) => calls.push(`visible:${visible}`)
    }
  }
}

test('one root has one mount observer and one visible observer for all segments', () => {
  const root = element()
  observeSegment(root, element(), recorder().handler)
  observeSegment(root, element(), recorder().handler)

  assert.equal(FakeObserver.all.length, 2)
  const [near, visible] = FakeObserver.all
  assert.equal(near!.options.rootMargin, `${MOUNT_MARGIN_PX}px 0px`)
  assert.equal(visible!.options.rootMargin, undefined)
  assert.equal(near!.targets.size, 2)
})

test('entries go to the handler of their element', () => {
  const root = element()
  const a = element()
  const b = element()
  const ra = recorder()
  const rb = recorder()
  observeSegment(root, a, ra.handler)
  observeSegment(root, b, rb.handler)
  const [near, visible] = FakeObserver.all

  near!.deliver(a, true)
  visible!.deliver(b, true)
  assert.deepEqual(ra.calls, ['near:true'])
  assert.deepEqual(rb.calls, ['visible:true'])
})

test('an entry for an element that is no longer watched is ignored', () => {
  const root = element()
  const a = element()
  const r = recorder()
  observeSegment(root, element(), recorder().handler)
  const stop = observeSegment(root, a, r.handler)
  stop()

  FakeObserver.all[0]!.deliver(a, true)
  assert.deepEqual(r.calls, [])
})

test('a stop of an old watch keeps the new watch of the same element', () => {
  const root = element()
  const a = element()
  const old = recorder()
  const fresh = recorder()
  const stopOld = observeSegment(root, a, old.handler)
  observeSegment(root, a, fresh.handler)
  stopOld()

  const near = FakeObserver.all[0]!
  assert.ok(near.targets.has(a))
  near.deliver(a, true)
  assert.deepEqual(old.calls, [])
  assert.deepEqual(fresh.calls, ['near:true'])
})

test('the last stop disconnects the observers, and a new watch makes new ones', () => {
  const root = element()
  const stop = observeSegment(root, element(), recorder().handler)
  stop()

  assert.ok(FakeObserver.all.every(observer => observer.disconnected))
  observeSegment(root, element(), recorder().handler)
  assert.equal(FakeObserver.all.length, 4)
})

test('each root has its own observers', () => {
  observeSegment(element(), element(), recorder().handler)
  observeSegment(element(), element(), recorder().handler)

  assert.equal(FakeObserver.all.length, 4)
})

test('card and row margins share independent observer groups and release only their own group', () => {
  const root = element(),
    row = element(),
    card = element(),
    otherCard = element()
  const rows = recorder(),
    cards = recorder()
  const stopRow = observeSegment(root, row, rows.handler)
  const stopCard = observeSegment(root, card, cards.handler, 6000)
  const stopOther = observeSegment(root, otherCard, cards.handler, 6000)
  assert.equal(FakeObserver.all.length, 4)
  assert.equal(
    FakeObserver.all[0]!.options.rootMargin,
    `${MOUNT_MARGIN_PX}px 0px`
  )
  assert.equal(FakeObserver.all[2]!.options.rootMargin, '6000px 0px')
  stopCard()
  stopCard()
  assert.equal(FakeObserver.all[2]!.disconnected, false)
  stopRow()
  assert.equal(FakeObserver.all[0]!.disconnected, true)
  assert.equal(FakeObserver.all[2]!.disconnected, false)
  FakeObserver.all[2]!.deliver(otherCard, true)
  assert.deepEqual(cards.calls, ['near:true'])
  stopOther()
  assert.equal(FakeObserver.all[2]!.disconnected, true)
})
