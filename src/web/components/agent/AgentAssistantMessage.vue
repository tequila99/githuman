<script setup lang="ts">
import { useQuasar } from 'quasar'
import type { PreviewSource } from '@/types/windows/preview'
import MarkdownContent from '@/components/MarkdownContent.vue'

// Wait for streamed Markdown to settle before drawing diagrams.
const MERMAID_DEBOUNCE_MS = 300

defineProps<{ text: string; source: PreviewSource }>()
const $q = useQuasar()
</script>

<template>
  <q-chat-message
    size="12"
    :bg-color="$q.dark.isActive ? 'grey-9' : 'grey-3'"
    :text-color="$q.dark.isActive ? 'grey-2' : 'grey-10'"
    class="agent-item"
  >
    <MarkdownContent
      :text="text"
      :preview-source="source"
      :mermaid-debounce="MERMAID_DEBOUNCE_MS"
    />
  </q-chat-message>
</template>

<style scoped lang="scss">
@use '@/css/agent-message';

.agent-item :deep(.md-content) {
  font-size: 14px;
  line-height: 1.65;
}

.agent-item :deep(.md-content strong),
.agent-item :deep(.md-content b) {
  font-weight: 500;
}
</style>
