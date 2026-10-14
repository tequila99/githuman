<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { NotePropertyValue } from '../../../shared/notes/document.ts'
import { NOTE_PROPERTY_CREATE_TYPES } from '@/utils/notes/properties'
import { useNotePropertyCreate } from '@/composables/notes/use-note-property-create'
const props = defineProps<{
  add: (key: string, value: NotePropertyValue) => boolean
}>()
const { t } = useI18n()
const { adding, name, type, start, cancel, submit } = useNotePropertyCreate(
  (key, value) => props.add(key, value)
)
const types = computed(() =>
  NOTE_PROPERTY_CREATE_TYPES.map(value => ({
    label: t('notes.propertyTypes.' + value),
    value
  }))
)
</script>
<template>
  <form v-if="adding" class="note-property-add-form" @submit.prevent="submit">
    <q-input
      v-model="name"
      dense
      borderless
      autofocus
      :label="t('notes.propertyName')"
    />
    <q-select
      v-model="type"
      :options="types"
      emit-value
      map-options
      dense
      borderless
      :label="t('notes.propertyType')"
    />
    <q-btn
      type="submit"
      flat
      dense
      icon="check"
      :aria-label="t('notes.addProperty')"
      :disable="!name.trim()"
    />
    <q-btn
      flat
      dense
      icon="close"
      :aria-label="t('notes.done')"
      @click="cancel"
    />
  </form>
  <button v-else type="button" class="note-properties-add" @click="start"
    ><q-icon name="add" size="20px" />{{ t('notes.addProperty') }}</button
  >
</template>
<style scoped>
.note-properties-add {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: inherit;
  color: #777;
  background: transparent;
  border: 0;
  padding: 8px 0;
  cursor: pointer;
}
.note-properties-add:focus-visible {
  outline: 2px solid var(--q-primary);
  outline-offset: 2px;
}
.note-property-add-form {
  display: flex;
  gap: 12px;
  align-items: center;
}
.note-property-add-form :deep(.q-field) {
  flex: 1;
  min-width: 0;
}

.body--dark .note-properties-add {
  color: #aaa;
}
</style>
