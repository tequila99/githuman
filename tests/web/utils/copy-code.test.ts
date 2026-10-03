import { afterEach, beforeEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { COPIED_FEEDBACK_MS, createCodeBlockCopier } from '@/utils/copy-code'

const labels = { copy: 'Copy', copied: 'Copied' }

function button(code = 'const x = 1') {
  const attributes = new Map<string, string>([['aria-label', labels.copy]])
  return {
    dataset: {} as Record<string, string>,
    closest: () => ({ querySelector: () => ({ textContent: code }) }),
    setAttribute: (key: string, value: string) => attributes.set(key, value),
    getAttribute: (key: string) => attributes.get(key)
  } as unknown as HTMLElement
}

beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }))
afterEach(() => mock.timers.reset())

test('repeated copying restarts feedback for that button only', async () => {
  const texts: string[] = []
  const copier = createCodeBlockCopier(async text => {
    texts.push(text)
  })
  const first = button('one')
  const second = button('two')
  await copier.copyCodeBlock(first, labels)
  await copier.copyCodeBlock(second, labels)
  mock.timers.tick(1000)
  await copier.copyCodeBlock(first, labels)
  mock.timers.tick(500)
  assert.equal(second.dataset.copied, undefined)
  assert.equal(second.getAttribute('aria-label'), labels.copy)
  assert.equal(first.dataset.copied, 'true')
  mock.timers.tick(1000)
  assert.equal(first.dataset.copied, undefined)
  assert.deepEqual(texts, ['one', 'two', 'one'])
})

test('reset cancels feedback and keeps Markdown owners independent', async () => {
  const owner = createCodeBlockCopier(async () => {})
  const other = createCodeBlockCopier(async () => {})
  const first = button()
  const second = button()
  await owner.copyCodeBlock(first, labels)
  await other.copyCodeBlock(second, labels)
  owner.reset()
  assert.equal(first.dataset.copied, undefined)
  assert.equal(first.getAttribute('aria-label'), labels.copy)
  first.setAttribute('aria-label', 'replacement')
  assert.equal(second.dataset.copied, 'true')
  mock.timers.tick(COPIED_FEEDBACK_MS)
  assert.equal(first.getAttribute('aria-label'), 'replacement')
  assert.equal(second.dataset.copied, undefined)
})

test('clipboard completion after reset does not schedule feedback', async () => {
  let finish!: () => void
  const copier = createCodeBlockCopier(
    () =>
      new Promise<void>(resolve => {
        finish = resolve
      })
  )
  const target = button()
  const copying = copier.copyCodeBlock(target, labels)
  copier.reset()
  finish()
  assert.equal(await copying, true)
  assert.equal(target.dataset.copied, undefined)
  target.setAttribute('aria-label', 'replacement')
  mock.timers.tick(COPIED_FEEDBACK_MS)
  assert.equal(target.getAttribute('aria-label'), 'replacement')
})

test('clipboard rejection leaves feedback unchanged', async () => {
  const copier = createCodeBlockCopier(async () => {
    throw new Error('denied')
  })
  const target = button()
  assert.equal(await copier.copyCodeBlock(target, labels), false)
  assert.equal(target.dataset.copied, undefined)
  assert.equal(target.getAttribute('aria-label'), labels.copy)
})
