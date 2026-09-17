<script setup lang="ts">
import type { HighlightedToken } from '@/composables/use-syntax-highlighting'

defineProps<{
  lineNumber: number
  content: string
  tokens?: HighlightedToken[] | null | undefined
  selected?: boolean
  selectable?: boolean
}>()

const emit = defineEmits<{
  (e: 'gutter-mousedown'): void
  (e: 'gutter-mouseenter'): void
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
    <span
      class="file-content-line__gutter"
      :class="{
        'file-content-line__gutter--selectable': selectable,
        'file-content-line__gutter--selected': selected
      }"
      @mousedown="emit('gutter-mousedown')"
      @mouseenter="emit('gutter-mouseenter')"
      >{{ lineNumber }}</span
    >
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

.file-content-line__gutter--selectable {
  cursor: pointer;
}

.file-content-line__gutter--selectable:hover {
  background: color-mix(in srgb, var(--q-primary) 15%, transparent);
}

.file-content-line__gutter--selected {
  background: color-mix(in srgb, var(--q-primary) 30%, transparent);
}

.file-content-line__content {
  flex: 1;
  white-space: pre;
}
</style>
