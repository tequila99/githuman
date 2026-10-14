<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type {
  NoteProperty,
  NotePropertyValue
} from '../../../shared/notes/document.ts'
import { notePropertyDisplay, notePropertyType } from '@/utils/notes/properties'
import NotePropertyScalar from './NotePropertyScalar.vue'
import NotePropertyList from './NotePropertyList.vue'
const props = defineProps<{
  property: NoteProperty
  path: string
  paths: string[]
}>()
const emit = defineEmits<{ change: [value: NotePropertyValue] }>()
const { t, locale } = useI18n()
const type = computed(() => notePropertyType(props.property))
const display = computed(() =>
  type.value === 'complex'
    ? notePropertyDisplay(props.property.value, type.value, locale.value)
    : ''
)
</script>
<template>
  <div class="note-property-value">
    <q-checkbox
      v-if="type === 'boolean'"
      dense
      :model-value="Boolean(property.value)"
      :aria-label="property.key"
      @update:model-value="emit('change', Boolean($event))"
    />
    <NotePropertyList
      v-else-if="type === 'list'"
      :property="property"
      :path="path"
      :paths="paths"
      @change="emit('change', $event)"
    />
    <template v-else-if="type === 'complex'">
      <pre class="note-property-complex">{{ display }}</pre>
      <span class="note-property-source">{{ t('notes.propertySource') }}</span>
    </template>
    <NotePropertyScalar
      v-else
      :property="property"
      :path="path"
      :paths="paths"
      @change="emit('change', $event)"
    />
  </div>
</template>
<style scoped>
.note-property-value {
  min-width: 0;
  display: flex;
  align-items: flex-start;
  gap: 4px;
  padding: 5px 0;
  line-height: 24px;
}
.note-property-complex {
  margin: 0;
  max-width: 100%;
  font-size: 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.note-property-source {
  color: #888;
  font-size: 12px;
}
</style>
