<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTerminalStore } from '@/stores/terminal-store'
import { editTerminalLine } from '@/utils/terminal-line-editor'

const props = defineProps<{ terminalId: string }>()
const store = useTerminalStore()
const { t } = useI18n()
const draft = ref('')

function submit(): void {
  if (store.state !== 'connected') return
  const { lines } = editTerminalLine('', draft.value + '\n')
  for (const data of lines)
    store.send({ type: 'line', terminalId: props.terminalId, data })
  draft.value = ''
}

// Limited mode has no PTY, so the input field sends Ctrl+C and Ctrl+D as signals.
function control(event: KeyboardEvent): void {
  if (!event.ctrlKey || !['c', 'd'].includes(event.key.toLowerCase())) return
  event.preventDefault()
  const signal = event.key.toLowerCase() === 'c' ? 'interrupt' : 'eof'
  // A shell closes on end of input only when the line is empty.
  if (signal === 'eof' && draft.value) return
  draft.value = ''
  store.send({ type: 'signal', terminalId: props.terminalId, signal })
}
</script>

<template>
  <q-input
    v-model="draft"
    dense
    outlined
    :disable="store.state !== 'connected'"
    :label="t('terminal.command')"
    @keydown="control"
    @keydown.enter.prevent="submit"
  >
    <template #append
      ><q-btn
        flat
        dense
        icon="send"
        :aria-label="t('terminal.send')"
        @click="submit"
    /></template>
  </q-input>
</template>
