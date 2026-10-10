import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  queueMount,
  resetMountQueue,
  ROW_BUDGET,
  VISIBLE_ROW_BUDGET
} from '@/utils/mount-queue'

// Frames run only when the test calls `frame()`.
let frames: Array<() => void> = []
function frame() {
  const pending = frames
  frames = []
  for (const callback of pending) callback()
}

beforeEach(() => {
  frames = []
  resetMountQueue(callback => frames.push(callback))
})

test('jobs run in a later frame, not at once', () => {
  const ran: string[] = []
  queueMount(10, () => ran.push('a'))

  assert.deepEqual(ran, [])
  frame()
  assert.deepEqual(ran, ['a'])
})

test('one frame runs jobs until the row budget is spent', () => {
  const ran: number[] = []
  const cost = ROW_BUDGET / 2
  for (let i = 0; i < 5; i++) queueMount(cost, () => ran.push(i))

  frame()
  assert.deepEqual(ran, [0, 1])
  frame()
  assert.deepEqual(ran, [0, 1, 2, 3])
  frame()
  assert.deepEqual(ran, [0, 1, 2, 3, 4])
  assert.equal(frames.length, 0, 'an empty queue asks for no frame')
})

test('a job larger than the budget runs alone', () => {
  const ran: string[] = []
  queueMount(ROW_BUDGET * 3, () => ran.push('big'))
  queueMount(1, () => ran.push('small'))

  frame()
  assert.deepEqual(ran, ['big'])
  frame()
  assert.deepEqual(ran, ['big', 'small'])
})

test('visible jobs go first, and a job can become visible later', () => {
  const ran: string[] = []
  queueMount(ROW_BUDGET, () => ran.push('near'))
  const later = queueMount(ROW_BUDGET, () => ran.push('later'))
  queueMount(ROW_BUDGET, () => ran.push('visible'), true)
  later.setVisible(true)

  frame()
  frame()
  frame()
  assert.deepEqual(ran, ['later', 'visible', 'near'])
})

test('many visible jobs stay inside the visible budget of a frame', () => {
  const ran: number[] = []
  for (let i = 0; i < 8; i++)
    queueMount(VISIBLE_ROW_BUDGET / 4, () => ran.push(i), true)

  frame()
  assert.deepEqual(ran, [0, 1, 2, 3])
})

test('after visible jobs, near jobs run only inside the smaller budget', () => {
  const ran: string[] = []
  queueMount(ROW_BUDGET / 2, () => ran.push('near'))
  queueMount(ROW_BUDGET, () => ran.push('visible'), true)

  frame()
  assert.deepEqual(ran, ['visible'])
  frame()
  assert.deepEqual(ran, ['visible', 'near'])
})

test('a cancelled job does not run', () => {
  const ran: string[] = []
  const job = queueMount(10, () => ran.push('a'))
  job.cancel()

  frame()
  assert.deepEqual(ran, [])
})

test('a job queued by a running job waits for the next frame', () => {
  const ran: string[] = []
  queueMount(1, () => {
    ran.push('first')
    queueMount(1, () => ran.push('second'))
  })

  frame()
  assert.deepEqual(ran, ['first'])
  frame()
  assert.deepEqual(ran, ['first', 'second'])
})

test('a thrown job does not strand the remaining queue and still reports the error', () => {
  const ran: string[] = []
  queueMount(1, () => {
    throw new Error('mount failed')
  })
  queueMount(1, () => ran.push('next'))
  assert.throws(() => frame(), /mount failed/)
  assert.deepEqual(ran, [])
  frame()
  assert.deepEqual(ran, ['next'])
  assert.equal(frames.length, 0)
})
