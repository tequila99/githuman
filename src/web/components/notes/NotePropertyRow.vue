<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { NoteProperty } from '../../../shared/notes/document.ts'
import { notePropertyIcon, notePropertyType } from '@/utils/notes/properties'
const props = defineProps<{ property: NoteProperty; removable: boolean }>()
const emit = defineEmits<{ remove: [] }>()
defineSlots<{ default(): unknown }>()
const { t } = useI18n()
const icon = computed(() => notePropertyIcon(notePropertyType(props.property)))
</script>
<template>
  <div class="note-property-row">
    <div class="note-property-key"
      ><q-icon :name="icon" size="19px" /><span>{{ property.key }}</span></div
    >
    <slot />
    <q-btn
      v-if="removable"
      class="note-property-remove"
      flat
      round
      dense
      size="xs"
      icon="close"
      :aria-label="t('notes.removeProperty') + ': ' + property.key"
      @click="emit('remove')"
    />
  </div>
</template>
<style scoped>
.note-property-row {
  display: grid;
  grid-template-columns: 166px minmax(0, 1fr) 24px;
  column-gap: 12px;
  align-items: start;
  min-height: 38px;
  border-radius: 5px;
}
.note-property-key {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 5px 0;
  color: #777;
  min-width: 0;
}
.note-property-key span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.note-property-remove {
  opacity: 0;
  color: #999;
  margin-top: 5px;
}
.note-property-row:hover .note-property-remove,
.note-property-row:focus-within .note-property-remove {
  opacity: 1;
}

.body--dark .note-property-key {
  color: #aaa;
}
@media (max-width: 700px) {
  .note-property-row {
    grid-template-columns: 112px minmax(0, 1fr) 24px;
    column-gap: 8px;
  }
  .note-property-key {
    gap: 6px;
  }
}
@media (pointer: coarse) {
  .note-property-remove {
    opacity: 1;
  }
}
</style>
