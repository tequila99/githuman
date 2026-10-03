<script setup lang="ts">
import { useId, useTemplateRef } from 'vue'
import { useMentionEditor } from '@/composables/use-mention-editor'
import AgentMentionPopup from './AgentMentionPopup.vue'

const props = defineProps<{
  disabled?: boolean
  placeholder: string
  label: string
  /** Shift+Tab is handed to the parent (to cycle the mode) instead of moving focus. */
  cycleMode?: boolean
}>()
const emit = defineEmits<{
  (e: 'submit'): void
  (e: 'cycle-mode'): void
  (e: 'empty-change', empty: boolean): void
  (e: 'files', files: File[]): void
}>()

const root = useTemplateRef<HTMLDivElement>('root')
const listId = useId()
const {
  empty,
  popup,
  serialize,
  clear,
  focus,
  startMention,
  closePopup,
  pick,
  onInput,
  onKeydown,
  onKeyup,
  onPaste,
  onMousedown,
  onClick
} = useMentionEditor(root, {
  disabled: () => props.disabled,
  cycleMode: () => props.cycleMode,
  onSubmit: () => emit('submit'),
  onCycleMode: () => emit('cycle-mode'),
  onEmptyChange: isEmpty => emit('empty-change', isEmpty),
  onFiles: files => emit('files', files)
})
defineExpose({ serialize, clear, focus, startMention })
</script>

<template>
  <div class="agent-editor-wrap">
    <div
      ref="root"
      class="agent-editor"
      :class="{ 'agent-editor--empty': empty }"
      :contenteditable="disabled ? 'false' : 'true'"
      role="textbox"
      aria-multiline="true"
      aria-autocomplete="list"
      :aria-label="label"
      :aria-disabled="disabled ? 'true' : undefined"
      :aria-expanded="popup ? 'true' : 'false'"
      :aria-controls="popup ? listId : undefined"
      :aria-activedescendant="popup ? `${listId}-${popup.active}` : undefined"
      :data-placeholder="placeholder"
      spellcheck="true"
      @input="onInput"
      @keydown="onKeydown"
      @keyup="onKeyup"
      @paste="onPaste"
      @mousedown="onMousedown"
      @click="onClick"
      @blur="closePopup"
    />
    <AgentMentionPopup
      v-if="popup"
      :items="popup.items"
      :active="popup.active"
      :left="popup.left"
      :bottom="popup.bottom"
      :id-prefix="listId"
      @pick="pick"
    />
  </div>
</template>

<style scoped>
.agent-editor-wrap {
  position: relative;
  min-width: 0;
}
.agent-editor {
  font-family: var(--font-agent);
  min-height: 24px;
  max-height: 160px;
  padding: 5px 4px;
  overflow-y: auto;
  outline: none;
  font-size: 14px;
  line-height: 1.65;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.agent-editor[aria-disabled='true'] {
  cursor: not-allowed;
  opacity: 0.6;
}
/* The placeholder is not content: it sits on top of the empty line. */
.agent-editor--empty::before {
  content: attr(data-placeholder);
  position: absolute;
  top: 5px;
  right: 4px;
  left: 4px;
  overflow: hidden;
  opacity: 0.5;
  pointer-events: none;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Chips are created in code, outside this component's template. */
.agent-editor :deep(.agent-mention) {
  display: inline-flex;
  align-items: center;
  margin: 0 1px;
  padding: 0 1px 0 6px;
  border-radius: 4px;
  background: rgba(25, 118, 210, 0.18);
  font-size: 12.5px;
  line-height: 1.6;
  user-select: none;
  white-space: nowrap;
}
.agent-editor :deep(.agent-mention__remove) {
  padding: 0 4px;
  border: 0;
  background: none;
  color: inherit;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  opacity: 0.6;
}
.agent-editor :deep(.agent-mention__remove:hover) {
  opacity: 1;
}
</style>
