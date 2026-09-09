<script setup lang="ts">
import { computed } from 'vue'
import type { DiffLine } from '@/api/types'
import type { HighlightedToken } from '@/composables/use-syntax-highlighting'

const props = defineProps<{
  line: DiffLine
  tokens?: HighlightedToken[] | null | undefined
}>()

const prefix = computed(
  () => ({ added: '+', removed: '-', context: ' ' })[props.line.type]
)

const rowClass = computed(() => {
  if (props.line.type === 'added') return 'diff-line--added'
  if (props.line.type === 'removed') return 'diff-line--removed'
  return ''
})

function tokenColor(token: HighlightedToken): string | undefined {
  if (token.colorLight && token.colorDark) {
    return `light-dark(${token.colorLight}, ${token.colorDark})`
  }
  return token.colorLight ?? token.colorDark
}
</script>

<template>
  <div class="diff-line row no-wrap text-mono" :class="rowClass">
    <span class="diff-line__gutter">{{ line.oldLineNumber ?? '' }}</span>
    <span class="diff-line__gutter">{{ line.newLineNumber ?? '' }}</span>
    <span class="diff-line__prefix">{{ prefix }}</span>
    <span class="diff-line__content">
      <template v-if="tokens">
        <span
          v-for="(token, index) in tokens"
          :key="index"
          :style="{ color: tokenColor(token) }"
          >{{ token.content }}</span
        >
      </template>
      <template v-else>{{ line.content }}</template>
    </span>
  </div>
</template>

<style scoped>
.diff-line {
  font-size: 12px;
  line-height: 20px;
}

.diff-line--added {
  background: var(--diff-added-bg);
}

.diff-line--removed {
  background: var(--diff-removed-bg);
}

.diff-line__gutter {
  flex: none;
  width: 40px;
  text-align: right;
  padding-right: 8px;
  user-select: none;
  color: var(--diff-gutter-color);
}

.diff-line__prefix {
  flex: none;
  width: 16px;
  text-align: center;
  user-select: none;
  font-weight: 600;
}

.diff-line--added .diff-line__prefix {
  color: var(--q-positive);
}

.diff-line--removed .diff-line__prefix {
  color: var(--q-negative);
}

.diff-line__content {
  flex: 1;
  white-space: pre;
}
</style>
