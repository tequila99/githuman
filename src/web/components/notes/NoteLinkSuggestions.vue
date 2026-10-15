<script setup lang="ts">
import { noteTitle } from '../../../shared/notes/note-path.ts'
import { useI18n } from 'vue-i18n'

defineProps<{ paths: string[]; active: number }>()
const emit = defineEmits<{ select: [path: string] }>()
const { t } = useI18n()
</script>
<template>
  <q-list
    dense
    class="note-link-suggestions scroll"
    role="listbox"
    :aria-label="t('notes.findLink')"
    @mousedown.prevent
  >
    <q-item
      v-for="(path, index) in paths"
      :key="path"
      dense
      clickable
      role="option"
      :aria-selected="index === active"
      :active="index === active"
      @click="emit('select', path)"
    >
      <q-item-section>
        <q-item-label class="ellipsis">{{ noteTitle(path) }}</q-item-label>
        <q-item-label caption class="ellipsis">{{ path }}</q-item-label>
      </q-item-section>
    </q-item>
    <q-item v-if="!paths.length" dense>
      <q-item-section>{{ t('notes.noMatches') }}</q-item-section>
    </q-item>
  </q-list>
</template>
<style scoped>
.note-link-suggestions {
  max-height: 200px;
  font-family: var(--font-agent);
  color: #222;
  background: white;
  border: 1px solid #8885;
  border-radius: 8px;
  z-index: 1;
}
.body--dark .note-link-suggestions {
  background: #292c32;
  color: #eee;
}
.note-link-suggestions :deep(.q-item__section) {
  min-width: 0;
}
.note-link-suggestions :deep(.q-item__label.ellipsis) {
  white-space: nowrap;
  overflow-wrap: normal;
}
</style>
