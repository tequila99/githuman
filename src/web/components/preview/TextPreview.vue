<script setup lang="ts">
import { computed, nextTick, useTemplateRef, watch } from 'vue'
import { locateLine } from '@/utils/text-position'

const props = defineProps<{
  text: string
  line?: number | undefined
  column?: number | undefined
  /** True while a scroll to the line is pending. */
  request?: boolean
}>()
const emit = defineEmits<{
  /** The DOM is ready. `selected` is the marked line, if any. */
  rendered: [selected: HTMLElement | null]
}>()
const selected = useTemplateRef<HTMLElement>('selected')
const position = computed(() =>
  locateLine(props.text, props.line, props.column)
)
watch(
  () => [props.text, props.line, props.column, props.request],
  async () => {
    await nextTick()
    emit('rendered', selected.value)
  },
  { immediate: true }
)
</script>
<template>
  <pre
    class="project-text"
  ><template v-if="position">{{ position.before }}<span ref="selected" class="project-text__selected">{{ position.leading }}<mark>{{ position.character }}</mark>{{ position.trailing }}</span>{{ position.after }}</template><template v-else>{{ text }}</template></pre>
</template>
<style scoped>
.project-text {
  font-family: var(--font-mono);
  padding: 16px;
  margin: 0;
  white-space: pre;
}
.project-text__selected {
  background: rgba(255, 190, 0, 0.2);
}
</style>
