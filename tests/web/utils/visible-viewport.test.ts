import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  viewportKeyboardOpen,
  nextViewportBaseline
} from '@/utils/visible-viewport'

test('keyboard requires editable focus, matching width, scale and both height thresholds', () => {
  const baseline = { width: 390, height: 800 }
  const current = {
    width: 390,
    height: 500,
    scale: 1,
    offsetTop: 0,
    offsetLeft: 0
  }
  assert.equal(viewportKeyboardOpen(baseline, current, true), true)
  assert.equal(viewportKeyboardOpen(baseline, current, false), false)
  assert.equal(
    viewportKeyboardOpen(baseline, { ...current, scale: 1.5 }, true),
    false
  )
  assert.equal(
    viewportKeyboardOpen(baseline, { ...current, width: 700 }, true),
    false
  )
  assert.equal(
    viewportKeyboardOpen(baseline, { ...current, height: 650 }, true),
    false
  )
  assert.equal(
    viewportKeyboardOpen(
      { width: 700, height: 320 },
      { ...current, width: 700, height: 220 },
      true
    ),
    false
  )
  assert.equal(
    viewportKeyboardOpen(
      { width: 700, height: 320 },
      { ...current, width: 700, height: 170 },
      true
    ),
    true
  )
})

test('visual-only keyboard resize retains its baseline, ordinary window resize uses the layout fallback', () => {
  const baseline = { width: 390, height: 844, layoutHeight: 844 }
  const current = {
    width: 390,
    height: 500,
    scale: 1,
    offsetTop: 0,
    offsetLeft: 0
  }
  const keyboard = nextViewportBaseline(baseline, current, true, 844)
  assert.equal(keyboard.height, 844)
  assert.equal(viewportKeyboardOpen(keyboard, current, true), true)
  const layout = nextViewportBaseline(baseline, current, true, 500)
  assert.equal(layout.height, 500)
  assert.equal(viewportKeyboardOpen(layout, current, true), false)
  assert.equal(nextViewportBaseline(baseline, current, false, 844).height, 500)
  assert.equal(
    nextViewportBaseline(baseline, current, true, 844, true).height,
    500
  )
})

test('focus, keyboard resize and blur follow the event sequence of the composable', () => {
  const full = {
    width: 390,
    height: 800,
    scale: 1,
    offsetTop: 0,
    offsetLeft: 0
  }
  const withKeyboard = { ...full, height: 450 }
  // focusin: the field gets focus before the keyboard opens.
  let baseline = nextViewportBaseline(
    { width: 390, height: 800, layoutHeight: 800 },
    full,
    true,
    800
  )
  assert.equal(viewportKeyboardOpen(baseline, full, true), false)
  // resize: the visual viewport shrinks, the layout viewport does not.
  baseline = nextViewportBaseline(baseline, withKeyboard, true, 800)
  assert.equal(baseline.height, 800)
  assert.equal(viewportKeyboardOpen(baseline, withKeyboard, true), true)
  // focusout: no editable focus resets the baseline, and the footer comes back.
  baseline = nextViewportBaseline(baseline, withKeyboard, false, 800)
  assert.equal(viewportKeyboardOpen(baseline, withKeyboard, false), false)
  // The keyboard closes: the next focus starts from the full height again.
  baseline = nextViewportBaseline(baseline, full, false, 800)
  assert.equal(baseline.height, 800)
})
