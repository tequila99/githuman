<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type {
  NoteProperty,
  NotePropertyValue
} from '../../../shared/notes/document.ts'
import { useNotePropertyEdit } from '@/composables/notes/use-note-property-edit'
import { notePropertyLink } from '@/utils/notes/properties'
import NotePropertyInput from './NotePropertyInput.vue'
import NotePropertyLink from './NotePropertyLink.vue'
const props = defineProps<{
  property: NoteProperty
  path: string
  paths: string[]
}>()
const emit = defineEmits<{ change: [value: NotePropertyValue] }>()
const { t } = useI18n()
const { items, editing, invalid, draft, start, commit, cancel, removeItem } =
  useNotePropertyEdit(
    () => props.property,
    value => emit('change', value)
  )
const listItems = computed(() =>
  items.value.map(value => ({
    value,
    link: notePropertyLink(value, props.path, props.paths)
  }))
)
</script>
<template>
  <NotePropertyInput
    v-if="editing"
    v-model="draft"
    type="list"
    :label="property.key"
    :invalid="invalid"
    @commit="commit"
    @cancel="cancel"
  />
  <div v-else class="note-property-list">
    <span
      v-for="(item, index) in listItems"
      :key="index"
      class="note-property-list-item"
    >
      <NotePropertyLink v-if="item.link" :link="item.link" />
      <span v-else>{{ item.value }}</span>
      <q-btn
        flat
        round
        dense
        size="xs"
        icon="close"
        :aria-label="t('notes.removePropertyValue', { value: item.value })"
        @click="removeItem(index)"
      />
    </span>
    <button
      class="note-property-add-value"
      type="button"
      :aria-label="t('notes.editProperty')"
      @click="start"
      >+</button
    >
  </div>
</template>
<style scoped>
.note-property-list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  min-width: 0;
}
.note-property-list-item {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.note-property-list-item .q-btn {
  color: #999;
}
.note-property-add-value {
  border: 0;
  color: #888;
  background: transparent;
  font: inherit;
  cursor: pointer;
}
.note-property-add-value:focus-visible {
  outline: 2px solid var(--q-primary);
  outline-offset: 3px;
}
</style>
