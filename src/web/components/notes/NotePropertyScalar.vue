<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type {
  NoteProperty,
  NotePropertyValue
} from '../../../shared/notes/document.ts'
import { useNotePropertyEdit } from '@/composables/notes/use-note-property-edit'
import { notePropertyDisplay, notePropertyLink } from '@/utils/notes/properties'
import NotePropertyInput from './NotePropertyInput.vue'
import NotePropertyLink from './NotePropertyLink.vue'
const props = defineProps<{
  property: NoteProperty
  path: string
  paths: string[]
}>()
const emit = defineEmits<{ change: [value: NotePropertyValue] }>()
const { t, locale } = useI18n()
const { type, editing, invalid, draft, start, commit, cancel } =
  useNotePropertyEdit(
    () => props.property,
    value => emit('change', value)
  )
const link = computed(() =>
  notePropertyLink(props.property.value, props.path, props.paths)
)
const display = computed(() =>
  notePropertyDisplay(props.property.value, type.value, locale.value)
)
</script>
<template>
  <div class="note-property-scalar">
    <NotePropertyInput
      v-if="
        editing && (type === 'text' || type === 'date' || type === 'number')
      "
      v-model="draft"
      :type="type"
      :label="property.key"
      :invalid="invalid"
      @commit="commit"
      @cancel="cancel"
    />
    <template v-else>
      <NotePropertyLink v-if="link" :link="link" show-external-icon />
      <button
        v-else
        type="button"
        class="note-property-text"
        :class="{ 'note-property-empty': !display }"
        :aria-label="property.key"
        @click="start"
        ><q-icon v-if="type === 'date'" name="calendar_today" size="14px" />{{
          display || t('notes.propertyEmpty')
        }}</button
      >
      <q-btn
        v-if="link"
        flat
        round
        dense
        size="xs"
        icon="edit"
        class="note-property-edit"
        :aria-label="t('notes.editProperty')"
        @click="start"
      />
    </template>
  </div>
</template>
<style scoped>
.note-property-scalar {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  min-width: 0;
  flex: 1;
}
.note-property-text {
  border: 0;
  border-radius: 4px;
  padding: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: text;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.note-property-text .q-icon {
  color: #888;
  margin-right: 8px;
}
.note-property-empty {
  color: #888;
}
.note-property-edit {
  opacity: 0;
  flex-shrink: 0;
}
.note-property-scalar:hover .note-property-edit,
.note-property-scalar:focus-within .note-property-edit {
  opacity: 1;
}
.note-property-text:focus-visible {
  outline: 2px solid var(--q-primary);
  outline-offset: 3px;
}
@media (pointer: coarse) {
  .note-property-edit {
    opacity: 1;
  }
}
</style>
