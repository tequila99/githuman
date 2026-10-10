import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computed, shallowRef } from 'vue'
import { usePdfNavigation } from '@/composables/preview/use-pdf-navigation'

test('navigation follows reactive page limits and updates the supplied model', () => {
  const page = shallowRef(0)
  const count = shallowRef(3)
  let remembered = 0
  const { navigate } = usePdfNavigation({
    page,
    pages: computed(() => count.value),
    canvas: null,
    blocked: false,
    onNavigate: () => remembered++
  })
  navigate(-1)
  assert.equal(page.value, 0)
  navigate(10)
  assert.equal(page.value, 2)
  count.value = 2
  navigate(1)
  assert.equal(page.value, 1)
  count.value = 0
  navigate(1)
  assert.equal(page.value, 1)
  assert.equal(remembered, 3)
})

test('navigation accepts plain values', () => {
  let remembered = 0
  const { navigate } = usePdfNavigation({
    page: 0,
    pages: 2,
    canvas: null,
    blocked: false,
    onNavigate: () => remembered++
  })
  navigate(1)
  assert.equal(remembered, 1)
})

test('margin clicks use current canvas bounds and ignore content clicks and blocked rendering', () => {
  const page = shallowRef(1)
  let blocked = false
  let canvas: HTMLCanvasElement | null = {
    getBoundingClientRect: () => ({ left: 100, right: 200 })
  } as HTMLCanvasElement
  const { navigateFromMargin } = usePdfNavigation({
    page,
    pages: () => 3,
    canvas: () => canvas,
    blocked: () => blocked
  })
  const container = new EventTarget()
  function click(x: number, target: EventTarget = container) {
    navigateFromMargin({
      target,
      currentTarget: container,
      clientX: x
    } as MouseEvent)
  }
  click(50)
  assert.equal(page.value, 0)
  click(250)
  assert.equal(page.value, 1)
  click(150)
  click(250, new EventTarget())
  assert.equal(page.value, 1)
  blocked = true
  click(250)
  assert.equal(page.value, 1)
  blocked = false
  canvas = null
  click(250)
  assert.equal(page.value, 1)
})
