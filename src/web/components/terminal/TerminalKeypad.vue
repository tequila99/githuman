<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { TerminalKey } from '@/utils/terminal-keys'

defineProps<{ disabled: boolean; control: boolean }>()
const emit = defineEmits<{ key: [key: TerminalKey]; control: [] }>()
const { t } = useI18n()
</script>
<template>
  <div
    class="terminal-keypad row no-wrap"
    role="group"
    :aria-label="t('terminal.keys.title')"
    @pointerdown.prevent
  >
    <q-btn
      flat
      label="Esc"
      :disable="disabled"
      :aria-label="t('terminal.keys.escape')"
      @click="emit('key', 'escape')"
    />
    <q-btn
      flat
      label="Tab"
      :disable="disabled"
      :aria-label="t('terminal.keys.tab')"
      @click="emit('key', 'tab')"
    />
    <q-btn
      flat
      label="Ctrl"
      :disable="disabled"
      :aria-pressed="control"
      :color="control ? 'primary' : undefined"
      @click="emit('control')"
    />
    <q-btn
      v-for="key in ['left', 'down', 'up', 'right'] as const"
      :key="key"
      flat
      :icon="
        {
          left: 'arrow_back',
          right: 'arrow_forward',
          up: 'arrow_upward',
          down: 'arrow_downward'
        }[key]
      "
      :disable="disabled"
      :aria-label="t('terminal.keys.' + key)"
      @click="emit('key', key)"
    />
  </div>
</template>
<style scoped>
.terminal-keypad {
  --terminal-keypad-key-size: 44px;

  flex: 0 0 auto;
  overflow-x: auto;
}
.terminal-keypad :deep(.q-btn) {
  min-width: var(--terminal-keypad-key-size);
  min-height: var(--terminal-keypad-key-size);
  padding: 0 8px;
}
</style>
