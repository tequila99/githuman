<script setup lang="ts">
import { nextTick, onMounted, useTemplateRef } from 'vue'
import type { QInput } from 'quasar'
import type { NotePropertyType } from '@/utils/notes/properties'
const props = defineProps<{
  type: Extract<NotePropertyType, 'text' | 'list' | 'date' | 'number'>
  label: string
  invalid: boolean
}>()
const draft = defineModel<string>({ required: true })
const emit = defineEmits<{ commit: []; cancel: [] }>()
const input = useTemplateRef<QInput>('input')
onMounted(async () => {
  await nextTick()
  input.value?.focus()
})
function enter(event: KeyboardEvent) {
  if (props.type !== 'list') return
  event.preventDefault()
  emit('commit')
}
</script>
<template>
  <q-input
    ref="input"
    class="note-property-input"
    :model-value="draft"
    @update:model-value="draft = String($event ?? '')"
    dense
    borderless
    :autogrow="type === 'text' || type === 'list'"
    :type="type === 'date' ? 'date' : type === 'number' ? 'number' : 'textarea'"
    :aria-label="label"
    :error="invalid"
    hide-bottom-space
    @blur="emit('commit')"
    @keydown.esc.prevent="emit('cancel')"
    @keydown.enter.exact="enter"
  />
</template>
<style scoped>
.note-property-input {
  flex: 1;
  min-width: 0;
  margin-top: -5px;
  margin-bottom: -5px;
}
.note-property-input :deep(.q-field__native) {
  font-family: inherit;
  font-size: inherit;
  line-height: 24px;
  padding: 5px 0;
}
.note-property-input :deep(.q-field__control),
.note-property-input :deep(.q-field__marginal) {
  min-height: 34px;
  height: auto;
}
</style>
