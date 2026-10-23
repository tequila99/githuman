<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useNoteProperties } from '@/composables/notes/use-note-properties'
import NoteTags from './NoteTags.vue'
import NotePropertyValue from './NotePropertyValue.vue'
import NotePropertyRow from './NotePropertyRow.vue'
import NotePropertyAdd from './NotePropertyAdd.vue'
const props = defineProps<{
  text: string
  path: string
  paths: string[]
  tags: string[]
}>()
const emit = defineEmits<{ change: [text: string] }>()
const { t } = useI18n()
const { properties, error, set, remove, add } = useNoteProperties(
  () => props.text,
  text => emit('change', text)
)
const rows = computed(() => {
  const result = properties.value.map(property => ({
    property,
    removable: true
  }))
  if (!properties.value.some(property => property.key === 'tags')) {
    result.push({ property: { key: 'tags', value: [] }, removable: false })
  }
  return result
})
const title = computed(() => {
  const value = properties.value.find(
    property => property.key === 'title'
  )?.value
  return typeof value === 'string' ? value : undefined
})
</script>
<template>
  <section class="note-properties" :aria-label="t('notes.properties')">
    <h2 v-if="title" class="note-properties-title">{{ title }}</h2>
    <div class="note-properties-heading">{{ t('notes.properties') }}</div>
    <q-banner v-if="error" dense class="note-banner text-negative">{{
      error
    }}</q-banner>
    <NotePropertyRow
      v-for="row in rows"
      :key="row.property.key"
      :property="row.property"
      :removable="row.removable"
      @remove="remove(row.property.key)"
    >
      <NoteTags
        v-if="row.property.key === 'tags'"
        compact
        :model-value="
          Array.isArray(row.property.value)
            ? (row.property.value as string[])
            : []
        "
        :options="tags"
        @update:model-value="set('tags', $event)"
      />
      <NotePropertyValue
        v-else
        :property="row.property"
        :path="path"
        :paths="paths"
        @change="set(row.property.key, $event)"
      />
    </NotePropertyRow>
    <NotePropertyAdd :add="add" />
  </section>
</template>
<style scoped>
.note-properties {
  flex: 0 0 auto;
  margin: 14px 40px 24px;
  font-family: var(--font-agent);
  font-size: 15px;
  line-height: 24px;
}
.note-properties-title {
  font: inherit;
  font-size: 26px;
  font-weight: 700;
  line-height: 1.25;
  margin: 0 0 28px;
  overflow-wrap: anywhere;
}
.note-properties-heading {
  font-size: 16px;
  margin-bottom: 12px;
}
.note-properties :deep(a) {
  color: #9873f2;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.note-properties :deep(.q-chip) {
  background: #f4f0ff;
  color: #9873f2;
  font-size: 14px;
  margin: 2px;
}
.note-properties :deep(.q-chip__icon) {
  color: inherit;
}
.note-properties :deep(.q-field__control) {
  min-height: 34px;
}
.note-properties :deep(.q-field__native) {
  font-family: inherit;
  font-size: inherit;
}
.body--dark .note-properties :deep(.q-chip) {
  background: #3a314d;
  color: #c4aaff;
}
.body--dark .note-properties :deep(a) {
  color: #c4aaff;
}
.workspace--narrow .note-properties {
  margin: 12px 12px 20px;
}
.workspace--narrow .note-properties-title {
  font-size: 23px;
}
</style>
