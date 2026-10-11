import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  focusWindow,
  registerPageElement,
  registerWindowElement,
  registerWindowFocus
} from '../../../../src/web/utils/windows/window-elements.ts'

test('focus uses the application API, preserves replacement registrations and falls back to the shell', () => {
  const previousDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    'document'
  )
  let modal = false
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { querySelector: () => (modal ? {} : null) }
  })
  const calls: string[] = []
  const unregisterWindow = registerWindowElement('focus-test', {
    focus: () => calls.push('shell')
  } as unknown as HTMLElement)
  const unregisterPage = registerPageElement({
    focus: () => calls.push('page')
  } as unknown as HTMLElement)
  const unregisterOld = registerWindowFocus('focus-test', () =>
    calls.push('old')
  )
  const unregisterNew = registerWindowFocus('focus-test', () =>
    calls.push('input')
  )
  try {
    unregisterOld()
    focusWindow('focus-test')
    assert.deepEqual(calls, ['input'])
    modal = true
    focusWindow('focus-test')
    focusWindow(null)
    assert.deepEqual(calls, ['input'])
    modal = false
    unregisterNew()
    focusWindow('focus-test')
    focusWindow(null)
    assert.deepEqual(calls, ['input', 'shell', 'page'])
    unregisterPage()
    focusWindow(null)
    assert.equal(calls.length, 3)
  } finally {
    unregisterOld()
    unregisterNew()
    unregisterWindow()
    unregisterPage()
    if (previousDocument) {
      Object.defineProperty(globalThis, 'document', previousDocument)
    } else {
      Reflect.deleteProperty(globalThis, 'document')
    }
  }
})
