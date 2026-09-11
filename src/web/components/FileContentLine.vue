<script setup lang="ts">
import type { HighlightedToken } from '@/composables/use-syntax-highlighting'

defineProps<{
  lineNumber: number
  content: string
  tokens?: HighlightedToken[] | null | undefined
}>()

function tokenColor(token: HighlightedToken): string | undefined {
  if (token.colorLight && token.colorDark) {
    return `light-dark(${token.colorLight}, ${token.colorDark})`
  }
  return token.colorLight ?? token.colorDark
}
</script>

<template>
  <div class="file-content-line row no-wrap text-mono">
    <span class="file-content-line__gutter">{{ lineNumber }}</span>
    <span class="file-content-line__content">
      <template v-if="tokens">
        <span
          v-for="(token, index) in tokens"
          :key="index"
          :style="{ color: tokenColor(token) }"
          >{{ token.content }}</span
        >
      </template>
      <template v-else>{{ content || ' ' }}</template>
    </span>
  </div>
</template>

<style scoped>
.file-content-line {
  font-size: var(--code-font-size);
  line-height: 20px;
}

.file-content-line__gutter {
  flex: none;
  width: 48px;
  text-align: right;
  padding-right: 8px;
  user-select: none;
  color: var(--diff-gutter-color);
}

.file-content-line__content {
  flex: 1;
  white-space: pre;
}
</style>
