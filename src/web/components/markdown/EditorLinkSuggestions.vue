<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { EditorLinkTarget } from '@/utils/editor-links'

defineProps<{ targets: readonly EditorLinkTarget[]; active: number }>()
const emit = defineEmits<{ select: [target: EditorLinkTarget] }>()
const { t } = useI18n()
</script>
<template>
  <q-list
    dense
    class="editor-link-suggestions scroll"
    role="listbox"
    :aria-label="t('markdown.findLink')"
    @mousedown.prevent
  >
    <q-item
      v-for="(target, index) in targets"
      :key="target.key"
      dense
      clickable
      role="option"
      :aria-selected="index === active"
      :active="index === active"
      @click="emit('select', target)"
    >
      <q-item-section>
        <q-item-label class="ellipsis">{{ target.label }}</q-item-label>
        <q-item-label caption class="ellipsis">{{
          target.caption
        }}</q-item-label>
      </q-item-section>
    </q-item>
    <q-item v-if="!targets.length" dense>
      <q-item-section>{{ t('markdown.noMatches') }}</q-item-section>
    </q-item>
  </q-list>
</template>
<style scoped>
.editor-link-suggestions {
  max-height: 200px;
  font-family: var(--font-agent);
  color: #222;
  background: white;
  border: 1px solid #8885;
  border-radius: 8px;
  z-index: 1;
}
.body--dark .editor-link-suggestions {
  background: #292c32;
  color: #eee;
}
.editor-link-suggestions :deep(.q-item__section) {
  min-width: 0;
}
.editor-link-suggestions :deep(.q-item__label.ellipsis) {
  white-space: nowrap;
  overflow-wrap: normal;
}
</style>
