<script setup lang="ts">
import { ref, watch } from 'vue'
import FileContentLine from './FileContentLine.vue'
import {
  highlightLines,
  type HighlightedToken
} from '@/composables/use-syntax-highlighting'

const props = defineProps<{ path: string; lines: string[] }>()

const highlightedLines = ref<(HighlightedToken[] | null)[] | null>(null)

// Guards against out-of-order highlight results if path/lines change again
// before the previous highlightLines() call has resolved.
let latestHighlightRequestId = 0

watch(
  () => [props.path, props.lines] as const,
  async ([path, lines]) => {
    const requestId = ++latestHighlightRequestId
    highlightedLines.value = null
    if (lines.length > 0) {
      const result = await highlightLines(path, lines)
      if (requestId === latestHighlightRequestId) {
        highlightedLines.value = result
      }
    }
  },
  { immediate: true }
)
</script>

<template>
  <div class="file-content-view">
    <FileContentLine
      v-for="(line, index) in lines"
      :key="index"
      :line-number="index + 1"
      :content="line"
      :tokens="highlightedLines?.[index]"
    />
  </div>
</template>
