<script setup lang="ts">
import type {
  HighlightedToken,
  LineTokens
} from '@/composables/use-syntax-highlighting'
import { useGutterTap } from '@/composables/use-gutter-tap'

const props = defineProps<{
  lineNumber: number
  content: string
  tokens?: LineTokens | null | undefined
  selected?: boolean
  selectable?: boolean
  wrap?: boolean
}>()

const emit = defineEmits<{
  (e: 'gutter-mousedown'): void
  (e: 'gutter-mouseenter'): void
  (e: 'gutter-tap'): void
}>()
const tap = useGutterTap(() => {
  if (props.selectable) emit('gutter-tap')
})

function tokenColor(token: HighlightedToken): string | undefined {
  if (token.colorLight && token.colorDark) {
    return `light-dark(${token.colorLight}, ${token.colorDark})`
  }
  return token.colorLight ?? token.colorDark
}
</script>

<template>
  <div
    class="file-content-line row no-wrap text-mono"
    :data-line-key="`full:${lineNumber}`"
    :class="{
      'file-content-line--wrap': wrap,
      'file-content-line--selectable': selectable
    }"
  >
    <span
      class="file-content-line__gutter"
      :class="{
        'file-content-line__gutter--selectable': selectable,
        'file-content-line__gutter--selected': selected
      }"
      @pointerdown="tap.down($event, undefined)"
      @pointerup="tap.up"
      @pointercancel="tap.cancel"
      @mousedown="tap.mouseAllowed() && emit('gutter-mousedown')"
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

/* Without wrap, grow past the scroll viewport so the added/removed
   background spans the whole line when scrolled horizontally. Still needed
   here (unlike DiffLineRow): FileContentPanel renders this view in a
   q-scroll-area, without HorizontalScrollBody's full-width content box. */
.file-content-line:not(.file-content-line--wrap) {
  min-width: max-content;
}

.file-content-line--wrap {
  align-items: flex-start;
}

.file-content-line--wrap .file-content-line__content {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
