<script setup lang="ts">
import { computed } from 'vue'
import type { DiffHunk } from '@/api/types'
import DiffLineRow from '@/components/DiffLineRow.vue'
import type { HighlightedToken } from '@/composables/use-syntax-highlighting'

const props = defineProps<{
  hunk: DiffHunk
  lineTokens?: (HighlightedToken[] | null)[] | null
}>()

const header = computed(
  () =>
    `@@ -${props.hunk.oldStart},${props.hunk.oldLines} +${props.hunk.newStart},${props.hunk.newLines} @@`
)
</script>

<template>
  <div class="diff-hunk">
    <div class="diff-hunk__header text-mono text-primary">{{ header }}</div>
    <DiffLineRow
      v-for="(line, index) in hunk.lines"
      :key="index"
      :line="line"
      :tokens="lineTokens?.[index]"
    />
  </div>
</template>

<style scoped>
.diff-hunk__header {
  padding: 2px 12px;
  font-size: 12px;
}
</style>
