<script setup lang="ts">
import {
  computed,
  useTemplateRef,
  onMounted,
  onBeforeUnmount,
  watch,
  nextTick
} from 'vue'
import { format, useElementSize, useEventListener } from 'quasar'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
// oxlint-disable-next-line import/no-unassigned-import -- xterm styles are part of this lazy component
import '@xterm/xterm/css/xterm.css'
import type { TerminalInfo } from '../../../shared/terminal/types.ts'
import {
  TERMINAL_MAX_COLS,
  TERMINAL_MAX_ROWS,
  TERMINAL_MIN_COLS,
  TERMINAL_MIN_ROWS,
  TERMINAL_SCROLLBACK
} from '../../../shared/terminal/constants.ts'
import { useTerminalStore } from '@/stores/terminal-store'
import { ignoreTerminalQueries } from '@/utils/terminal-queries'
import { terminalTheme } from '@/utils/terminal-theme'
import TerminalLineInput from './TerminalLineInput.vue'

// Match the code font of the diff view.
const FONT_SIZE = 13
const FONT_FAMILY = '"JetBrains Mono", monospace'
// WCAG AA contrast for normal text. The value 1 keeps the colors of the program.
const MINIMUM_CONTRAST = 4.5
const ORIGINAL_CONTRAST = 1

const props = defineProps<{
  session: TerminalInfo
  active: boolean
  dark: boolean
  originalColors: boolean
}>()
const { between } = format
const store = useTerminalStore()
// The padding and the space that the grid leaves free get the terminal color, so no strip shows.
const background = computed(() => terminalTheme(props.dark).background)
const host = useTemplateRef<HTMLDivElement>('host')
let terminal: Terminal | null = null
let detach: (() => void) | undefined
let fit: FitAddon | null = null
let queue = Promise.resolve()
let generation = 0
let disposed = false
// The size that the server has, or the size that this view sent last.
let lastSize = ''

function contrast(): number {
  return props.originalColors ? ORIGINAL_CONTRAST : MINIMUM_CONTRAST
}

function attachOutput(): void {
  detach?.()
  detach = store.attachView(props.session.id, message => {
    if (message.type !== 'snapshot' && message.type !== 'output') return
    if (message.type === 'snapshot') generation++
    const current = generation
    queue = queue
      .then(async () => {
        if (disposed || current !== generation || !terminal) return undefined
        if (message.type === 'snapshot') terminal.reset()
        terminal.resize(message.cols, message.rows)
        // Another viewer can change the shared size. This view then sends its own size when it is active.
        lastSize = `${message.cols}:${message.rows}`
        await new Promise<void>(resolve =>
          terminal?.write(message.data, resolve)
        )
        if (message.type === 'snapshot') {
          resize()
        } else if (current === generation && !disposed) {
          // The store acknowledges a snapshot when it arrives.
          store.acknowledge(props.session.id, message.sequence)
        }
        return undefined
      })
      // One failed frame must not stop the frames after it.
      .catch(() => {})
  })
}

// A background tab throttles xterm timers, so acknowledge frames without parsing them.
function followVisibility(): void {
  if (!terminal || disposed) return
  if (document.hidden) {
    detach?.()
    detach = undefined
    return
  }
  if (!detach) attachOutput()
}

function resize(): void {
  if (!terminal || !fit || !props.active) return
  if (!host.value?.clientWidth || !host.value.clientHeight) return
  const dimensions = fit.proposeDimensions()
  if (!dimensions) return
  const cols = between(dimensions.cols, TERMINAL_MIN_COLS, TERMINAL_MAX_COLS)
  const rows = between(dimensions.rows, TERMINAL_MIN_ROWS, TERMINAL_MAX_ROWS)
  const key = `${cols}:${rows}`
  if (lastSize === key) return
  if (store.send({ type: 'resize', terminalId: props.session.id, cols, rows }))
    lastSize = key
}

// A tab that becomes visible changes its size from zero, so this also fits a newly active tab.
useElementSize({ target: host, onResize: resize })
useEventListener(document, 'visibilitychange', followVisibility)

onMounted(async () => {
  if (!host.value) return
  terminal = new Terminal({
    cols: props.session.cols,
    rows: props.session.rows,
    scrollback: TERMINAL_SCROLLBACK,
    fontSize: FONT_SIZE,
    fontFamily: FONT_FAMILY,
    theme: terminalTheme(props.dark),
    minimumContrastRatio: contrast(),
    disableStdin: props.session.mode === 'pipe',
    allowProposedApi: true
  })
  fit = new FitAddon()
  terminal.loadAddon(fit)
  ignoreTerminalQueries(terminal)
  terminal.open(host.value)
  terminal.onData(data => {
    if (store.state === 'connected')
      store.send({ type: 'input', terminalId: props.session.id, data })
  })
  if (!document.hidden) attachOutput()
  await document.fonts.ready
  if (!disposed) resize()
})
watch(
  () => [props.dark, props.originalColors],
  () => {
    if (!terminal) return
    terminal.options.theme = terminalTheme(props.dark)
    terminal.options.minimumContrastRatio = contrast()
  }
)
watch(
  () => store.state,
  state => {
    if (state !== 'connected') return
    lastSize = ''
    resize()
  }
)
watch(
  () => props.active,
  async active => {
    if (!active) return
    await nextTick()
    resize()
    terminal?.focus()
  }
)
onBeforeUnmount(() => {
  disposed = true
  generation++
  detach?.()
  terminal?.dispose()
  terminal = null
})
</script>

<template>
  <div class="terminal-view" :style="{ background }">
    <div ref="host" class="terminal-view__screen" />
    <TerminalLineInput
      v-if="session.mode === 'pipe'"
      :terminal-id="session.id"
      class="terminal-view__input"
    />
  </div>
</template>

<style scoped>
.terminal-view {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  /* FitAddon measures the host, so keep spacing outside the host. */
  /* FitAddon keeps 14px for the scrollbar on the right, so the right side needs no padding. */
  padding: 8px 0 8px 8px;
}
.terminal-view__screen {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.terminal-view__input {
  margin-top: 8px;
}
</style>
