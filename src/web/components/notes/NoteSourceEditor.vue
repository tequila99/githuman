<script setup lang="ts">
import { noteTitle } from '../../../shared/notes/note-path.ts'
import { nextTick, shallowRef, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppTheme } from '@/composables/use-app-theme'
import { findMentionTrigger } from '@/utils/mention-editor'
import { noteLink } from '../../../shared/notes/links.ts'
import { useNoteLinkSuggestions } from '@/composables/notes/use-note-link-suggestions'
import NoteLinkSuggestions from './NoteLinkSuggestions.vue'

const props = defineProps<{ text: string; path: string; paths: string[] }>()
const emit = defineEmits<{ change: [text: string] }>()
const { t } = useI18n()
const { isDark } = useAppTheme()
const field = useTemplateRef<{ getNativeElement: () => HTMLTextAreaElement }>(
  'field'
)
const trigger = shallowRef<{
  start: number
  end: number
  query: string
} | null>(null)
const { active, matches, move } = useNoteLinkSuggestions(
  () => props.paths,
  () => trigger.value?.query ?? null
)
let selection: { start: number; end: number } | undefined
function change(value: string | number | null) {
  emit('change', String(value ?? ''))
  update()
}
function update() {
  const input = field.value?.getNativeElement()
  const found =
    input && input.selectionStart === input.selectionEnd
      ? findMentionTrigger(input.value.slice(0, input.selectionStart))
      : null
  if (found && input) {
    trigger.value = { ...found, end: input.selectionStart }
  } else {
    trigger.value = null
  }
}
function prepareLink() {
  const input = field.value?.getNativeElement()
  selection = input
    ? { start: input.selectionStart, end: input.selectionEnd }
    : undefined
  trigger.value = null
}
async function insertLink(path: string, mention = false) {
  const input = field.value?.getNativeElement()
  const range =
    mention && trigger.value
      ? trigger.value
      : (selection ?? {
          start: input?.selectionStart ?? props.text.length,
          end: input?.selectionEnd ?? props.text.length
        })
  const label =
    range.start !== range.end && !mention
      ? props.text.slice(range.start, range.end)
      : noteTitle(path)
  const markdown = `[${label.replace(/[\\[\]]/g, char => '\\' + char)}](${noteLink(props.path, path)})`
  emit(
    'change',
    props.text.slice(0, range.start) + markdown + props.text.slice(range.end)
  )
  trigger.value = null
  selection = undefined
  await nextTick()
  input?.focus()
  input?.setSelectionRange(
    range.start + markdown.length,
    range.start + markdown.length
  )
}
function keydown(event: KeyboardEvent) {
  if (!trigger.value) return
  if (event.key === 'Escape') {
    trigger.value = null
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    move(event.key === 'ArrowDown' ? 1 : -1)
  } else if (event.key === 'Enter' && matches.value[active.value]) {
    void insertLink(matches.value[active.value]!, true)
  } else {
    return
  }
  event.preventDefault()
}
defineExpose({ prepareLink, insertLink })
</script>
<template>
  <div class="note-source-editor col column no-wrap">
    <q-input
      ref="field"
      :key="String(isDark)"
      :dark="isDark"
      :model-value="text"
      type="textarea"
      class="note-source-field col"
      outlined
      :label="t('notes.source')"
      input-class="note-source"
      @update:model-value="change"
      @click="update"
      @keydown="keydown"
    />
    <NoteLinkSuggestions
      v-if="trigger"
      class="note-source-suggestions"
      :paths="matches"
      :active="active"
      @select="insertLink($event, true)"
    />
  </div>
</template>
<style scoped>
.note-source-editor {
  min-height: 0;
  position: relative;
}
.note-source-suggestions {
  position: absolute;
  bottom: 8px;
  left: 8px;
  right: 8px;
}
.note-source-field {
  min-height: 0;
}
.note-source-field :deep(.q-field__inner),
.note-source-field :deep(.q-field__control),
.note-source-field :deep(.q-field__control-container) {
  height: 100%;
  min-height: 0;
}
:deep(.note-source) {
  font-family: var(--font-mono);
  height: 100%;
  resize: none;
}
</style>
