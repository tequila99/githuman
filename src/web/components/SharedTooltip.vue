<script setup lang="ts">
import { nextTick, onBeforeUnmount, shallowRef, useTemplateRef } from 'vue'
import {
  useEventListener,
  useMutation,
  useTimeout,
  type QTooltip
} from 'quasar'
import { TOOLTIP_DELAY_MS } from '@/utils/tooltip'

const tooltip = useTemplateRef<QTooltip>('tooltip')
const anchor = shallowRef<HTMLElement | false>(false)
const text = shallowRef('')
const shown = shallowRef(false)
const { registerTimeout, removeTimeout } = useTimeout()
let active: HTMLElement | null = null
let activeLabel = ''
let source: 'pointer' | 'focus' | null = null
let generation = 0

// Pending tooltips must not observe virtual-list updates during scrolling.
const documentMutation = useMutation(() => ({
  target: shown.value ? document.documentElement : null,
  childList: true,
  subtree: true,
  onMutation: checkActive
}))
const anchorMutation = useMutation(() => ({
  target: shown.value && anchor.value ? anchor.value : null,
  attributes: true,
  attributeFilter: ['data-tooltip'],
  onMutation: checkActive
}))

function clearMutationRecords(): void {
  // Mutation records retain removed nodes even after the observers disconnect.
  documentMutation.mutationRecords.value = []
  anchorMutation.mutationRecords.value = []
}

function cancel(): void {
  clearMutationRecords()
  if (!active) return
  generation++
  removeTimeout()
  active = null
  source = null
  activeLabel = ''
  shown.value = false
  tooltip.value?.hide()
  anchor.value = false
}

function isCurrent(element: HTMLElement | null): boolean {
  return !!element?.isConnected && element.dataset.tooltip === activeLabel
}

function checkActive(): void {
  if (!isCurrent(active)) cancel()
  clearMutationRecords()
}

function findTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  const element = target.closest<HTMLElement>('[data-tooltip]')
  if (
    !element?.dataset.tooltip ||
    element.closest('[disabled], [aria-disabled="true"]')
  )
    return null
  return element
}

function enter(event: PointerEvent | FocusEvent): void {
  if (
    event instanceof PointerEvent &&
    (event.pointerType === 'touch' || event.buttons)
  )
    return
  const element = findTarget(event.target)
  if (!element) return
  if (element === active) {
    if (event.type === 'focusin') source = 'focus'
    return
  }
  cancel()
  active = element
  source = event.type === 'focusin' ? 'focus' : 'pointer'
  const current = ++generation
  const label = element.dataset.tooltip ?? ''
  activeLabel = label
  registerTimeout(async () => {
    if (current !== generation) return
    if (!isCurrent(element)) {
      cancel()
      return
    }
    anchor.value = element
    text.value = label
    await nextTick()
    // Unmount or a new target during the tick increments the generation.
    if (current !== generation) return
    if (!isCurrent(element)) {
      cancel()
      return
    }
    shown.value = true
    tooltip.value?.show(event)
  }, TOOLTIP_DELAY_MS)
}

function leave(event: PointerEvent | FocusEvent): void {
  if (!active) return
  if (event.type === 'pointerout' && source === 'focus') return
  if (
    event.relatedTarget instanceof Node &&
    active.contains(event.relatedTarget)
  )
    return
  cancel()
}

function scroll(event: Event): void {
  if (!active) return
  if (!(event.target instanceof Node) || event.target.contains(active)) cancel()
}

function visibilityChanged(): void {
  if (document.hidden) cancel()
}

useEventListener<PointerEvent | FocusEvent>(
  document,
  ['pointerover', 'focusin'],
  enter
)
useEventListener<PointerEvent | FocusEvent>(
  document,
  ['pointerout', 'focusout'],
  leave
)
useEventListener(document, ['pointerdown', 'keydown'], cancel, {
  capture: true
})
useEventListener(document, 'scroll', scroll, { capture: true })
useEventListener(document, 'visibilitychange', visibilityChanged)
useEventListener(window, ['resize', 'blur'], cancel)

onBeforeUnmount(cancel)
</script>

<template>
  <q-tooltip
    ref="tooltip"
    :target="anchor"
    :delay="TOOLTIP_DELAY_MS"
    no-parent-event
    @before-hide="cancel"
    >{{ text }}</q-tooltip
  >
</template>
